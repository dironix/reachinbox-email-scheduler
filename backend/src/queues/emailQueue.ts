import { Queue, Worker, Job, DelayedError } from 'bullmq';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { redisConnection } from '../config/redis';
import { prisma } from '../config/db';
import { getTransporterForSender } from '../config/mailer';
import { indexEmailDocument } from '../services/searchService';
import { notifySlackRateLimit } from '../services/slackService';

export const EMAIL_QUEUE_NAME = 'email-send-queue';

export interface EmailJobPayload {
  emailJobId: string;
  sequenceIndex: number;
}

// 1. BullMQ Queue backed by Redis AOF persistence
export const emailQueue = new Queue<EmailJobPayload>(EMAIL_QUEUE_NAME, {
  connection: redisConnection as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 1000 },
  },
});

// 2. Bull-Board Live Dashboard Setup
export const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [new BullMQAdapter(emailQueue)],
  serverAdapter,
});

/**
 * Computes the timestamp (ms) for the start of the next UTC hour window,
 * plus a staggered offset so delayed jobs preserve order without stampeding.
 */
function getNextHourWindowTimestamp(sequenceIndex: number, delayMs: number): number {
  const now = new Date();
  const nextHour = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours() + 1,
      0,
      2, // 2-second buffer into the new hour
      0
    )
  );
  return nextHour.getTime() + sequenceIndex * Math.min(delayMs, 2000);
}

// 3. Multi-Worker Processor with Atomic Rate Limiting
export function startEmailWorker(): Worker<EmailJobPayload> {
  const concurrency = Number(process.env.WORKER_CONCURRENCY) || 5;

  const worker = new Worker<EmailJobPayload>(
    EMAIL_QUEUE_NAME,
    async (job: Job<EmailJobPayload>, token?: string) => {
      const { emailJobId, sequenceIndex } = job.data;

      // Fetch job & sender from PostgreSQL
      const emailRecord = await prisma.emailJob.findUnique({
        where: { id: emailJobId },
        include: { sender: true },
      });

      if (!emailRecord) {
        console.warn(`⚠️ EmailJob ${emailJobId} not found in DB, skipping.`);
        return;
      }

      // Hard Idempotency Guard: Never send an already sent email twice
      if (emailRecord.status === 'SENT') {
        console.log(`⏭️ EmailJob ${emailJobId} already SENT. Skipping duplicate execution.`);
        return;
      }

      const sender = emailRecord.sender;
      const hourlyLimit =
        emailRecord.hourlyLimit ||
        sender.hourlyLimit ||
        Number(process.env.MAX_EMAILS_PER_HOUR_PER_SENDER) ||
        50;

      // Atomic Redis Hourly Counter keyed by senderId + UTC hour window
      const currentHourWindow = new Date().toISOString().slice(0, 13); // e.g., "2026-11-24T06"
      const rateLimitKey = `rate_limit:${sender.id}:${currentHourWindow}`;

      const currentCount = await redisConnection.incr(rateLimitKey);
      if (currentCount === 1) {
        await redisConnection.expire(rateLimitKey, 3700);
      }

      // Check if Hourly Rate Limit is Exceeded
      if (currentCount > hourlyLimit) {
        // Decrement back so counter accurately reflects actual sends
        await redisConnection.decr(rateLimitKey);

        const nextWindowMs = getNextHourWindowTimestamp(sequenceIndex, emailRecord.delayMs);
        const nextWindowDate = new Date(nextWindowMs);

        console.log(
          `⏳ Hourly rate limit (${hourlyLimit}/hr) reached for sender ${sender.email}. Rescheduling job ${emailJobId} to ${nextWindowDate.toISOString()}`
        );

        // Update DB & Elasticsearch status to RATE_LIMITED with new scheduledAt
        const updated = await prisma.emailJob.update({
          where: { id: emailJobId },
          data: {
            status: 'RATE_LIMITED',
            scheduledAt: nextWindowDate,
          },
        });

        await indexEmailDocument({
          id: updated.id,
          userId: updated.userId,
          senderEmail: sender.email,
          recipientEmail: updated.recipientEmail,
          subject: updated.subject,
          body: updated.body,
          status: updated.status,
          scheduledAt: updated.scheduledAt,
          sentAt: updated.sentAt,
        });

        // Fire live Slack notification (deduplicated once per sender per hour window)
        await notifySlackRateLimit(
          emailRecord.userId,
          sender.email,
          hourlyLimit,
          nextWindowDate.toISOString()
        );

        // Move job cleanly to delayed set in BullMQ without failing or dropping it
        await job.moveToDelayed(nextWindowMs, token);
        throw new DelayedError();
      }

      // Mark as PROCESSING
      await prisma.emailJob.update({
        where: { id: emailJobId },
        data: { status: 'PROCESSING' },
      });

      try {
        // Enforce minimum delay between sends if configured
        if (emailRecord.delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(emailRecord.delayMs, 5000)));
        }

        // Send via Ethereal SMTP
        const transporter = getTransporterForSender(sender.smtpUser, sender.smtpPass);
        const info = await transporter.sendMail({
          from: `"ReachInbox Outreach" <${sender.email}>`,
          to: emailRecord.recipientEmail,
          subject: emailRecord.subject,
          text: emailRecord.body,
          html: `<div style="font-family: sans-serif; line-height: 1.5;">${emailRecord.body.replace(/\n/g, '<br/>')}</div>`,
        });

        const sentAt = new Date();
        const sentRecord = await prisma.emailJob.update({
          where: { id: emailJobId },
          data: {
            status: 'SENT',
            sentAt,
            errorMessage: null,
          },
        });

        await indexEmailDocument({
          id: sentRecord.id,
          userId: sentRecord.userId,
          senderEmail: sender.email,
          recipientEmail: sentRecord.recipientEmail,
          subject: sentRecord.subject,
          body: sentRecord.body,
          status: sentRecord.status,
          scheduledAt: sentRecord.scheduledAt,
          sentAt: sentRecord.sentAt,
        });

        console.log(
          `✅ Sent email ${emailJobId} to ${emailRecord.recipientEmail} (Ethereal ID: ${info.messageId})`
        );
      } catch (err: any) {
        // Roll back hourly quota slot if SMTP failed
        await redisConnection.decr(rateLimitKey);

        const failedRecord = await prisma.emailJob.update({
          where: { id: emailJobId },
          data: {
            status: 'FAILED',
            errorMessage: err?.message || 'Unknown SMTP error',
          },
        });

        await indexEmailDocument({
          id: failedRecord.id,
          userId: failedRecord.userId,
          senderEmail: sender.email,
          recipientEmail: failedRecord.recipientEmail,
          subject: failedRecord.subject,
          body: failedRecord.body,
          status: failedRecord.status,
          scheduledAt: failedRecord.scheduledAt,
          sentAt: failedRecord.sentAt,
        });

        console.error(`❌ Failed sending email ${emailJobId}:`, err?.message);
        throw err;
      }
    },
    {
      connection: redisConnection as any,
      concurrency,
      lockDuration: 60000, // 60s lock prevents Ethereal SMTP latency from expiring the job lock
    }
  );

  worker.on('failed', (job, err) => {
    if (err instanceof DelayedError) return;
    console.error(`❌ Worker job ${job?.id} failed:`, err.message);
  });

  console.log(`🚀 BullMQ Email Worker started (concurrency: ${concurrency})`);
  return worker;
}

/**
 * Startup Persistence Recovery:
 * Ensures any SCHEDULED or RATE_LIMITED emails in PostgreSQL are present in BullMQ
 * after a server restart without duplicating already queued or sent jobs.
 */
export async function recoverScheduledJobsOnStartup(): Promise<void> {
  const pendingJobs = await prisma.emailJob.findMany({
    where: {
      status: { in: ['SCHEDULED', 'RATE_LIMITED'] },
    },
    orderBy: { scheduledAt: 'asc' },
  });

  let recoveredCount = 0;
  for (let i = 0; i < pendingJobs.length; i++) {
    const record = pendingJobs[i];
    const existingJob = await emailQueue.getJob(record.id);

    if (!existingJob) {
      const delay = Math.max(0, record.scheduledAt.getTime() - Date.now());
      await emailQueue.add(
        'send-email',
        { emailJobId: record.id, sequenceIndex: i },
        {
          jobId: record.id, // Strict idempotency key
          delay,
        }
      );
      recoveredCount++;
    }
  }

  console.log(
    `🔄 Startup recovery complete: ${pendingJobs.length} pending in DB, ${recoveredCount} re-enqueued into BullMQ.`
  );
}