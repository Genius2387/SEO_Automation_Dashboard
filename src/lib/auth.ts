import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";
import { Role } from "@prisma/client";

export const SESSION_COOKIE_NAME = "edgelink_session";
export const CSRF_COOKIE_NAME = "edgelink_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";
export const SESSION_EXPIRATION_DAYS = 7;

export interface AuthUser {
  id: string;
  email: string;
  name?: string | null;
  role: Role;
}

export interface AuthContext {
  user: AuthUser | null;
  isAdmin: boolean;
  isClient: boolean;
  authType: "session" | "admin_secret" | "verified_user" | "unverified_legacy" | "anonymous";
  sessionId?: string;
  csrfToken?: string;
}

/**
 * Hashes a plaintext password using bcrypt with a work factor of 10
 */
export async function hashPassword(password: string): Promise<string> {
  if (!password || password.length < 8) {
    throw new Error("Password must be at least 8 characters long");
  }
  return bcrypt.hash(password, 10);
}

/**
 * Verifies a plaintext password against a stored bcrypt hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!password || !hash) return false;
  return bcrypt.compare(password, hash);
}

/**
 * Creates a cryptographically random, secure session token (32 bytes hex)
 * and persists the session record in PostgreSQL with an expiration timestamp.
 */
export async function createSession(userId: string, durationDays = SESSION_EXPIRATION_DAYS): Promise<{ token: string; expiresAt: Date; sessionId: string }> {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

  const session = await prisma.session.create({
    data: {
      userId,
      token,
      expiresAt,
    },
  });

  return {
    token,
    expiresAt,
    sessionId: session.id,
  };
}

/**
 * Invalidates a session by deleting it from PostgreSQL
 */
export async function invalidateSession(token: string): Promise<boolean> {
  if (!token) return false;
  try {
    await prisma.session.delete({
      where: { token },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Invalidates all active sessions for a given user (e.g. password change / account security)
 */
export async function invalidateAllUserSessions(userId: string): Promise<number> {
  if (!userId) return 0;
  const res = await prisma.session.deleteMany({
    where: { userId },
  });
  return res.count;
}

/**
 * Generates an HMAC-based anti-CSRF token bound to a session identifier
 */
export function generateCsrfToken(sessionToken: string): string {
  const secret = process.env.ADMIN_SECRET_KEY || "edgelink-csrf-secret-salt";
  return crypto.createHmac("sha256", secret).update(sessionToken).digest("hex");
}

/**
 * Validates that an incoming CSRF token matches the HMAC signature for the session
 */
export function validateCsrfToken(token: string | null | undefined, sessionToken: string): boolean {
  if (!token || !sessionToken) return false;
  const expected = generateCsrfToken(sessionToken);
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Attaches the secure session and CSRF cookies to a Next.js response
 */
export function attachSessionCookies(
  res: NextResponse,
  token: string,
  expiresAt: Date
): NextResponse {
  const isProduction = process.env.NODE_ENV === "production";

  // 1. Session Cookie (HttpOnly, Secure in prod, SameSite=Lax)
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  // 2. CSRF Token Cookie (Readable by client script to send in header)
  const csrfToken = generateCsrfToken(token);
  res.cookies.set(CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: false,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  return res;
}

/**
 * Clears the session and CSRF cookies from a Next.js response
 */
export function clearSessionCookies(res: NextResponse): NextResponse {
  res.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  res.cookies.set(CSRF_COOKIE_NAME, "", {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return res;
}

/**
 * Validates request credentials and returns a strongly-typed authentication context.
 *
 * Supported Authentication Mechanisms (in priority order):
 * 1. Verified Server-Side Session:
 *    - Cookie: `edgelink_session`
 *    - Header: `Authorization: Bearer <session_token>`
 *    Verified against PostgreSQL `Session` table and enforces expiration.
 *
 * 2. Admin Secret Key:
 *    - Header: `x-admin-key: <ADMIN_SECRET_KEY>`
 *    - Header: `Authorization: Bearer <ADMIN_SECRET_KEY>`
 *    - Cookie: `admin_secret_key` or `x-admin-key`
 *    Grants ADMIN role across all operations and queue diagnostics.
 *
 * 3. Backward-Compatible Non-Production Test Harness:
 *    - Header: `x-user-id: <user_id>` (ONLY when `NODE_ENV !== "production"`)
 *    - IN PRODUCTION: `x-user-id` is strictly stripped and ignored. Never trusted.
 *
 * 4. Anonymous Requester:
 *    - No valid credentials supplied.
 */
export async function authenticateRequest(req: NextRequest): Promise<AuthContext> {
  const adminSecret = process.env.ADMIN_SECRET_KEY || "dev-admin-secret-12345";
  const headerAdminKey = req.headers.get("x-admin-key")?.trim();
  const cookieAdminKey = req.cookies?.get("x-admin-key")?.value || req.cookies?.get("admin_secret_key")?.value;
  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;

  // 1. Check for Admin Secret authentication
  const providedAdminKey = headerAdminKey || cookieAdminKey || (bearerToken === adminSecret ? bearerToken : null);
  if (providedAdminKey && providedAdminKey === adminSecret) {
    return {
      user: {
        id: "admin-system",
        email: "admin@edgelink.tech",
        role: "ADMIN",
        name: "System Administrator",
      },
      isAdmin: true,
      isClient: false,
      authType: "admin_secret",
    };
  }

  // 2. Check for Verified Server-Side Session (Cookie or Bearer token)
  const sessionCookieToken = req.cookies.get(SESSION_COOKIE_NAME)?.value?.trim();
  const candidateSessionToken = sessionCookieToken || (bearerToken && bearerToken !== adminSecret ? bearerToken : null);

  if (candidateSessionToken) {
    try {
      const session = await prisma.session.findUnique({
        where: { token: candidateSessionToken },
        include: { user: true },
      });

      if (session) {
        // Enforce expiration
        if (session.expiresAt > new Date()) {
          const isAdmin = session.user.role === "ADMIN";
          return {
            user: {
              id: session.user.id,
              email: session.user.email,
              name: session.user.name,
              role: session.user.role,
            },
            isAdmin,
            isClient: !isAdmin,
            authType: "session",
            sessionId: session.id,
            csrfToken: generateCsrfToken(candidateSessionToken),
          };
        } else {
          // Clean up expired session asynchronously
          prisma.session.delete({ where: { id: session.id } }).catch(() => {});
        }
      }
    } catch {
      // Database unavailable or transient failure: fall through
    }
  }

  // 3. Non-Production Test Harness Compatibility (Only in test / development)
  // IN PRODUCTION: NEVER trust or accept x-user-id as proof of identity!
  const isProduction = process.env.NODE_ENV === "production";
  const headerUserId = req.headers.get("x-user-id")?.trim();
  const cookieUserId = req.cookies?.get("x-user-id")?.value?.trim();
  const testCandidateUserId = headerUserId || cookieUserId;

  if (!isProduction && testCandidateUserId) {
    try {
      const dbUser = await prisma.user.findUnique({
        where: { id: testCandidateUserId },
      });

      if (dbUser) {
        const isAdmin = dbUser.role === "ADMIN";
        return {
          user: {
            id: dbUser.id,
            email: dbUser.email,
            name: dbUser.name,
            role: dbUser.role,
          },
          isAdmin,
          isClient: !isAdmin,
          authType: "verified_user",
        };
      }
    } catch {
      // Fall through to anonymous
    }
  }

  // 4. Fallback: Anonymous requester
  return {
    user: null,
    isAdmin: false,
    isClient: false,
    authType: "anonymous",
  };
}

/**
 * Validates CSRF token for state-changing HTTP requests (POST, PUT, PATCH, DELETE)
 * that are authenticated via session cookies.
 * Non-cookie requests (API key, machine-to-machine) are exempted.
 */
export function enforceCsrfProtection(req: NextRequest, auth: AuthContext): boolean {
  // Safe read-only HTTP methods do not require CSRF tokens
  const safeMethods = ["GET", "HEAD", "OPTIONS"];
  if (safeMethods.includes(req.method.toUpperCase())) {
    return true;
  }

  // Requests authenticated via admin secret or bearer token do not use browser ambient credentials
  if (auth.authType === "admin_secret") {
    return true;
  }

  const hasSessionCookie = Boolean(req.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!hasSessionCookie) {
    // If not using cookies for ambient auth, CSRF attack vector is not present
    return true;
  }

  // If using cookies, request MUST include matching x-csrf-token header or body token
  const sessionToken = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) return false;

  const headerCsrf = req.headers.get(CSRF_HEADER_NAME);
  return validateCsrfToken(headerCsrf, sessionToken);
}

/**
 * Enforces ownership access control on individual audit records:
 * - ADMIN: Global access across all audits
 * - Audit Owner: Can access audits where audit.userId === user.id
 * - Anonymous Audit: Can be accessed by anyone possessing the audit ID (public report)
 * - Cross-User Client: Denied access (HTTP 403 Forbidden)
 */
export function canAccessAudit(
  auth: AuthContext,
  audit: { userId?: string | null }
): boolean {
  // Admins have global access
  if (auth.isAdmin) return true;

  // Anonymous audits (no userId attached) are accessible by link
  if (!audit.userId) return true;

  // Authenticated user can access their own audit
  if (auth.user && auth.user.id === audit.userId) return true;

  // Deny cross-user access
  return false;
}
