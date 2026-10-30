# PHASE 11 SECURITY CHECKLIST & HARDENING AUDIT
## Edgelink Technology SEO Automation Dashboard

**Date:** October 30, 2026  
**Auditor:** Antigravity AI Security Suite  
**Status:** All Hardening Criteria Verified & Passing

---

## 1. Authentication & Session Security

- [x] **No Client-Controlled Identity in Production:**
  - `x-user-id` header/cookie identification is **strictly rejected** when `NODE_ENV === "production"`. Identity is exclusively determined by server-side verification of cryptographic session tokens in the database.
- [x] **Secure Session Cookies:**
  - Cookie name: `edgelink_session`
  - Attributes: `HttpOnly = true` (inaccessible to JavaScript), `Secure = true` (enforced when `NODE_ENV === "production"`), `SameSite = Lax` (CSRF defense), `Path = /`.
  - Expiration: 7 days from creation, refreshed or cleared upon explicit logout.
- [x] **Database Session Storage:**
  - Sessions are tracked in PostgreSQL `Session` model (`id`, `userId`, `token @unique`, `expiresAt`, `createdAt`).
  - Active session invalidation on logout completely removes the database session record (`Session.delete`).
- [x] **Modern Password Hashing:**
  - Password hashing implemented using `bcryptjs` with salt rounds = 10.
  - Plaintext passwords are never saved, logged, or returned in API responses.
  - User registration strictly validates minimum password length (>= 8 characters).

---

## 2. Cross-Site Request Forgery (CSRF) Protection

- [x] **Cryptographic HMAC-SHA256 Anti-CSRF Tokens:**
  - Generated via `generateCsrfToken(sessionToken)` using `ADMIN_SECRET_KEY` as HMAC salt.
  - Validated via `validateCsrfToken(headerToken, sessionToken)` with constant-time equality check (`crypto.timingSafeEqual`) to prevent timing side-channel attacks.
- [x] **Enforcement on State-Changing Endpoints:**
  - Required for all cookie-authenticated `POST`, `PATCH`, `DELETE` operations on `/api/schedules`, `/api/schedules/[id]`, `/api/schedules/[id]/run`, etc.
  - Requests missing or carrying tampered `x-csrf-token` headers are terminated immediately with `HTTP 403 Forbidden`.

---

## 3. Authorization, RBAC & IDOR Prevention

- [x] **Role Separation (Admin vs Client):**
  - Clients cannot access administrative endpoints (`/api/admin/*`, `/api/admin/audits`, `/api/admin/users`, `/api/admin/overview`, `/api/admin/queue`).
  - Admins can inspect cross-user client data and trigger administrative maintenance.
- [x] **Strict Ownership Enforcement (Client Isolation):**
  - Client A cannot access, view, pause, modify, or delete Client B's scheduled audits or report PDFs.
  - Attempting to inspect another client's private schedule returns `HTTP 404 Not Found` (rather than 403) to prevent resource existence enumeration.
- [x] **PDF & Report Download Authorization:**
  - `/api/audits/[id]/report` verifies ownership before streaming PDF bytes or issuing Cloudflare R2 presigned URLs.
  - Presigned download URLs are short-lived (15 minutes).

---

## 4. Rate Limiting & Denial-of-Service Defenses

- [x] **Sliding-Window Rate Limiting Engine (`src/lib/rateLimit.ts`):**
  - Implemented using Upstash Redis `INCR` + `EXPIRE` pipeline with automatic in-memory fallback.
  - Configured thresholds:
    - Login (`/api/auth/login`): 10 requests / 15 minutes per IP.
    - Registration (`/api/auth/register`): 5 requests / 15 minutes per IP.
    - Scheduled Audit Manual Execution (`/api/schedules/[id]/run`): 10 requests / minute.
    - Cron Trigger (`/api/cron/audits`): 60 requests / minute.
  - Exceeded rate limits return `HTTP 429 Too Many Requests` with a standard `Retry-After` header.

---

## 5. Network & Input Validation Defenses

- [x] **Zod Payload Validation:**
  - Every incoming API request body and query parameter set is validated with strict Zod schemas before database queries or worker jobs are created.
- [x] **Crawler SSRF Prevention:**
  - Target URLs must strictly use `http://` or `https://` schemes.
  - Blocked access to localhost (`127.0.0.1`, `::1`), link-local metadata addresses (`169.254.169.254`), and private RFC 1918 subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`).
  - URLs with embedded credentials (`user:pass@host`) are rejected immediately.
- [x] **Prompt Injection Defenses:**
  - Raw crawled web text and external evidence are isolated in `<crawl_evidence>` blocks before passing to Anthropic Claude SDK, preventing prompt hijacking from untrusted websites.

---

## 6. HTTP Security Headers

Configured in `next.config.mjs`:
- [x] `X-Frame-Options: DENY` (prevents clickjacking attacks)
- [x] `X-Content-Type-Options: nosniff` (prevents MIME sniffing)
- [x] `Referrer-Policy: strict-origin-when-cross-origin` (protects internal URL leakages)
- [x] `Permissions-Policy: camera=(), microphone=(), geolocation=()` (restricts browser capabilities)
- [x] Strict download headers for PDFs (`Content-Disposition: attachment`, `Cache-Control: private, no-transform, no-store`).

---

## 7. Secrets & Credential Protection

- [x] No plaintext passwords or API keys are ever committed to Git.
- [x] `.env.example` documents all production variables with dummy placeholders.
- [x] Cron bearer secret (`CRON_SECRET`) and administrative secret (`ADMIN_SECRET_KEY`) are kept on server-side only.
- [x] Database URLs, Redis tokens, and phone numbers are redacted in logs (`redactPhoneNumber`).
