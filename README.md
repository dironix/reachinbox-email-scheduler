# ReachInbox — Full-Stack Email Job Scheduler

A production-grade, persistent cold-email scheduling service and dashboard built with **TypeScript, Express.js, BullMQ, Redis, PostgreSQL (Prisma), Elasticsearch, and React (Vite + Tailwind CSS)**.

---

## 1. Architecture Overview

### How Scheduling Works (Zero Cron Jobs)
- When a user schedules a campaign via the UI or `POST /api/emails/schedule`, each recipient is persisted as an `EmailJob` row in **PostgreSQL**, indexed into **Elasticsearch**, and enqueued into **BullMQ** (`email-send-queue`) as a delayed job (`delay = max(0, targetTimestamp - now)`).
- No `node-cron`, `agenda`, or OS `crontab` is used anywhere in the system.

### Persistence Across Server Restarts & Idempotency
1. **Redis AOF Persistence:** Redis runs with `--appendonly yes`, preserving all delayed and waiting BullMQ jobs on disk across process or container restarts.
2. **PostgreSQL Source of Truth + Startup Recovery:** On server boot, `recoverScheduledJobsOnStartup()` queries PostgreSQL for any `SCHEDULED` or `RATE_LIMITED` records not currently queued in Redis and re-enqueues them using their database UUID as the BullMQ `jobId`.
3. **Strict Idempotency:** Every BullMQ job uses `jobId = emailJob.id` (preventing duplicate queue entries), and the worker checks `emailRecord.status === 'SENT'` before calling SMTP so an email can never be sent twice.

### Rate Limiting, Concurrency & Behavior Under Load
- **Configurable Concurrency:** The BullMQ worker processes jobs concurrently (`WORKER_CONCURRENCY`, default `5`).
- **Minimum Delay Between Sends:** Each job enforces a configurable per-email throttle (`DEFAULT_MIN_DELAY_MS = 2000ms`, customizable per campaign in the UI) to mimic provider throttling.
- **Distributed Atomic Hourly Rate Limiting:** Multiple concurrent workers coordinate via atomic Redis `INCR` counters keyed by `rate_limit:<senderId>:<YYYY-MM-DD-HH>` with a `3700s` TTL.
- **Behavior Under Load (1,000+ Emails / Quota Exceeded):**
  - Jobs are never dropped or permanently failed when an hourly quota is hit.
  - Excess jobs are moved back into BullMQ's delayed set (`job.moveToDelayed(nextHourTimestamp + staggerOffset)` + `DelayedError`) for the next available UTC hour window while preserving sequence order.
  - A Redis `SET NX` lock (`slack_notified:<senderEmail>:<hourWindow>`) ensures the sender's connected Slack channel receives a single live alert per hour window without worker spam.

---

## 2. Features Implemented

### Backend (`backend/`)
- **Persistent BullMQ Delayed Scheduler:** Multi-sender Ethereal SMTP delivery via Nodemailer (`createTestAccount()`).
- **Concurrency & Rate Limiting:** Configurable worker concurrency, per-email delay throttling, and Redis-backed per-sender hourly limits with next-hour rescheduling.
- **Live Slack OAuth & Alerts:** Real OAuth 2.0 flow (`/api/auth/slack/connect` & `/callback`), disconnect support, and live webhook alerts upon hitting hourly limits.
- **Elasticsearch Search:** Automatic indexing on create/send/fail and fuzzy multi-field search (`GET /api/emails/search`).
- **Live Queue Monitor:** Integrated `@bull-board/express` dashboard mounted at `/admin/queues`.

### Frontend (`frontend/`)
- **Real Google OAuth 2.0 Login:** `@react-oauth/google` verification with JWT session persistence and user header (name, email, avatar, logout).
- **Campaign Composer:** Client-side CSV/TXT email extraction (`papaparse`), multi-sender selector/creator, start time picker, delay-between-emails, and hourly limit controls.
- **Dashboard Views:** Real-time polling tabs for **Scheduled Emails** (including `Delayed (Rate Limit)` status) and **Sent Emails**, plus debounced Elasticsearch search, loading indicators, and empty states.

---

## 3. Local Setup Instructions

### Prerequisites
- Node.js v20+
- Docker Desktop (for PostgreSQL, Redis, and Elasticsearch)

### Step 1: Start Infrastructure (PostgreSQL, Redis, Elasticsearch)
```bash
docker compose up -d