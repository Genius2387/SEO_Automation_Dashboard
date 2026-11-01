# PHASE 11 DEPLOYMENT GUIDE — PRODUCTION ARCHITECTURE & RUNBOOK
## Edgelink Technology SEO Automation Dashboard

**Date:** October 30, 2026  
**Document Version:** 1.0.0  
**Target Environment:** Production (Node.js 18+ / 20 LTS)

---

## 1. High-Level Production Architecture

The Edgelink SEO Automation Dashboard is engineered as a decoupled, multi-process production system:

```
                          ┌───────────────────────────┐
                          │   cron-job.org / Cron     │
                          │   (Scheduled Invocations) │
                          └─────────────┬─────────────┘
                                        │ POST /api/cron/audits
                                        ▼ (CRON_SECRET)
┌───────────────────────┐         ┌───────────────────────────┐
│     Client / Admin    ├────────►│    Next.js Web Server     │
│   (Browser / HTTPS)   │         │ (Vercel / Node Container) │
└───────────────────────┘         └──────┬─────────────┬──────┘
                                         │             │
                ┌────────────────────────┼─────────────┼────────────────────────┐
                │                        │             │                        │
                ▼                        ▼             ▼                        ▼
      ┌──────────────────┐     ┌──────────────────┐  ┌──────────────────┐ ┌──────────────────┐
      │ Neon PostgreSQL  │     │  Upstash Redis   │  │  Cloudflare R2   │ │ External APIs    │
      │ (Prisma Sessions,│     │  (BullMQ Queue & │  │  (PDF Report     │ │ (Claude, Twilio, │
      │  Audits, Config) │     │   Rate Limiting) │  │   Object Store)  │ │  Email SMTP)     │
      └─────────▲────────┘     └─────────▲────────┘  └────────▲─────────┘ └──────────────────┘
                │                        │                    │
                │                        │                    │
                └────────────────────────┼────────────────────┘
                                         │
                          ┌──────────────┴────────────┐
                          │  Persistent Node.js Worker│
                          │   (Railway / Render / VPS)│
                          │    `npm run worker`       │
                          └───────────────────────────┘
```

### Process Separation:
1. **Next.js Web Application (Stateless):**
   - Deployed on Vercel, Railway, AWS ECS, or any Node.js container host.
   - Handles HTTP routing, React SSR/CSR, authentication sessions, rate limiting, and API endpoints.
   - Enqueues background audit jobs into Redis; does **not** run long crawlers or Puppeteer inside request cycles.
2. **Persistent BullMQ Worker Process (Stateful & Long-Running):**
   - Deployed on persistent container hosting (e.g., Railway persistent service, Render Background Worker, Fly.io, or Linux VPS with systemd/PM2).
   - Runs `npm run worker` (`tsx src/workers/startWorker.ts`).
   - Executes Cheerio SEO crawler, Anthropic Claude AI scoring, Puppeteer PDF generation, and notification delivery.
   - Automatically reconnects to Upstash Redis and reconciles stalled jobs upon startup.

---

## 2. Infrastructure Requirements & Configuration

### 2.1 Database: Neon PostgreSQL
- **Connection Strings:**
  - `DATABASE_URL`: Pooled connection string with `?sslmode=require&channel_binding=require` for application runtime queries (e.g., PgBouncer / Neon pooler).
  - `DIRECT_URL`: Non-pooled direct database connection string used for schema pushes and migrations (`prisma db push` / `prisma migrate deploy`).
- **Schema Synchronization Command:**
  ```bash
  npx prisma db push --skip-generate
  npx prisma generate
  ```

### 2.2 Redis & Queue: Upstash Redis
- Requires TLS connection string (`rediss://...`).
- Used by BullMQ (`seo-audit-queue`) and sliding-window rate limiters.
- Worker concurrency is configured to 2 parallel audits per worker instance to preserve CPU and memory limits during Puppeteer execution.

### 2.3 Cloudflare R2 Storage (S3-Compatible)
- PDF audit reports are saved to a private Cloudflare R2 bucket.
- Endpoint format: `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`.
- Presigned download URLs are generated with short-lived expiration (default: 900 seconds / 15 minutes).
- If R2 credentials are unset or absent, storage automatically falls back to local disk (`storage/reports/<auditId>.pdf`) with zero disruption to audits.

---

## 3. Environment Variables Reference

Populate the following environment variables in production settings:

| Variable | Required | Description | Example / Recommendation |
|---|---|---|---|
| `NODE_ENV` | Yes | Application mode (`production` strictly disables `x-user-id` bypass) | `production` |
| `NEXT_PUBLIC_APP_URL` | Yes | Canonical public URL used in report links and email notifications | `https://seo.yourdomain.com` |
| `DATABASE_URL` | Yes | Neon pooled connection string | `postgresql://user:pass@ep-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require` |
| `DIRECT_URL` | Yes | Neon direct unpooled connection string | `postgresql://user:pass@ep-direct.us-east-2.aws.neon.tech/neondb?sslmode=require` |
| `REDIS_URL` | Yes | Upstash Redis TLS connection string | `rediss://default:token@xyz.upstash.io:6379` |
| `ANTHROPIC_API_KEY` | Yes | Anthropic Claude API key for AI SEO analysis | `sk-ant-api03-...` |
| `ANTHROPIC_MODEL` | No | Claude model name | `claude-sonnet-4-6` |
| `USE_MOCKS` | Yes | Live crawler and live AI toggle | `false` in production; `true` for offline staging |
| `CRON_SECRET` | Yes | Cryptographic shared bearer token for `/api/cron/audits` | 32+ character random hex string |
| `ADMIN_SECRET_KEY` | Yes | Master administrative secret key | 32+ character random hex string |
| `SESSION_SECRET` | Yes | HMAC secret for session and anti-CSRF token signing | 64+ character random hex string |
| `CSRF_SECRET` | No | Secondary HMAC salt for CSRF generation | 64+ character random hex string |
| `REPORT_STORAGE_PROVIDER` | No | `r2` for Cloudflare R2 or `local` for local disk | `r2` |
| `R2_ACCOUNT_ID` | Optional | Cloudflare Account ID | `9a8b7c6d5e4f...` |
| `R2_ACCESS_KEY_ID` | Optional | R2 API token Access Key ID | `f4e3d2c1...` |
| `R2_SECRET_ACCESS_KEY` | Optional | R2 API token Secret Access Key | `abc123secret...` |
| `R2_BUCKET_NAME` | Optional | Private R2 bucket name | `edgelink-reports-production` |
| `TWILIO_ACCOUNT_SID` | Optional | Twilio account identifier for WhatsApp dispatch | `ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` |
| `TWILIO_AUTH_TOKEN` | Optional | Twilio authentication token | `your_twilio_token` |
| `TWILIO_WHATSAPP_NUMBER` | Optional | Twilio sender WhatsApp number | `whatsapp:+14155238886` |
| `EMAIL_PROVIDER` | Optional | Email service (`smtp` or `resend`) | `smtp` |
| `SMTP_HOST` | Optional | Outgoing SMTP server hostname | `smtp.mailgun.org` |
| `SMTP_PORT` | Optional | Outgoing SMTP server port | `587` |
| `SMTP_USER` | Optional | Outgoing SMTP username | `postmaster@yourdomain.com` |
| `SMTP_PASS` | Optional | Outgoing SMTP password | `smtp_password` |
| `EMAIL_FROM` | Optional | Sender address for audit notifications | `EdgeLink Reports <reports@yourdomain.com>` |

---

## 4. Web Application Deployment (e.g. Vercel / Railway)

### 4.1 Deployment Commands
```bash
# 1. Install production dependencies
npm ci

# 2. Generate Prisma Client
npx prisma generate

# 3. Synchronize database schema
npx prisma db push --skip-generate

# 4. Build optimized Next.js production bundle
npm run build

# 5. Start Next.js production server
npm start
```

### 4.2 Health Check Verification
Verify web server and database/Redis connectivity:
```bash
curl -i https://seo.yourdomain.com/api/health
```
Expected HTTP 200 response:
```json
{
  "status": "healthy",
  "ok": true,
  "services": {
    "database": "connected",
    "redis": "connected",
    "queue": { "waiting": 0, "active": 0, "completed": 45, "failed": 0 }
  }
}
```

---

## 5. Background Worker Deployment (Persistent Host)

> [!IMPORTANT]
> The background worker is a persistent Node.js process and **CANNOT** be deployed as a Vercel Serverless Function. It must be hosted on a persistent container or VPS.

### 5.1 Systemd Service Configuration (Linux VPS)
Create `/etc/systemd/system/edgelink-worker.service`:
```ini
[Unit]
Description=EdgeLink SEO Background Worker
After=network.target

[Service]
Type=simple
User=node
WorkingDirectory=/opt/edgelink/seo-automation-dashboard
Environment=NODE_ENV=production
EnvironmentFile=/opt/edgelink/seo-automation-dashboard/.env
ExecStart=/usr/bin/npm run worker
Restart=always
RestartSec=5s
KillSignal=SIGTERM
TimeoutStopSec=15s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Enable and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable edgelink-worker
sudo systemctl start edgelink-worker
sudo systemctl status edgelink-worker
```

### 5.2 PM2 Process Manager Configuration
Create `ecosystem.config.js`:
```javascript
module.exports = {
  apps: [
    {
      name: "edgelink-worker",
      script: "src/workers/startWorker.ts",
      interpreter: "node",
      interpreter_args: "--import tsx",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
```
Start worker with PM2:
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 logs edgelink-worker
```

---

## 6. Recurring Cron Job Configuration (cron-job.org / External Scheduler)

> [!NOTE]
> **Setup Status: Pending Manual External Setup**
> The `/api/cron/audits` endpoint, atomic claim lock, and BullMQ queue integration are fully implemented and verified. External scheduling via cron-job.org remains pending manual configuration in the cron-job.org dashboard once a public URL is available. It is **not** live-connected out of the box.
>
> **Important Assessment & Deployment Note:**
> Purchasing a custom domain or deploying to a public cloud provider is **not mandatory for assessment submission**. For evaluation and local development, the cron endpoint can be tested directly on `http://localhost:3000/api/cron/audits` using curl or the automated test suite (`npm run test:phase11`). A publicly accessible HTTPS URL is required *only* if and when you want third-party web services like cron-job.org to execute scheduled triggers over the public internet.

To trigger scheduled audits automatically via an external scheduler (e.g. [cron-job.org](https://cron-job.org)):

- **Target URL:** `https://<YOUR-DOMAIN>/api/cron/audits` (or `http://localhost:3000/api/cron/audits` for local testing)
- **Method:** `POST`
- **Headers:**
  - `Authorization`: `Bearer <YOUR_CRON_SECRET>`
  - `Content-Type`: `application/json`
- **Frequency:** Every minute (`* * * * *`) per original assessment specification
- **Request Timeout:** 30 seconds

### Local Verification Command:
```bash
curl -X POST http://localhost:3000/api/cron/audits \
  -H "Authorization: Bearer <CRON_SECRET>" \
  -H "Content-Type: application/json"
```

Expected response:
```json
{
  "success": true,
  "message": "Processed 2 due schedule(s). Created 2 audit(s).",
  "stats": {
    "schedulesChecked": 2,
    "auditsCreated": 2,
    "jobsQueued": 2,
    "duplicatesSkipped": 0,
    "failures": 0,
    "executedAt": "2026-10-31T12:00:00.000Z"
  }
}
```

---

## 7. Rollback & Disaster Recovery Procedures

1. **Application Rollback:**
   - In Vercel / Railway: Select the previous stable deployment and click **Redeploy / Instant Rollback**.
2. **Database Rollback:**
   - Database schema changes in Phase 11 were strictly additive (`Session` table, `ScheduledAudit` table, `passwordHash` column). No breaking schema changes or dropped tables occurred. Rolling back code will not corrupt older data.
   - Point-in-time recovery (PITR) is enabled natively in Neon Console.
3. **Queue Purge (Emergency):**
   ```bash
   # If corrupted jobs block the worker, drain the queue via Redis CLI:
   redis-cli -u rediss://... flushdb
   ```
