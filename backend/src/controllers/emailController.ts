import { Response } from 'express';
import { prisma } from '../config/db';
import { getOrCreateSender, createNewEtherealSender } from '../config/mailer';
import { emailQueue } from '../queues/emailQueue';
import { indexEmailDocument, searchEmailsInES } from '../services/searchService';
import { AuthRequest } from '../middleware/authMiddleware';

export async function scheduleEmails(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const {
      recipients,
      subject,
      body,
      startTime,
      delayBetweenEmailsMs,
      hourlyLimit,
      senderId,
    } = req.body;

    if (!Array.isArray(recipients) || recipients.length === 0) {
      res.status(400).json({ error: 'At least one recipient email is required' });
      return;
    }

    if (!subject || !body) {
      res.status(400).json({ error: 'Subject and body are required' });
      return;
    }

    const sender = await getOrCreateSender(userId, senderId);
    const parsedStart = startTime ? new Date(startTime) : new Date();
    const delayMs =
      delayBetweenEmailsMs !== undefined
        ? Number(delayBetweenEmailsMs)
        : Number(process.env.DEFAULT_MIN_DELAY_MS) || 2000;

    const effectiveHourlyLimit =
      hourlyLimit !== undefined
        ? Number(hourlyLimit)
        : sender.hourlyLimit || Number(process.env.MAX_EMAILS_PER_HOUR_PER_SENDER) || 50;

    // Update sender's hourlyLimit if user customized it
    if (hourlyLimit !== undefined && Number(hourlyLimit) !== sender.hourlyLimit) {
      await prisma.sender.update({
        where: { id: sender.id },
        data: { hourlyLimit: effectiveHourlyLimit },
      });
    }

    // Deduplicate valid emails
    const uniqueRecipients = Array.from(
      new Set(
        recipients
          .map((e: string) => String(e).trim().toLowerCase())
          .filter((e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
      )
    );

    const createdJobs = [];

    for (let i = 0; i < uniqueRecipients.length; i++) {
      const recipientEmail = uniqueRecipients[i];
      const scheduledAt = new Date(parsedStart.getTime() + i * delayMs);
      const bullDelay = Math.max(0, scheduledAt.getTime() - Date.now());

      // 1. Persist in PostgreSQL first
      const emailRecord = await prisma.emailJob.create({
        data: {
          userId,
          senderId: sender.id,
          recipientEmail,
          subject,
          body,
          scheduledAt,
          status: 'SCHEDULED',
          delayMs,
          hourlyLimit: effectiveHourlyLimit,
        },
      });

      // 2. Index in Elasticsearch
      await indexEmailDocument({
        id: emailRecord.id,
        userId: emailRecord.userId,
        senderEmail: sender.email,
        recipientEmail: emailRecord.recipientEmail,
        subject: emailRecord.subject,
        body: emailRecord.body,
        status: emailRecord.status,
        scheduledAt: emailRecord.scheduledAt,
        sentAt: null,
      });

      // 3. Add persistent delayed job to BullMQ with UUID as jobId
      await emailQueue.add(
        'send-email',
        { emailJobId: emailRecord.id, sequenceIndex: i },
        {
          jobId: emailRecord.id,
          delay: bullDelay,
        }
      );

      createdJobs.push(emailRecord);
    }

    res.status(201).json({
      message: `Scheduled ${createdJobs.length} emails via sender ${sender.email}`,
      senderEmail: sender.email,
      count: createdJobs.length,
      jobs: createdJobs,
    });
  } catch (error: any) {
    console.error('❌ Schedule emails error:', error);
    res.status(500).json({ error: 'Failed to schedule emails', details: error.message });
  }
}

export async function getScheduledEmails(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const emails = await prisma.emailJob.findMany({
      where: {
        userId,
        status: { in: ['SCHEDULED', 'PROCESSING', 'RATE_LIMITED'] },
      },
      include: { sender: { select: { email: true } } },
      orderBy: { scheduledAt: 'asc' },
    });
    res.json(emails);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch scheduled emails' });
  }
}

export async function getSentEmails(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const emails = await prisma.emailJob.findMany({
      where: {
        userId,
        status: { in: ['SENT', 'FAILED'] },
      },
      include: { sender: { select: { email: true } } },
      orderBy: { sentAt: 'desc' },
    });
    res.json(emails);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch sent emails' });
  }
}

export async function searchEmails(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const q = String(req.query.q || '');
    const status = req.query.status ? String(req.query.status) : undefined;

    const results = await searchEmailsInES(userId, q, status);
    res.json(results);
  } catch (error) {
    console.error('❌ Search error:', error);
    res.status(500).json({ error: 'Elasticsearch query failed' });
  }
}

export async function addNewSender(req: AuthRequest, res: Response): Promise<void> {
  try {
    const sender = await createNewEtherealSender(req.user!.userId);
    res.status(201).json({
      id: sender.id,
      email: sender.email,
      hourlyLimit: sender.hourlyLimit,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create new Ethereal sender' });
  }
}