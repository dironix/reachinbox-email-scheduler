import axios from 'axios';
import { redisConnection } from '../config/redis';
import { prisma } from '../config/db';

/**
 * Sends a live Slack message when a sender hits their hourly rate limit.
 * Uses a Redis NX lock so multiple concurrent workers don't spam the channel
 * for the same sender within the same hour window.
 */
export async function notifySlackRateLimit(
  userId: string,
  senderEmail: string,
  hourlyLimit: number,
  nextWindowIso: string
): Promise<void> {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });

    // Requirement: If Slack isn't connected, silently do nothing (no crash)
    if (!user || !user.slackWebhookUrl) {
      return;
    }

    const hourKey = new Date().toISOString().slice(0, 13); // e.g., "2026-11-24T06"
    const dedupeKey = `slack_notified:${senderEmail}:${hourKey}`;

    // Atomic set-if-not-exists for 1 hour
    const acquired = await redisConnection.set(dedupeKey, '1', 'EX', 3600, 'NX');
    if (!acquired) {
      return; // Already notified for this hour window
    }

    await axios.post(user.slackWebhookUrl, {
      text: `⚠️ *ReachInbox Rate Limit Alert*\n• *Sender:* \`${senderEmail}\`\n• *Hourly Limit Reached:* ${hourlyLimit} emails/hour\n• *Action:* Remaining queued jobs have been automatically rescheduled to the next available hour window starting at \`${nextWindowIso}\`.`,
    });

    console.log(`🔔 Live Slack rate-limit notification sent for ${senderEmail}`);
  } catch (error) {
    console.error('❌ Failed to send Slack notification (non-fatal):', error);
  }
}