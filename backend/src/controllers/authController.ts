import { Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import { prisma } from '../config/db';
import { getOrCreateSender } from '../config/mailer';
import { AuthRequest } from '../middleware/authMiddleware';

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export async function googleLogin(req: Request, res: Response): Promise<void> {
  try {
    const { credential } = req.body;
    if (!credential) {
      res.status(400).json({ error: 'Google ID token (credential) is required' });
      return;
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email || !payload.sub) {
      res.status(401).json({ error: 'Invalid Google token payload' });
      return;
    }

    const user = await prisma.user.upsert({
      where: { email: payload.email },
      update: {
        name: payload.name || payload.email.split('@')[0],
        avatarUrl: payload.picture || null,
      },
      create: {
        email: payload.email,
        name: payload.name || payload.email.split('@')[0],
        avatarUrl: payload.picture || null,
        googleId: payload.sub,
      },
    });

    // Provision default Ethereal sender if none exists yet
    await getOrCreateSender(user.id);

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        slackConnected: Boolean(user.slackWebhookUrl),
        slackChannel: user.slackChannel,
      },
    });
  } catch (error: any) {
    console.error('❌ Google login error:', error);
    res.status(401).json({ error: 'Google authentication failed', details: error.message });
  }
}

export async function getCurrentUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      include: { senders: true },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      slackConnected: Boolean(user.slackWebhookUrl),
      slackChannel: user.slackChannel,
      senders: user.senders.map((s) => ({
        id: s.id,
        email: s.email,
        hourlyLimit: s.hourlyLimit,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
}

export async function getSlackAuthUrl(req: AuthRequest, res: Response): Promise<void> {
  const clientId = process.env.SLACK_CLIENT_ID;
  const redirectUri = encodeURIComponent(
    process.env.SLACK_REDIRECT_URI || 'http://localhost:5000/api/auth/slack/callback'
  );
  const state = req.user!.userId; // Pass userId in state to bind webhook on callback

  const url = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=incoming-webhook,chat:write&redirect_uri=${redirectUri}&state=${state}`;
  res.json({ url });
}

export async function slackOAuthCallback(req: Request, res: Response): Promise<void> {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  try {
    const { code, state } = req.query;
    if (!code || !state) {
      res.redirect(`${frontendUrl}?slack=error`);
      return;
    }

    const response = await axios.post(
      'https://slack.com/api/oauth.v2.access',
      new URLSearchParams({
        client_id: process.env.SLACK_CLIENT_ID || '',
        client_secret: process.env.SLACK_CLIENT_SECRET || '',
        code: String(code),
        redirect_uri:
          process.env.SLACK_REDIRECT_URI || 'http://localhost:5000/api/auth/slack/callback',
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    if (!response.data.ok || !response.data.incoming_webhook?.url) {
      console.error('❌ Slack OAuth error response:', response.data);
      res.redirect(`${frontendUrl}?slack=error`);
      return;
    }

    await prisma.user.update({
      where: { id: String(state) },
      data: {
        slackWebhookUrl: response.data.incoming_webhook.url,
        slackChannel: response.data.incoming_webhook.channel || '#general',
      },
    });

    res.redirect(`${frontendUrl}?slack=connected`);
  } catch (error) {
    console.error('❌ Slack OAuth callback exception:', error);
    res.redirect(`${frontendUrl}?slack=error`);
  }
}

export async function disconnectSlack(req: AuthRequest, res: Response): Promise<void> {
  try {
    await prisma.user.update({
      where: { id: req.user!.userId },
      data: {
        slackWebhookUrl: null,
        slackChannel: null,
      },
    });
    res.json({ message: 'Slack disconnected successfully', slackConnected: false });
  } catch (error) {
    res.status(500).json({ error: 'Failed to disconnect Slack' });
  }
}