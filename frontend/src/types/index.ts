export interface Sender {
  id: string;
  email: string;
  hourlyLimit: number;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  slackConnected: boolean;
  slackChannel?: string | null;
  senders?: Sender[];
}

export type EmailStatus = 'SCHEDULED' | 'PROCESSING' | 'SENT' | 'FAILED' | 'RATE_LIMITED';

export interface EmailJobItem {
  id: string;
  recipientEmail: string;
  subject: string;
  body: string;
  scheduledAt: string;
  sentAt?: string | null;
  status: EmailStatus;
  delayMs: number;
  hourlyLimit: number;
  errorMessage?: string | null;
  sender?: {
    email: string;
  };
  senderEmail?: string;
}