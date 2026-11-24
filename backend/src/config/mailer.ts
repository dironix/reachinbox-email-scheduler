import nodemailer, { Transporter } from 'nodemailer';
import { prisma } from './db';

const transporterCache = new Map<string, Transporter>();

/**
 * Ensures a user has at least one Ethereal SMTP sender account,
 * or creates additional senders on demand.
 */
export async function getOrCreateSender(userId: string, preferredSenderId?: string) {
  if (preferredSenderId) {
    const existing = await prisma.sender.findFirst({
      where: { id: preferredSenderId, userId },
    });
    if (existing) return existing;
  }

  const userSenders = await prisma.sender.findMany({ where: { userId } });
  if (userSenders.length > 0) {
    return userSenders[0];
  }

  return createNewEtherealSender(userId);
}

export async function createNewEtherealSender(userId: string) {
  const testAccount = await nodemailer.createTestAccount();
  const sender = await prisma.sender.create({
    data: {
      userId,
      email: testAccount.user,
      smtpUser: testAccount.user,
      smtpPass: testAccount.pass,
      hourlyLimit: Number(process.env.MAX_EMAILS_PER_HOUR_PER_SENDER) || 50,
    },
  });
  console.log(`📧 Provisioned new Ethereal sender: ${sender.email}`);
  return sender;
}

export function getTransporterForSender(smtpUser: string, smtpPass: string): Transporter {
  if (transporterCache.has(smtpUser)) {
    return transporterCache.get(smtpUser)!;
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  transporterCache.set(smtpUser, transporter);
  return transporter;
}