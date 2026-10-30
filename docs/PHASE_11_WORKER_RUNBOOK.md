# PHASE 11 WORKER RUNBOOK — OPERATIONAL & RELIABILITY GUIDE
## Edgelink Technology SEO Automation Dashboard

**Date:** October 30, 2026  
**Service:** Background Audit Worker (`seo-audit-queue`)  
**Entrypoint:** `src/workers/startWorker.ts` (`npm run worker`)

---

## 1. Worker Overview

The background worker is a dedicated Node.js service responsible for executing compute-heavy, asynchronous SEO audit workflows:

1. **Cheerio-based On-Page Crawler:** Extracts meta tags, heading hierarchies, images, canonical links, robots directives, sitemaps, and Schema JSON-LD.
2. **Anthropic Claude AI Analysis:** Generates scores (0–100), breakdown weights, executive summaries, critical issues, and actionable recommendations.
3. **Headless Puppeteer PDF Generator:** Renders printable A4 reports with charts, gauges, and tables into binary PDF documents.
4. **Cloudflare R2 / Local Storage:** Persists reports and issues download URLs.
5. **Notification Dispatch:** Dispatches Email and Twilio WhatsApp notifications.

---

## 2. Worker Lifecycle & Reliability Features

### 2.1 Startup Reconciler
Upon process startup, the worker runs `AuditService.reconcileStalledAudits(15)`:
- Scans PostgreSQL for audits left in `CRAWLING` or `ANALYZING` state for more than 15 minutes (typically caused by prior worker crashes or host restarts).
- Reconciles orphaned audits to `FAILED` with error message `"Audit timed out or stalled during processing."`
- Prevents clients from seeing infinite loading spinners on interrupted audits.

### 2.2 Graceful Shutdown Protocol
When receiving OS termination signals (`SIGINT` or `SIGTERM`):
1. Stops accepting new jobs from BullMQ.
2. Allows currently active jobs up to 10 seconds to complete cleanly.
3. Closes BullMQ worker instance (`worker.close()`).
4. Disconnects Prisma PostgreSQL client (`prisma.$disconnect()`).
5. Closes Redis TLS connections (`closeRedisConnections()`).
6. If cleanup exceeds 10 seconds, a forced process exit (`process.exit(1)`) triggers to avoid hanging deploys.

### 2.3 Automatic Heartbeat & Metrics Logging
Every 60 seconds, the worker logs current queue operational metrics:
```
[Worker Heartbeat] Queue Health -> waiting: 0, active: 1, completed: 52, failed: 1
```

---

## 3. Operational Commands

### 3.1 Starting the Worker
```bash
# Production mode:
npm run worker

# Development mode with tsx hot-reloading:
npm run worker:dev
```

### 3.2 Checking Worker Health
Query the unified health endpoint from the web application:
```bash
curl -s http://localhost:3000/api/health | jq .
```
Verify:
- `services.database` is `"connected"`.
- `services.redis` is `"connected"`.
- `services.queue.counts.active` and `waiting` are within expected ranges.

### 3.3 Inspecting Worker Logs (Systemd / PM2)
```bash
# If running under systemd:
sudo journalctl -u edgelink-worker -f -n 100

# If running under PM2:
pm2 logs edgelink-worker --lines 100
```

---

## 4. Troubleshooting Guide

| Symptom | Root Cause | Resolution |
|---|---|---|
| **Jobs stuck in `active` state** | Host killed worker before job completed, or Puppeteer hung. | Restart the worker process. The startup reconciler will transition any audits stalled > 15 minutes to `FAILED`. |
| **`Can't reach database server` on startup** | Neon serverless database is scaling up from zero. | The worker startup reconciler includes exponential backoff retries. Verify Neon connection string in `.env`. |
| **`Connection is closed` (Upstash Redis)** | Upstash closed idle TLS socket or network partitioned. | BullMQ and ioredis reconnect automatically. Worker has built-in retry listeners. |
| **Puppeteer high memory usage** | PDF generation launches Chromium instances. | Worker concurrency is limited to 2 jobs per process. Ensure container has at least 1 GB RAM. Chromium instances are strictly closed in `finally` blocks. |
| **`Job locked by another worker`** | Two workers attempting to process the same deterministic job ID. | Normal BullMQ deduplication behavior. Redundant executions are skipped safely. |
