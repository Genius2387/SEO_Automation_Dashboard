# Edgelink SEO Automation Dashboard

A production-minded, full-stack SEO Automation Dashboard built for the Edgelink Technology AI Developer & Automation Engineer technical assessment.

---

## Tech Stack Overview

- **Framework:** Next.js 14.2.35 (App Router)
- **Language:** TypeScript 5 (Strict)
- **Database & ORM:** PostgreSQL (Neon Cloud) with Prisma 5.22.0
- **Queue & In-Memory Store:** BullMQ with Upstash Redis (ioredis via TLS)
- **Crawler:** Native Fetch & Cheerio for HTML parsing and DOM metadata extraction
- **AI Intelligence:** Anthropic Claude API (`claude-sonnet-4-6`)
- **Reporting:** Headless Puppeteer for automated A4 PDF and HTML audit reports
- **Styling:** Tailwind CSS & shadcn/ui primitives (`cva`, `clsx`, `tailwind-merge`)
- **Validation:** Zod for runtime schema and environment variable validation

---

## Database Architecture & PostgreSQL Setup Guide

The application uses **Prisma 5.22.0** targeting **Neon PostgreSQL** on AWS.

### 1. Connection URLs & Pooling

The application utilizes two connection strings:
- `DATABASE_URL`: Pooled connection (PgBouncer) for high-throughput runtime queries.
- `DIRECT_URL`: Direct connection (port 5432) for schema synchronization (`prisma db push`) and migrations.

### 2. Environment Variables (.env)

```env
# Database Connections
DATABASE_URL="postgresql://neondb_owner:***@ep-young-voice-b49iacx6-pooler.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
DIRECT_URL="postgresql://neondb_owner:***@ep-young-voice-b49iacx6.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require"

# Execution Mode
USE_MOCKS="false" # "true" for mock mode, "false" for live database persistence

# Redis (Upstash via TLS)
REDIS_URL="rediss://default:***@ruling-longhorn-242290.upstash.io:6379"

# Anthropic Claude API
ANTHROPIC_API_KEY="sk-ant-..."
ANTHROPIC_MODEL="claude-sonnet-4-6"

# Cron & Application
CRON_SECRET="dev-cron-secret-12345"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

---

## Phase 3: Exact Mock Architecture & Provider Abstractions

The assessment PDF (pages 3–6) specifies mock fixtures and a central mock switch for external services.

### 1. Required Mock Files & Exact Datasets

All mock files reside in `src/mocks/` with exact CommonJS export contracts:

| Mock Integration | File Path | Description & Exact Fixture |
| :--- | :--- | :--- |
| **Central Switch** | `src/mocks/index.js` | Exports `USE_MOCKS` and mock modules |
| **PageSpeed Insights** | `src/mocks/pagespeed.mock.js` | `example-dental-clinic.com` (mobile), 3 categories, 5 Core Web Vital audits |
| **Google Search Console** | `src/mocks/gsc.mock.js` | 5 exact Pune dental clinic queries, totalClicks: 167, totalImpressions: 4560, indexCoverageErrors: 3 |
| **DataForSEO SERP** | `src/mocks/dataforseo.mock.js` | "dental clinic pune" 3 organic ranks, client_rank_position: 4, volume: 1900 |
| **Twilio WhatsApp** | `src/mocks/twilio.mock.js` | Async `sendWhatsApp(clientId, pdfPath, score)` logging prefixed details & returning `mock_sent` |

### 2. The `USE_MOCKS` Central Switch

The mock switch is governed by `process.env.USE_MOCKS === "true"`:

- **When `USE_MOCKS="true"`:**
  - `getPageSpeed()` returns the exact PageSpeed mobile fixture.
  - `getSearchConsoleData()` returns the exact 5-row GSC fixture.
  - `getDataForSEORankings()` returns the DataForSEO ranking fixture.
  - `sendWhatsApp()` logs to the console and returns `{ status: 'mock_sent', sid: 'MOCK_SID_...' }`.
  - Zero external third-party API credentials are required.

- **When `USE_MOCKS="false"` (Live Mode):**
  - Third-party integrations do **not** silently leak or return mock data.
  - If live API credentials (e.g. `PAGESPEED_API_KEY`, `DATAFORSEO_API_KEY`, `TWILIO_ACCOUNT_SID`) are not configured, provider calls throw an explicit `ProviderNotConfiguredError`.
  - External API calls are never faked.

### 3. Running Phase 3 Mock Contract Tests

Run the automated assertion suite:
```bash
npm run test:mocks
```
This tests:
1. Exact fixture integrity (every URL, score, query, and rank position).
2. Twilio WhatsApp logger prefixes and return shape.
3. Central `USE_MOCKS` switch behavior (returns fixtures when `true`, throws when `false`).
4. TypeScript and CommonJS module compatibility.

---

## Phase 4: SEO Crawler, Technical Checks, and Normalized Audit Data

Phase 4 introduces a security-hardened, server-side SEO analysis engine using native **Fetch + Cheerio**. The crawler extracts on-page SEO signals, audits technical indexing prerequisites (robots.txt, sitemap.xml), detects Schema.org structured data, and integrates external performance and ranking providers into a strictly normalized JSON contract suitable for downstream Claude synthesis and BullMQ workers.

### 1. Crawler Pipeline & Architecture

```
Target URL ──► SSRF & Protocol Validation ──► Bounded Fetch & Redirect Loop Check
                                                        │
                      ┌─────────────────────────────────┴─────────────────────────────────┐
                      ▼                                 ▼                                 ▼
             On-Page Cheerio Extraction         Technical SEO Checks             Schema.org & Microdata
           (Title, Meta, H1-H3, Img, Links)  (robots.txt, sitemap.xml, index)      (JSON-LD & Microdata)
                      │                                 │                                 │
                      └─────────────────────────────────┬─────────────────────────────────┘
                                                        ▼
                                           External Providers Integration
                                          (PageSpeed, GSC, DataForSEO)
                                                        │
                                                        ▼
                                            Findings Generation Engine
                                           (Deterministic Findings Array)
                                                        │
                                                        ▼
                                        Zod-Validated NormalizedAuditData
```

### 2. How to Call the Crawler Service

```typescript
import { crawlWebsite, NormalizedAuditData } from "@/crawlers";

// Calling in live mode or with mock data
const auditData: NormalizedAuditData = await crawlWebsite("https://example.com", {
  businessType: "Dentist",
  city: "Miami",
  state: "FL",
  keyword: "dentist miami",
  useMocks: false,      // true for mock fixtures, false for live fetch
  timeoutMs: 15000,     // abort after 15 seconds
  maxRedirects: 5,      // maximum allowed HTTP redirects
  maxSizeBytes: 5242880 // 5 MB maximum response size
});
```

### 3. Normalized Audit Data Structure

The returned `NormalizedAuditData` strictly conforms to `normalizedAuditDataSchema` (Zod) and retains full backward compatibility with the legacy `CrawlResult` interface:

```typescript
{
  // Target website metadata
  target: {
    originalUrl: string;
    normalizedUrl: string;
    finalUrl: string;
    businessType?: string | null;
    city?: string | null;
    state?: string | null;
  };

  // HTTP crawl metadata
  crawl: {
    status: "SUCCESS" | "FAILED" | "REDIRECT_ERROR" | "SECURITY_BLOCKED" | "TIMEOUT";
    httpStatus: number;
    contentType: string;
    durationMs: number;
    fetchedAt: string;
    redirectCount: number;
    redirectTrail: string[];
    errors: string[];
  };

  // On-page extraction
  onPage: {
    title: { text: string; exists: boolean; length: number; status: "OPTIMAL" | "TOO_SHORT" | "TOO_LONG" | "MISSING" };
    metaDescription: { text: string; exists: boolean; length: number; status: "OPTIMAL" | "TOO_SHORT" | "TOO_LONG" | "MISSING" };
    canonical: { url: string | null; count: number; isValid: boolean; matchesFinalUrl: boolean };
    headings: { h1: string[]; h2: string[]; h3: string[]; h1Count: number; h2Count: number; h3Count: number };
    images: { totalCount: number; withAltCount: number; missingAltCount: number; decorativeCount: number; sample: [...] };
    links: { totalInternal: number; totalExternal: number; emptyHrefCount: number; sampleInternal: [...]; sampleExternal: [...] };
    metadata: { metaRobots: string | null; xRobotsTag: string | null; lang: string | null; favicon: string | null; viewport: string | null; openGraph: {...}; wordCount: number };
  };

  // Technical SEO
  technical: {
    robotsTxt: { checked: boolean; url: string; exists: boolean; statusCode: number | null; isAccessible: boolean; sitemaps: string[]; isTargetDisallowed: boolean; matchedRule?: string };
    sitemap: { checked: boolean; discoveredUrls: string[]; primaryUrl: string | null; exists: boolean; statusCode: number | null; isXml: boolean; isSitemapIndex: boolean; urlCount: number; sampleUrls: string[] };
    indexabilitySignals: { isIndexable: boolean; reasons: string[] };
    findings: CrawlerFinding[];
  };

  // Structured Data
  schema: {
    jsonLdBlocksCount: number;
    jsonLdBlocks: Array<{ valid: boolean; raw: string; parsed?: any; types: string[]; error?: string }>;
    discoveredTypes: string[];
    hasMicrodata: boolean;
    microdataTypes: string[];
    findings: CrawlerFinding[];
  };

  // External Provider Data
  pageSpeed: { status: "available" | "unavailable" | "mock" | "error"; source: "mock" | "live" | "none"; data: PageSpeedResult | null; error?: string };
  searchConsole: { status: "available" | "unavailable" | "mock" | "error"; source: "mock" | "live" | "none"; data: GSCResult | null; error?: string };
  rankings: { status: "available" | "unavailable" | "mock" | "error"; source: "mock" | "live" | "none"; data: DataForSEOResult | null; error?: string };

  // Standardized SEO Findings
  findings: CrawlerFinding[];

  // Legacy CrawlResult compatibility (url, statusCode, title, metaDescription, h1, h2, images, links, issues)
  ...legacyProperties
}
```

### 4. Technical Checks Implemented

- **HTTP Response Verification:** Status codes, transport error separation, Content-Type verification (text/html or application/xhtml+xml), duration tracking.
- **robots.txt Evaluation:** Retrieval of `/robots.txt`, parser extracting `Sitemap:`, `Allow:`, and `Disallow:` directives for relevant user agents (`*`, `EdgelinkSEOAuditBot`, `Googlebot`), with path-matching evaluation for the audited target URL.
- **sitemap.xml Discovery & Parsing:** Checks declarations from robots.txt plus conventional `/sitemap.xml`, verifies XML format (`<urlset>` or `<sitemapindex>`), extracts bounded sample URLs, and flags non-XML responses or retrieval failures.
- **Indexability Analysis:** Evaluates `meta[name="robots"]`, `X-Robots-Tag` headers, HTTP status codes, and robots.txt disallow directives to compute deterministic indexability status and reasons.
- **Schema.org Structured Data:** Safe parsing of multiple `<script type="application/ld+json">` blocks, extraction of `@type` and nested `@graph` entities, isolation of JSON syntax errors without crashing, and detection of Microdata (`itemscope`, `itemtype`).
- **Core Web Vitals:** Evaluates LCP, CLS, and Render-Blocking metrics from PageSpeed provider data to generate actionable performance findings.

### 5. Security & SSRF Defenses

External website URLs provided by users are untrusted inputs. The crawler enforces comprehensive SSRF protections:

1. **Protocol Restriction:** Only `http:` and `https:` schemes are accepted. Protocols like `file:`, `ftp:`, `javascript:`, `gopher:`, and `data:` are rejected immediately.
2. **Credential Sanitization:** URLs with embedded credentials (`user:pass@host`) are blocked.
3. **Internal & Reserved Host Rejection:** Hostnames matching `localhost`, `*.localhost`, `*.local`, and `*.internal` are rejected.
4. **IP Literal & DNS Rebinding Protection:**
   - Both IPv4 and IPv6 addresses are checked against private and reserved CIDR blocks before fetching.
   - Blocks `127.0.0.0/8` (Loopback), `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (Private RFC 1918), `169.254.0.0/16` (Link-Local / AWS & GCP cloud instance metadata `169.254.169.254`), `100.64.0.0/10` (Carrier-grade NAT), `0.0.0.0/8`, multicast, and reserved ranges.
   - Resolves hostnames via `dns.lookup` and verifies all resolved IP addresses against private subnets.
5. **Redirect Destination Revalidation:** Uses `redirect: "manual"` to inspect each HTTP redirect (`301`, `302`, `307`, `308`). Every intermediate and final destination is revalidated against the SSRF policy before the next hop is requested. Detects redirect loops and enforces a strict `maxRedirects` limit (default 5).
6. **Resource Limits:** Request timeout via `AbortController` (default 15s) and maximum response size guard (default 5 MB) prevent denial-of-service and memory exhaustion.
7. **No JavaScript Execution:** Fetch + Cheerio parses static HTML without rendering JavaScript, preventing client-side script execution exploits.

### 6. Known Limitations

- **Client-Side Rendering (SPA):** Websites rendered exclusively via client-side JavaScript (e.g., pure React/Vue SPAs without SSR/SSG or pre-rendering) will not execute JavaScript during this crawl phase. Dynamic DOM elements rendered post-hydration will not be visible to Cheerio.
- **Single-Page Scope:** Phase 4 performs a bounded audit on the target URL (plus robots.txt and sitemap.xml). It does not recursively crawl all internal links across the domain.
- **Complex Robots.txt Directives:** Path matching supports prefix patterns and allow/disallow precedence; complex regex wildcard extensions (e.g. `*` within paths) are not fully simulated.

---

## Phase 5: BullMQ Queue & Worker Integration

Phase 5 establishes an asynchronous, distributed job processing architecture using **BullMQ** and **Upstash Redis** (over TLS), connecting API submission directly to background workers and persisting audit progress in **Neon PostgreSQL**.

### 1. Queue Architecture & Workflow

```
[Client / API] ──► POST /api/audits ──► [Neon PostgreSQL: Create Audit (QUEUED)]
                                     └──► [BullMQ: Add Job (deterministic jobId: audit-${auditId})]
                                                        │
                                                        ▼
                                           [Upstash Redis: TLS Queue]
                                                        │
                                                        ▼
                                       [Dedicated Node.js Worker Process]
                                                        │
                                                        ├──► Step 1: Validate payload & load DB record
                                                        ├──► Step 2: Transition DB status to CRAWLING
                                                        ├──► Step 3: Run Phase 4 crawlWebsite()
                                                        ├──► Step 4: Persist rawCrawlData in PostgreSQL
                                                        └──► Step 5: Transition DB status to COMPLETED
```

### 2. How to Start the Web App & Worker Locally

The Next.js web application and the BullMQ worker run as separate processes:

```bash
# Terminal 1: Start Next.js App Router development server
npm run dev

# Terminal 2: Start persistent BullMQ worker process
npm run worker:dev
# or for production:
npm run worker
```

> **Note on Hosting:** A BullMQ worker requires a continuously running Node.js runtime process with persistent event loop execution (e.g. Railway, Render, Fly.io, ECS, or VPS). Standard serverless functions (e.g. Vercel / AWS Lambda) terminate between invocations and are not designed to host long-lived queue workers.

### 3. Environment Variables (.env)

```env
# Database Connections (Neon PostgreSQL)
DATABASE_URL="postgresql://user:***@pooler.neon.tech/neondb?sslmode=require"
DIRECT_URL="postgresql://user:***@direct.neon.tech/neondb?sslmode=require"

# Queue & Cache (Upstash Redis TLS)
REDIS_URL="rediss://default:***@ruling-longhorn.upstash.io:6379"

# Execution Mode
USE_MOCKS="false" # "true" for offline mocks, "false" for live database & API calls

# Admin RBAC Secret Key
ADMIN_SECRET_KEY="dev-admin-secret"

# Cron & Application
CRON_SECRET="dev-cron-secret-12345"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

### 4. Retries & Deduplication Protections

1. **Deterministic Job IDs:** Enqueued jobs use the format `audit-${auditId}`. If a client attempts to submit an audit for an already queued/active ID, BullMQ prevents duplicate jobs from entering the queue.
2. **Idempotent Status Checks:** When a worker picks up a job, it inspects the authoritative record in PostgreSQL. If the audit is already `COMPLETED`, the worker immediately skips re-crawling.
3. **Transient Error Backoff:** Jobs that fail due to transient network hiccups are automatically retried with exponential backoff:
   - Max attempts: 3
   - Backoff strategy: exponential with 3s base delay
4. **Permanent Failure Guard (`UnrecoverableError`):** Deterministic rejections (e.g., SSRF security policy rejections, malformed URLs, missing records) throw `UnrecoverableError`, preventing BullMQ from wasting retries on non-transient errors.
5. **Fail-Safe Enqueueing:** If Redis enqueueing fails after the Audit record is created in PostgreSQL, the record is immediately updated to `FAILED` with an error message to prevent orphaned `QUEUED` records.

### 5. Inspecting Audit Status & Queue Health

- **Individual Audit Status:**
  ```http
  GET /api/audits/:id
  ```
  Returns the audit record with current status (`QUEUED`, `CRAWLING`, `ANALYZING`, `COMPLETED`, `FAILED`), raw crawl data, AI analysis, score, and timestamps.

- **Admin Queue Diagnostics (Authenticated):**
  ```http
  GET /api/admin/queue
  Header: x-admin-key: dev-admin-secret
  ```
  Returns real-time job counts across BullMQ states (`waiting`, `active`, `completed`, `failed`, `delayed`). Requests without valid admin credentials receive HTTP 401.

---

## Phase 6: Claude AI Analysis Engine

Phase 6 integrates Anthropic Claude AI into the audit processing pipeline. Crawled technical SEO signals and verified provider metrics from Phase 4 are transformed into evidence-grounded, falsifiable, scored SEO reports adhering strictly to the technical assessment contract.

### 1. AI Engine Pipeline

```
NormalizedAuditData (Phase 4)
             │
             ▼
prepareBoundedCrawlData() (Token budget & Prompt-injection isolation)
             │
             ├─► Mock Mode (`USE_MOCKS=true` / options.useMocks) ──► getDeterministicMockAiResult()
             │
             └─► Live Mode ──► Claude API (Anthropic SDK `@anthropic-ai/sdk`)
                                      │
                                      ▼
                               JSON Extraction
                                      │
                                      ▼
                        ClaudeAuditResultSchema (Zod)
                                      │
                                      ▼
                        enforceDeterministicScoring()
                                      │
                                      ▼
                         PostgreSQL Persistence
           (aiAnalysisData: Json, score: Int, status: COMPLETED)
```

### 2. Environment Variables & Model Configuration

| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `ANTHROPIC_API_KEY` | Server-side Anthropic API credential. Never exposed to browser or logs. | `sk-ant-api03-...` |
| `ANTHROPIC_MODEL` | Configurable Claude model identifier. | `claude-sonnet-4-6` |
| `USE_MOCKS` | Global switch: `"true"` for deterministic offline mock results; `"false"` for live API. | `"true"` |

In live mode, missing or placeholder (`mock-*`) API keys fail explicitly with `ClaudeNotConfiguredError`. Live failures never silently fall back to fake AI scores.

### 3. Required Output Contract (`ClaudeAuditResult`)

The output schema strictly adheres to the assessment requirements:

```typescript
interface ClaudeAuditResult {
  audit_version: string; // e.g. "2026.1" or "2026.1-mock"
  overall_score: number; // 0-100 integer

  score_breakdown: {
    technical: number;       // 0-100 integer
    on_page: number;         // 0-100 integer
    content: number;         // 0-100 integer
    core_web_vitals: number; // 0-100 integer
    schema: number;          // 0-100 integer
  };

  critical_issues: Issue[];     // Array of high-severity issues
  important_issues: Issue[];    // Array of medium/high issues
  quick_wins: Recommendation[]; // Recommendations with effort="LOW"
  recommendations: Recommendation[]; // Comprehensive actionable roadmap
  executive_summary: string;    // Factual strategic narrative
}

interface Issue {
  code: string;
  title: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  category: "Technical" | "OnPage" | "Content" | "CoreWebVitals" | "Schema";
  description: string;
  evidence?: string;
  recommendation: string;
}

interface Recommendation {
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  category: "Technical" | "OnPage" | "Content" | "CoreWebVitals" | "Schema";
  finding: string;
  fix: string;
  estimated_impact: "HIGH" | "MEDIUM" | "LOW";
  effort: "LOW" | "MEDIUM" | "HIGH";
  falsifiability_check: string;
}
```

### 4. Deterministic Scoring Formula & Category Weights

Overall score is deterministically aggregated from the 5 category scores using documented weights totaling 100%:

$$\text{overall\_score} = \text{round}\Big(0.25 \cdot \text{technical} + 0.25 \cdot \text{on\_page} + 0.20 \cdot \text{content} + 0.15 \cdot \text{core\_web\_vitals} + 0.15 \cdot \text{schema}\Big)$$

- **Technical (25%):** Server HTTP status, robots.txt, sitemaps, indexability, canonical tags, viewport.
- **OnPage (25%):** Title tags, meta descriptions, H1-H3 heading hierarchy, image alt attributes, link hygiene.
- **Content (20%):** Visible body word count, content depth, thin content prevention.
- **Core Web Vitals (15%):** LCP, CLS, render-blocking resources, mobile readiness.
- **Schema (15%):** Schema.org structured data, JSON-LD block validity, Microdata types.

Deterministic safeguarding function `enforceDeterministicScoring()` rounds each category score to integers $[0, 100]$ and recalculates `overall_score` to prevent model hallucination or mathematical drift.

### 5. Prompt Design, Versioning & Defenses

- **Version:** `PROMPT_VERSION = "2026.1"`.
- **Evidence-Grounded Persona:** Instructs Claude to act as Principal Technical SEO Auditor and base all findings exclusively on the provided crawl data.
- **Prompt Injection Isolation:** Untrusted crawled HTML and text are strictly isolated in `<crawl_evidence>` blocks. Instructions mandate that web page contents must never be executed as instructions.
- **Input Bounding:** Token consumption is protected by clamping text lengths (title: 120 chars, description: 200 chars, findings: top 20, headings: top 3 H1 and 5 H2).
- **Missing Data Distinction:** Claude is strictly instructed that missing provider data (e.g. Google Search Console not connected) must not be penalized as a site failure.

### 6. BullMQ Worker Lifecycle & Retry Optimization

The worker transitions through explicit database states:
`QUEUED` ──► `CRAWLING` ──► `ANALYZING` ──► `COMPLETED` (or `FAILED`)

- **Crawl Data Reuse on Retry:** If a transient AI failure (e.g. Anthropic rate limit) triggers a BullMQ retry, the worker detects that valid `rawCrawlData` is already persisted in PostgreSQL and reuses it without re-crawling the target domain.
- **Permanent Failures:** Missing credentials in live mode or unrecoverable crawl errors throw `UnrecoverableError`, preventing infinite retry loops.
- **Credential Protection:** Error messages undergo regex redaction to strip API keys, passwords, and tokens before saving to `errorMessage`.

---

## Phase 7: End-to-End Audit API, Persistence & Pipeline Stabilization

Phase 7 hardens and integrates the complete audit lifecycle from initial URL submission down to database persistence, queue coordination, worker retry recovery, and client dashboard polling.

### 1. Stabilized Audit Lifecycle

```
[Client UI / API Requester]
       │
       ▼ POST /api/audits
  1. Zod Request Validation (HTTP/HTTPS, length bounds, no embedded credentials)
  2. Authentication & Ownership Binding (req.headers -> authContext)
  3. Deduplication Check (returns existing active job if submitted < 5m ago)
  4. PostgreSQL Audit Record Creation (status: QUEUED)
  5. BullMQ Job Enqueue (jobId: audit-${id})
       │
       ▼
[BullMQ Worker (auditWorker.ts)]
  6. Job Payload Validation (auditJobDataSchema)
  7. Check Existing Crawl Data (skips recrawl if intermediate crawl was persisted)
  8. Transition to CRAWLING -> Execute crawlWebsite() -> Persist rawCrawlData
  9. Transition to ANALYZING -> Execute analyzeSeoAudit()
 10. Persist aiAnalysisData, deterministic overall score, and completedAt
 11. Transition to terminal COMPLETED (or FAILED with sanitized error)
       │
       ▼
[Client UI / Dashboard Polling]
 12. Active polling on GET /api/audits/:id while QUEUED | CRAWLING | ANALYZING
 13. Automatic stop on terminal COMPLETED | FAILED
 14. Session storage recovery allows seamless inspection after page refresh
```

### 2. API Endpoints & Request/Response Contracts

#### Audit Submission (`POST /api/audits`)
- **Headers:** `Content-Type: application/json`, optional `Authorization: Bearer <token>` or `x-user-id: <user-id>`
- **Body Schema:**
  ```json
  {
    "targetUrl": "https://example.com",
    "businessType": "Dental Clinic", // optional, max 100 chars
    "city": "Seattle",               // optional, max 100 chars
    "state": "WA",                   // optional, max 50 chars
    "useMocks": true,                // optional boolean
    "sync": false                    // optional boolean for synchronous execution
  }
  ```
- **Responses:**
  - `201 Created`: New audit created and enqueued (`{ success: true, data: { id, targetUrl, status: "QUEUED", jobId, ... }, meta: { queued: true, deduplicated: false } }`).
  - `200 OK`: Duplicate active submission detected within 5-minute window (`{ success: true, data: ..., meta: { deduplicated: true } }`).
  - `400 Bad Request`: Missing target URL, unsupported protocol (e.g. `ftp://`), embedded credentials (`user:pass@`), or malformed JSON.
  - `503 Service Unavailable`: PostgreSQL persistence failure or Upstash Redis enqueue failure.

#### Audit Listing with Database-Level Pagination (`GET /api/audits`)
- **Query Parameters:** `?page=1&pageSize=10` (`page >= 1`, `1 <= pageSize <= 50`)
- **Ownership Scoping:**
  - Ordinary clients receive **only** audits belonging to their verified `userId`.
  - Admins receive all audits across the platform.
  - Unauthenticated callers receive only public/anonymous audits.
- **Response Format:**
  ```json
  {
    "success": true,
    "data": [ /* AuditRecord[] */ ],
    "pagination": {
      "page": 1,
      "pageSize": 10,
      "totalCount": 42,
      "totalPages": 5
    },
    "meta": { "mode": "production", "isAdmin": false }
  }
  ```

#### Individual Audit Inspection (`GET /api/audits/:id`)
- **Path Parameter:** `:id` (Audit ID string)
- **Ownership Scoping:**
  - Accessible by the audit owner, system admins, or if the audit was created anonymously.
  - Cross-user client attempts return `403 Forbidden`.
  - Nonexistent records return `404 Not Found`.
- **Idempotency:** Read-only operation; repeated queries never mutate audit state.

#### Admin Queue Diagnostics (`GET /api/admin/queue`)
- **Headers:** `x-admin-key: <ADMIN_SECRET_KEY>` or `Authorization: Bearer <ADMIN_SECRET_KEY>`
- **Access Control:** Returns `401 Unauthorized` for non-admin callers.
- **Response:** Current waiting, active, completed, failed, and delayed job counts.

### 3. Database & Queue Consistency Scenarios

1. **Partial Enqueue Failure:** If BullMQ enqueueing fails after PostgreSQL record creation, the audit record is immediately transitioned to `FAILED` with error message `"Failed to enqueue audit job to queue service"`, preventing orphaned `QUEUED` records.
2. **Submission Deduplication:** Submissions for the same target domain by the same user within 5 minutes return the existing in-flight job without duplicate crawler/AI invocations.
3. **Queue Deduplication:** BullMQ deterministic `jobId: audit-${auditId}` ensures duplicate enqueues are rejected at the Redis layer.
4. **Intermediate Crawl Reuse:** Worker retries check if valid `rawCrawlData` is already stored in PostgreSQL. If so, crawling is skipped (`reusedCrawl: true`) and analysis resumes immediately.
5. **Stalled Audit Reconciliation:** `AuditService.reconcileStalledAudits(15)` detects jobs stuck in `QUEUED`, `CRAWLING`, or `ANALYZING` past 15 minutes and transitions them to `FAILED` with clear failure messages.
6. **Credential Masking:** Error logs and stored error messages automatically redact API keys (`sk-ant-***`), database credentials (`:***@`), and tokens.

---

---

## Phase 8: Admin Portal Implementation & Operational Diagnostics

Phase 8 introduces a comprehensive, server-authorized **Admin Operations Portal** (`/admin`) for platform monitoring, audit lifecycle management, and user administration.

### 1. Security & Authentication Architecture
- **Server-Side Authorization:** Every admin API (`/api/admin/*`) executes `authenticateRequest(req)`. Access is rejected with HTTP 401 Unauthorized unless the caller provides valid admin credentials.
- **Header & Cookie Support:** Admin keys can be supplied via header `x-admin-key: <ADMIN_SECRET_KEY>`, `Authorization: Bearer <ADMIN_SECRET_KEY>`, or secure cookies.
- **Zero Client Credential Leakage:** `ADMIN_SECRET_KEY` is never included in client JavaScript bundles or rendered HTML.
- **Session Storage Key Cache:** When an administrator opens `/admin`, they are prompted for the admin secret key. Validated keys are retained in browser session memory (tab lifetime) and dispatched in API headers.
- **Sole Admin Demotion Protection:** `AuditService.updateUserRole()` prevents administrators from demoting the sole administrator of the system, protecting administrative access.

### 2. Admin Portal Sections & Capabilities
1. **System Overview (`GET /api/admin/overview`):**
   - Real-time PostgreSQL database aggregations: Total Audits, Completed Audits, Failed Audits, In-Progress counts, Average Completed Score, Total Users.
   - Live Upstash Redis BullMQ job counts: `waiting`, `active`, `completed`, `failed`, `delayed`.
   - Recent Failures Feed: Direct visibility into failed audit records with sanitized error causes.
2. **Audit Management (`GET /api/admin/audits`):**
   - Cross-user paginated audit listing with database-level `skip` and `take`.
   - Target URL search with case-insensitive database matching.
   - Status filters (`ALL`, `QUEUED`, `CRAWLING`, `ANALYZING`, `COMPLETED`, `FAILED`).
   - Detailed Audit Inspection Drawer/Modal displaying scores, AI executive summaries, category score breakdowns, critical issues, and quick wins.
3. **Safe Failed Audit Retry (`POST /api/admin/audits/:id/retry`):**
   - Allows safe re-enqueueing of audits in `FAILED` status.
   - Resets status to `QUEUED`, clears error messages, and enqueues job into BullMQ.
   - Non-failed audits are rejected with HTTP 400 `InvalidState`.
   - Reuses intermediate crawl data if already saved in PostgreSQL.
4. **User Administration (`GET /api/admin/users`, `PATCH /api/admin/users`):**
   - Paginated user list with email/name search.
   - Aggregated audit count per user (`_count.audits`).
   - User role modification (`CLIENT` ↔ `ADMIN`) with confirmation dialogs.
   - Zero credential leakage: no password hashes or tokens exposed.
---

## Phase 9: Client Dashboard Completion & Audit Results Experience

Phase 9 completes the client-facing audit workflow, enabling clients to submit websites, monitor asynchronous processing, inspect paginated audit history, and review evidence-based Claude AI results.

### 1. Multi-Tab Client Dashboard Architecture (`/client`)
- **Dashboard Overview:** Displays live client-scoped metrics (Total Audits, Completed, In-Flight Processing, Failed, Latest Score, Average Score) and recent audit activity feed.
- **Run New Audit:** Input form with client-side URL validation, optional metadata (`businessType`, `city`, `state`), duplicate prevention, and real-time 4-step pipeline progress tracker.
- **Audit History:** Paginated table of client audits with status filtering (`ALL`, `COMPLETED`, `QUEUED`, `CRAWLING`, `ANALYZING`, `FAILED`), URL search, score indicators, and inspection triggers.
- **Detailed Results View:** Full report inspecting Overall Score (0-100), Category Breakdown (Technical, On-Page, Content, Core Web Vitals, Schema), Executive Summary, Critical Issues, Quick Wins, and Strategic Recommendations.

### 2. Client Security & Data Isolation
- **Server-Side Identity Binding:** Audits created via `POST /api/audits` bind identity strictly to `auth.user.id` resolved server-side.
- **Strict Data Scoping:**
  - `GET /api/audits/overview` aggregates metrics strictly for the authenticated client's records.
  - `GET /api/audits` scopes listing queries to `where: { userId: auth.user.id }`.
  - `GET /api/audits/:id` enforces `canAccessAudit(auth, audit)`. Inquiries for other clients' audits return HTTP 403 Forbidden.
- **Safe Rendering:** Crawled website content and AI outputs are rendered strictly as escaped text in React without `dangerouslySetInnerHTML`.

---

## Phase 10: PDF Report Generation, Secure Downloads & Notification Dispatch

Phase 10 completes the automated post-audit reporting and multi-channel notification workflow:

**Audit Completes ──► PDF Report Generated ──► Durable Storage & Persistence ──► Client/Admin Downloads ──► Email & WhatsApp Notifications ──► PostgreSQL Delivery Tracking**

### 1. Server-Side PDF Rendering Architecture (`src/reports/`)
- **Headless Puppeteer Engine (`src/reports/pdf.ts`):** Server-side Chromium rendering with `--no-sandbox`, `--disable-setuid-sandbox`, `--disable-dev-shm-usage`, and `--disable-gpu`.
- **Strict Network Isolation:** Network interception blocks all external resource loading (`data:` URIs and inline assets only). Target website URLs are **never** rendered or navigated to by Puppeteer.
- **XSS & Injection Protection (`src/reports/templates/auditReportTemplate.ts`):** Untrusted crawled website content and Claude AI outputs undergo strict entity escaping (`escapeHtml`). A restrictive Content Security Policy (`default-src 'none'; style-src 'unsafe-inline'; img-src data:;`) is embedded in every report.
- **A4 Multi-Page Layout:** Professional styling featuring:
  - Header: Application branding, target website URL, Audit ID, completion and generation timestamps.
  - Executive Summary: Overall 0–100 SEO health score gauge, AI summary, and platform assessment disclaimer.
  - 5-Category Weighted Score Breakdown: Technical (25%), On-Page (25%), Content (20%), Core Web Vitals (15%), Schema (15%).
  - Findings & Issues: Severity badges (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`), finding descriptions, crawl evidence, and suggested fixes.
  - Actionable Quick Wins & Strategic Recommendations roadmap.
  - Limitations & Footers: Explicit disclosure of unavailable provider data and audit crawl constraints.

### 2. Storage & Canonical Persistence (`src/reports/storage.ts`)
- **Durable Local Storage:** Reports are stored on disk under `storage/reports/<auditId>.pdf`. Cloudflare R2 bucket integration is prepared via the `IReportStorageProvider` abstraction.
- **PostgreSQL Reference:** Persists the canonical secure API path `/api/audits/${auditId}/report` in `Audit.pdfReportUrl`. File system paths (`C:\Users\...`) and storage credentials are never leaked.
- **Idempotent Generation (`AuditReportService`):** Repeat requests serve cached reports. In-flight generation promises are deduplicated across concurrent requests.

### 3. Secure Report & Notification APIs
- **`GET /api/audits/:id/report`:** Streams binary PDF (`Content-Type: application/pdf`) with strict privacy headers (`Cache-Control: private, no-cache, no-store, must-revalidate`). Cross-client requests return HTTP 403 Forbidden; audit owners and administrators receive the document.
- **`POST /api/audits/:id/report`:** Triggers report generation or force regeneration (`?force=true`).
- **`GET /api/audits/:id/notifications`:** Returns delivery audit trail from PostgreSQL `notification_deliveries`.
- **`POST /api/audits/:id/notifications`:** Dispatches Email and WhatsApp notifications with duplicate deduplication.

### 4. Notification Architecture & Twilio WhatsApp Preservation
- **Email Service (`src/notifications/email.ts`):** Email format validation, HTML template rendering with scores, target URLs, and secure download links. Supports mock simulation and live provider guard (`ProviderNotConfiguredError`).
- **Twilio WhatsApp Service (`src/notifications/whatsapp.ts`):** Strict E.164 phone number validation, credential and phone number redaction in logs, delegating directly to the preserved Phase 3 Twilio mock fixture (`src/mocks/twilio.mock.js`).
- **PostgreSQL Delivery Tracking (`NotificationDelivery` Model):** Tracks channel (`EMAIL`, `WHATSAPP`), status (`PENDING`, `SENT`, `DELIVERED`, `FAILED`, `SKIPPED`), provider message IDs, attempt counts, and sanitized errors.
- **Fault Isolation Policy:** Notification or PDF generation failure **never** fails completed audits or wipes out AI analysis data.

---

## All Development & Verification Scripts

```bash
# Start Next.js 14 development server
npm run dev

# Start persistent BullMQ worker process
npm run worker
npm run worker:dev

# Run TypeScript checks (tsc --noEmit)
npm run type-check

# Run Next.js ESLint checks
npm run lint

# Production build
npm run build

# Run all automated test suites (Phase 3 through Phase 11)
npm run test

# Run Phase 11 scheduling, security hardening & deployment tests
npm run test:phase11
npm run test:scheduling
npm run test:security

# Run live PostgreSQL database smoke test
npm run db
npm run db:test

# Run Phase 3 mock fixtures & provider tests
npm run test:mocks

# Run Phase 4 crawler, on-page, SSRF, & technical test suite
npm run test:crawler

# Run Phase 5 queue, deduplication, worker, & live smoke tests
npm run test:queue

# Run Phase 6 Claude AI analysis engine & scoring tests
npm run test:ai

# Run Phase 7 end-to-end integration, ownership, and pipeline tests
npm run test:integration

# Run Phase 8 admin portal, RBAC, retry, and user administration tests
npm run test:admin

# Run Phase 9 client dashboard, data isolation, and results tests
npm run test:client

# Run Phase 10 PDF report generation & notification dispatch tests
npm run test:reports
npm run test:notifications
npm run test:phase10

# Synchronize schema to PostgreSQL
npm run prisma:push
```

---

## Phase 11: Scheduling, Cloudflare R2, Security Hardening & Full QA

- **Verified Server-Side Sessions:** Insecure `x-user-id` client identification is completely replaced with database-persisted session tokens stored in PostgreSQL (`Session` model) and issued via `HttpOnly`, `SameSite=Lax`, `Secure` cookies (`edgelink_session`).
- **Cryptographic Anti-CSRF Protection:** State-changing endpoints require an HMAC-SHA256 signature (`x-csrf-token`) bound to the session token.
- **Bcrypt Password Security:** Passwords hashed with `bcryptjs` with salt rounds = 10; zero plaintext storage.
- **Sliding-Window Rate Limiting:** Redis-backed rate limiting with in-memory fallback on auth, audit submissions, manual triggers, and cron endpoints.
- **Automated Recurring SEO Audits:** `ScheduledAudit` model supporting `WEEKLY` and `MONTHLY` cadences in UTC with pause, resume, cancel, and run-now controls.
- **Secure Cron Endpoint (`POST /api/cron/audits`):** Protected by `CRON_SECRET` with atomic claim locking preventing duplicate processing across concurrent runners.
- **Cloudflare R2 Object Storage:** Production-grade AWS S3 v3 SDK integration in `ReportStorageService` supporting private R2 bucket uploads, presigned download URLs, and fallback to local disk.
- **Platform Health & Graceful Worker Shutdown:** `/api/health` endpoint monitoring PostgreSQL, Redis, and queue metrics; worker startup reconciliation of stalled audits and graceful termination handlers.
- **Documentation:** Full guides authored in `docs/PHASE_11_DEPLOYMENT_GUIDE.md`, `docs/PHASE_11_SECURITY_CHECKLIST.md`, and `docs/PHASE_11_WORKER_RUNBOOK.md`.
