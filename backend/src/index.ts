import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes';
import emailRoutes from './routes/emailRoutes';
import { initElasticsearchIndex } from './config/elasticsearch';
import {
  serverAdapter,
  startEmailWorker,
  recoverScheduledJobsOnStartup,
} from './queues/emailQueue';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 5000;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  })
);
app.use(express.json({ limit: '5mb' }));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ReachInbox Email Scheduler' });
});

// Live BullMQ Queue Dashboard
app.use('/admin/queues', serverAdapter.getRouter());

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/emails', emailRoutes);

async function bootstrap() {
  await initElasticsearchIndex();
  startEmailWorker();
  await recoverScheduledJobsOnStartup();

  app.listen(PORT, () => {
    console.log(`🚀 Backend server running on http://localhost:${PORT}`);
    console.log(`📊 Live BullMQ Dashboard available at http://localhost:${PORT}/admin/queues`);
  });
}

bootstrap().catch((err) => {
  console.error('❌ Fatal startup error:', err);
  process.exit(1);
});