# Edgelink SEO Automation Dashboard

A production-grade, enterprise-ready **SEO Automation Dashboard** built for the **Edgelink Technology AI Developer & Automation Engineer** technical assessment.

This application combines high-performance server-side web crawling, asynchronous job processing via **BullMQ** and **Upstash Redis**, AI-grounded technical analysis with **Anthropic Claude**, automated headless **Puppeteer PDF reporting**, and a secure **recurring cron audit scheduler**.

---

## Architecture Overview

```
                                      ┌─────────────────────────────────────────────────────────┐
                                      │              Next.js 14 App Router UI                   │
                                      │    • Client Dashboard (/client)  • Admin Portal (/admin)│
                                      └────────────────────────────┬────────────────────────────┘
                                                                   │
                                                                   ▼
┌─────────────────────────────────┐   HTTP POST /api/audits        │       POST /api/cron/audits
│   External Scheduler            ├───► (Zod Validation, Session, ◄───────────────┬────────────
│   • cron-job.org (1-min cron)   │     Anti-CSRF, Rate Limiting)                  │
│   • Local curl test script      │                                                │
└─────────────────────────────────┘                                                ▼
                                                                  ┌─────────────────────────────────┐
                                                                  │  Scheduled Audit Runner         │
                                                                  │  • Atomic Claim Lock            │
                                                                  │  • calculateNextRun() (UTC)     │
                                                                  └────────────────┬────────────────┘
                                                                                   │
                                                                                   ▼
                                                       ┌───────────────────────────────────────────┐
                                                       │        PostgreSQL Database (Neon Cloud)   │
                                                       │  • Audit (QUEUED, CRAWLING, COMPLETED)    │
                                                       │  • ScheduledAudit (WEEKLY / MONTHLY)      │
                                                       │  • User, Session, NotificationDelivery   │
                                                       └─────────────────────┬─────────────────────┘
                                                                             │
                                                                             ▼ Enqueue Job (jobId: audit-${id})
                                                       ┌───────────────────────────────────────────┐
                                                       │          Upstash Redis (BullMQ TLS)       │
                                                       └─────────────────────┬─────────────────────┘
                                                                             │
                                                                             ▼ Worker Process (auditWorker.ts)
┌────────────────────────────────────────────────────────────────────────────┴────────────────────────────────────┐
│ 1. Cheerio Crawler: HTML signals, headings, links, canonicals, robots.txt, sitemaps, Schema JSON-LD           │
│ 2. External Providers: PageSpeed Insights, Google Search Console, DataForSEO SERP                              │
│ 3. Claude AI Engine: Evidence-grounded synthesis, falsifiability checks, deterministic 5-category scoring      │
│ 4. PDF Reporting: Headless Puppeteer A4 generation, CSP isolation, secure streaming                            │
│ 5. Notifications: Multi-channel delivery (Email + Twilio WhatsApp) with PostgreSQL audit trail                │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack & Core Dependencies

| Component | Technology | Version | Purpose |
| :--- | :--- | :--- | :--- |
| **Framework** | Next.js (App Router) | `14.2.35` | Server-side rendering, API routes, React server components |
| **Language** | TypeScript (Strict) | `5.x` | End-to-end type safety and compile-time contract enforcement |
| **Database** | PostgreSQL (Neon Cloud) | `5.22.0` (Prisma) | Relational persistence, connection pooling via PgBouncer |
| **Queue & Cache** | BullMQ + Upstash Redis | `6.5.1` / `6.0.0` | Distributed asynchronous audit queue over TLS |
| **Crawler Engine** | Native Fetch + Cheerio | `1.2.0` | High-throughput DOM parsing, SSRF-guarded HTTP traversal |
| **AI Synthesis** | Anthropic Claude SDK | `1.3.0` | Model `claude-sonnet-4-6` with evidence prompt isolation |
| **PDF Reporting** | Puppeteer Headless | `25.16.0` | Server-side Chromium A4 print rendering with strict CSP |
| **Object Storage** | Cloudflare R2 / AWS S3 SDK | `3.1160.0` | S3-compatible cloud storage with local disk fallback |
| **Authentication** | Bcrypt + Secure Cookies | `3.0.3` | Password hashing, HttpOnly session tokens, CSRF HMAC |
| **Validation** | Zod | `3.x` | Runtime validation for API payloads, AI responses, and environment |

---

## Live vs. Mock Execution Architecture

The platform features a central execution switch (`USE_MOCKS`) providing two operational modes:

### 1. Deterministic Mock Mode (`USE_MOCKS="true"`)
- **Zero Third-Party API Keys Required:** Evaluators can run the entire system offline out of the box.
- **Exact Assessment Fixtures:** PageSpeed (Pune dental clinic mobile), Google Search Console (5 Pune dental queries), DataForSEO SERP (rank #4), and Twilio WhatsApp logger.
- **Deterministic AI Engine:** [`src/ai/mockAi.ts`](file:///src/ai/mockAi.ts) generates valid, evidence-grounded `ClaudeAuditResult` objects conforming strictly to the assessment Zod schema.
- **Visual Labeling:** Displays amber badges `MOCK Claude (Offline Engine)` in the Client Dashboard, Admin Portal, and PDF reports.

### 2. Live Production Mode (`USE_MOCKS="false"`)
- **Real External APIs:** Calls real Anthropic Claude API (`claude-sonnet-4-6`) and live web targets.
- **Zero Silent Fallbacks:** If external provider keys or Anthropic API credentials are missing, unconfigured, or invalid, the engine fails explicitly (`ClaudeNotConfiguredError`, `ProviderNotConfiguredError`) and transitions the audit to `FAILED`. It **never** silently falls back to fake scores in live mode.
- **Visual Labeling:** Displays green badges `REAL Claude (2026.1)` in the Client Dashboard, Admin Portal, and PDF reports.

---

## Security & Defense-in-Depth

1. **SSRF & DNS Rebinding Defenses:**
   - Protocol restriction: Only `http:` and `https:` schemes accepted; embedded credentials (`user:pass@`) rejected.
   - Host validation: Blocks `localhost`, `*.local`, `*.internal`, and private IP ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.169.254`).
   - Manual redirect tracking: Inspects every intermediate redirect hop against the SSRF policy before fetching.
2. **Production CRON Security (`src/lib/cronAuth.ts`):**
   - In production (`NODE_ENV=production`), `CRON_SECRET` must be explicitly configured with a secure, non-default value.
   - The predictable development fallback (`dev-cron-secret-12345`) is strictly rejected and fails closed (HTTP 401 Unauthorized).
   - In development/test, dev defaults are permitted to facilitate immediate local testing.
3. **Session & Anti-CSRF Security:**
   - Passwords hashed with `bcryptjs` (salt rounds: 10).
   - Server-persisted session tokens in PostgreSQL issued via `HttpOnly`, `SameSite=Lax`, `Secure` cookies (`edgelink_session`).
   - State-changing endpoints require an HMAC-SHA256 signature (`x-csrf-token`) cryptographically bound to the session token.
4. **Rate Limiting:**
   - Sliding-window rate limiters backed by Redis (with memory fallback) safeguard authentication, audit submissions, and cron invocations (max 60/min).

---

## Cron-Job.org & Recurring Audit Scheduling

The platform features an automated audit scheduler (`POST /api/cron/audits`) designed for recurring site health checks.

### Assessment Specification & Frequency
- **Recommended Cadence:** Every minute (`* * * * *`) per original assessment specification.
- **Status:** **Pending Manual External Configuration.** The endpoint and queueing logic are complete, but cron-job.org is **not** claimed to be live-connected until configured by the operator.
- **Public Reachability Context:** A public HTTPS URL is required **only** if an external third-party service (like cron-job.org) is triggering the endpoint over the internet.
- **Submission Notice:** Purchasing a custom domain or deploying to a public cloud provider is **not mandatory for assessment submission**. Evaluators can test scheduled audit processing locally.

### Manual cron-job.org Dashboard Setup Instructions
1. Log in to [cron-job.org](https://cron-job.org).
2. Click **CREATE CRONJOB**:
   - **Title:** `Edgelink SEO Scheduled Audits`
   - **URL:** `https://<YOUR-PRODUCTION-DOMAIN>/api/cron/audits`
   - **Schedule:** `Every minute` (`* * * * *`)
   - **Request Method:** `POST`
   - **Headers:**
     - Key: `Authorization`
     - Value: `Bearer <YOUR_CRON_SECRET>`
   - **Request Timeout:** `30 seconds`
3. Click **CREATE**.

### Local Execution & Testing Command:
```bash
curl -X POST http://localhost:3000/api/cron/audits \
  -H "Authorization: Bearer dev-cron-secret-12345" \
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

## Local Setup & Quickstart Guide

### Prerequisites
- **Node.js:** v18.17+ (v20+ recommended)
- **Package Manager:** npm or pnpm
- **PostgreSQL:** Neon Cloud connection string (or local PostgreSQL)
- **Redis:** Upstash Redis connection string (or local Redis instance)

### 1. Clone & Install Dependencies
```bash
git clone <repository-url>
cd "SEO Automation Dashboard"
npm install
```

### 2. Configure Environment Variables
Copy the template to `.env`:
```bash
cp .env.example .env
```
Configure your environment variables in `.env`:
```env
# Application Mode
NODE_ENV=development
NEXT_PUBLIC_APP_URL="http://localhost:3000"

# Neon PostgreSQL Database
DATABASE_URL="postgresql://user:password@ep-young-voice-pooler.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
DIRECT_URL="postgresql://user:password@ep-young-voice-pooler.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require"

# Upstash Redis (BullMQ TLS)
REDIS_URL="rediss://default:***@ruling-longhorn.upstash.io:6379"

# Central Execution Switch ("true" for offline mock, "false" for live API)
USE_MOCKS="true"

# Anthropic Claude API (required if USE_MOCKS="false")
ANTHROPIC_API_KEY="sk-ant-..."
ANTHROPIC_MODEL="claude-sonnet-4-6"

# Cron & Admin Authentication
CRON_SECRET="dev-cron-secret-12345"
ADMIN_SECRET_KEY="dev-admin-secret"
```

### 3. Synchronize Database Schema
```bash
npm run prisma:generate
npm run prisma:push
```

### 4. Run Development Server & Worker Process
Start the web application and queue worker in separate terminals:

```bash
# Terminal 1: Start Next.js App Router Web Server
npm run dev

# Terminal 2: Start persistent BullMQ Queue Worker
npm run worker:dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.
- **Client Portal:** `http://localhost:3000/client`
- **Admin Operations:** `http://localhost:3000/admin` (Key: `dev-admin-secret`)

---

## Automated Test Suites

Execute automated regression suites for any phase:

```bash
# Run all automated test suites sequentially
npm run test

# Mock Fixtures & Provider Abstractions
npm run test:mocks

# Fetch + Cheerio Crawler & SSRF Defenses
npm run test:crawler

# BullMQ Queue & Worker Retry Optimization
npm run test:queue

# Claude AI Analysis Engine & Deterministic Scoring
npm run test:ai

# End-to-End API Integration & Stalled Reconciliation
npm run test:integration

# Admin Operations Portal & RBAC
npm run test:admin

# Client Dashboard & Result Experience
npm run test:client

# Headless PDF Generation & Notification Dispatch
npm run test:reports

# Security Hardening, Cron Atomic Claims & Storage
npm run test:phase11

# Code Hygiene & Strict Types
npm run type-check
npm run lint

# Optimized Production Build
npm run build
```

---

## API Reference

| Endpoint | Method | Auth / Headers | Description |
| :--- | :---: | :--- | :--- |
| `/api/auth/register` | `POST` | Public | Register client account with Bcrypt password hashing |
| `/api/auth/login` | `POST` | Public | Authenticate user & issue HttpOnly session cookie |
| `/api/auth/logout` | `POST` | Session Cookie | Invalidate server session and clear cookie |
| `/api/auth/me` | `GET` | Session Cookie | Retrieve verified user identity & CSRF token |
| `/api/audits` | `POST` | Session + CSRF | Enqueue new website audit in BullMQ |
| `/api/audits` | `GET` | Session Cookie | Paginated audit list scoped to authenticated client |
| `/api/audits/:id` | `GET` | Session Cookie | Retrieve individual audit status, score, and AI report |
| `/api/audits/:id/report` | `GET` | Session Cookie | Stream or download generated A4 PDF report |
| `/api/audits/:id/notifications` | `GET` | Session Cookie | Retrieve notification delivery audit trail |
| `/api/schedules` | `POST` | Session + CSRF | Create recurring WEEKLY or MONTHLY audit schedule |
| `/api/schedules/:id` | `PATCH`| Session + CSRF | Pause or resume recurring schedule |
| `/api/schedules/:id/run`| `POST` | Session + CSRF | Trigger immediate manual execution ("Run Now") |
| `/api/cron/audits` | `POST` | `Bearer <CRON_SECRET>` | Atomic scheduler webhook for due recurring audits |
| `/api/admin/overview` | `GET` | `x-admin-key` | Aggregated system metrics & real-time queue health |
| `/api/admin/audits` | `GET` | `x-admin-key` | Global paginated audit management with search & filter |
| `/api/admin/audits/:id/retry` | `POST` | `x-admin-key` | Safely retry failed audits into BullMQ queue |
| `/api/admin/users` | `GET` / `PATCH` | `x-admin-key` | User listing and role management (CLIENT ↔ ADMIN) |
| `/api/health` | `GET` | Public | Platform health check for PostgreSQL and Redis |

---


