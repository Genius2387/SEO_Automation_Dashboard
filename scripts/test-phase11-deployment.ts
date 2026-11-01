/* eslint-disable @typescript-eslint/no-require-imports */
import dotenv from "dotenv";
dotenv.config();

import assert from "assert";
import { NextRequest } from "next/server";
import prisma from "../src/lib/prisma";
import {
  hashPassword,
  verifyPassword,
  createSession,
  invalidateSession,
  generateCsrfToken,
  validateCsrfToken,
} from "../src/lib/auth";
import { checkRateLimit } from "../src/lib/rateLimit";
import { ScheduleService } from "../src/services/scheduleService";
import { ReportStorageService } from "../src/reports";
import { POST as handleRegister } from "../src/app/api/auth/register/route";
import { POST as handleLogin } from "../src/app/api/auth/login/route";
import { POST as handleLogout } from "../src/app/api/auth/logout/route";
import { GET as handleMe } from "../src/app/api/auth/me/route";
import { GET as handleSchedules, POST as handleCreateSchedule } from "../src/app/api/schedules/route";
import {
  GET as handleGetSchedule,
  PATCH as handlePatchSchedule,
  DELETE as handleDeleteSchedule,
} from "../src/app/api/schedules/[id]/route";
import { POST as handleRunSchedule } from "../src/app/api/schedules/[id]/run/route";
import { POST as handleCronAudits } from "../src/app/api/cron/audits/route";
import { isAuthorizedCronRequest } from "../src/lib/cronAuth";
import { GET as handleHealth } from "../src/app/api/health/route";
import { GET as handleGetReport } from "../src/app/api/audits/[id]/report/route";
import { closeRedisConnections } from "../src/queue";

async function ensureDatabaseReady(maxAttempts = 5): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      console.log(`  ⏳ Waiting for PostgreSQL wake-up (attempt ${attempt}/${maxAttempts})...`);
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
  }
}

async function runPhase11Tests() {
  console.log("==================================================================");
  console.log("EDGELINK SEO DASHBOARD - PHASE 11 FULL DEPLOYMENT & QA TEST SUITE");
  console.log("==================================================================");

  const cleanupUserIds: string[] = [];
  const cleanupScheduleIds: string[] = [];
  const cleanupAuditIds: string[] = [];

  try {
    console.log("\n[0/6] Verifying PostgreSQL connection and test fixtures...");
    await ensureDatabaseReady();

    const timestamp = Date.now();
    const clientAEmail = `phase11_client_a_${timestamp}@edgelink-test.local`;
    const clientBEmail = `phase11_client_b_${timestamp}@edgelink-test.local`;
    const adminEmail = `phase11_admin_${timestamp}@edgelink-test.local`;
    const testPassword = "SecurePassword123!";

    // =========================================================================
    // SECTION 1: AUTHENTICATION & SECURITY HARDENING
    // =========================================================================
    console.log("\n[1/6] Testing Authentication & Security Hardening...");

    // 1.1 Bcrypt hashing
    console.log("  -> 1.1 Verifying Bcrypt password hashing & salt generation...");
    const hashedPassword = await hashPassword(testPassword);
    assert.ok(hashedPassword.startsWith("$2"), "Password hash should be standard bcrypt");
    assert.notStrictEqual(hashedPassword, testPassword, "Password must not be stored in plaintext");
    const isPasswordValid = await verifyPassword(testPassword, hashedPassword);
    assert.strictEqual(isPasswordValid, true, "Bcrypt verification must succeed for valid password");
    const isPasswordInvalid = await verifyPassword("WrongPassword!", hashedPassword);
    assert.strictEqual(isPasswordInvalid, false, "Bcrypt verification must fail for invalid password");
    console.log("     ✓ Bcrypt hashing and verification passed.");

    // 1.2 User Registration
    console.log("  -> 1.2 Testing registration endpoint with password validation...");
    // Weak password rejection
    const weakReq = new NextRequest("http://localhost:3000/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: clientAEmail, password: "123", name: "Client A" }),
    });
    const weakRes = await handleRegister(weakReq);
    assert.strictEqual(weakRes.status, 400, "Short password (<8 chars) must be rejected with 400");

    // Valid registration
    const regReq = new NextRequest("http://localhost:3000/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: clientAEmail, password: testPassword, name: "Client A" }),
    });
    const regRes = await handleRegister(regReq);
    assert.strictEqual(regRes.status, 201, "Valid registration must return 201 Created");
    const regJson = await regRes.json();
    assert.ok(regJson.user?.id, "Registration must return user ID");
    cleanupUserIds.push(regJson.user.id);

    // Verify session cookie was set
    const setCookieHeader = regRes.headers.get("set-cookie") || "";
    assert.ok(setCookieHeader.includes("edgelink_session="), "Registration must set edgelink_session cookie");
    assert.ok(setCookieHeader.includes("HttpOnly"), "Session cookie must be HttpOnly");
    console.log("     ✓ User registration and session cookie issuance verified.");

    // 1.3 User Login
    console.log("  -> 1.3 Testing login endpoint with valid and invalid credentials...");
    // Invalid credentials
    const badLoginReq = new NextRequest("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: clientAEmail, password: "IncorrectPassword!" }),
    });
    const badLoginRes = await handleLogin(badLoginReq);
    assert.strictEqual(badLoginRes.status, 401, "Bad password must return 401 Unauthorized");

    // Valid credentials
    const loginReq = new NextRequest("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: clientAEmail, password: testPassword }),
    });
    const loginRes = await handleLogin(loginReq);
    assert.strictEqual(loginRes.status, 200, "Valid login must return 200 OK");
    const loginJson = await loginRes.json();
    assert.strictEqual(loginJson.user.email, clientAEmail);
    assert.ok(loginJson.csrfToken, "Login must return an anti-CSRF token");

    const sessionCookie = loginRes.cookies.get("edgelink_session")?.value;
    assert.ok(sessionCookie, "Session cookie must exist on login response");
    console.log("     ✓ Valid and invalid login authentication verified.");

    // 1.4 Auth Session Inspection via /api/auth/me
    console.log("  -> 1.4 Testing /api/auth/me session verification...");
    const meReq = new NextRequest("http://localhost:3000/api/auth/me", {
      headers: {
        Cookie: `edgelink_session=${sessionCookie}`,
      },
    });
    const meRes = await handleMe(meReq);
    assert.strictEqual(meRes.status, 200, "Session cookie must authenticate successfully on /api/auth/me");
    const meJson = await meRes.json();
    assert.strictEqual(meJson.user.id, regJson.user.id);
    const csrfToken = meJson.csrfToken;
    console.log("     ✓ Server-side session verification verified.");

    // 1.5 Anti-CSRF Token Validation
    console.log("  -> 1.5 Testing CSRF protection on state-changing endpoints...");
    const isValidCsrf = validateCsrfToken(csrfToken, sessionCookie);
    assert.strictEqual(isValidCsrf, true, "CSRF token must match session token");
    const isBadCsrf = validateCsrfToken("tampered-csrf-token", sessionCookie);
    assert.strictEqual(isBadCsrf, false, "Tampered CSRF token must fail validation");

    // Attempting schedule creation with bad CSRF
    const badCsrfReq = new NextRequest("http://localhost:3000/api/schedules", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `edgelink_session=${sessionCookie}`,
        "x-csrf-token": "invalid-csrf",
      },
      body: JSON.stringify({
        targetUrl: "https://example.com",
        businessType: "Dental Clinic",
        city: "Seattle",
        frequency: "WEEKLY",
      }),
    });
    const badCsrfRes = await handleCreateSchedule(badCsrfReq);
    assert.strictEqual(badCsrfRes.status, 403, "Invalid CSRF token must be rejected with 403 Forbidden");
    console.log("     ✓ Anti-CSRF enforcement verified.");

    // 1.6 Logout & Session Invalidation
    console.log("  -> 1.6 Testing logout and session invalidation...");
    const logoutReq = new NextRequest("http://localhost:3000/api/auth/logout", {
      method: "POST",
      headers: {
        Cookie: `edgelink_session=${sessionCookie}`,
      },
    });
    const logoutRes = await handleLogout(logoutReq);
    assert.strictEqual(logoutRes.status, 200, "Logout must return 200 OK");

    // Subsequent access with invalidated session must report unauthenticated
    const meAfterLogout = await handleMe(
      new NextRequest("http://localhost:3000/api/auth/me", {
        headers: { Cookie: `edgelink_session=${sessionCookie}` },
      })
    );
    const meAfterJson = await meAfterLogout.json();
    assert.strictEqual(meAfterJson.authenticated, false, "Invalidated session must return unauthenticated");
    assert.strictEqual(meAfterJson.user, null, "Invalidated session must return null user");

    const protectedAfterLogout = await handleSchedules(
      new NextRequest("http://localhost:3000/api/schedules", {
        headers: { Cookie: `edgelink_session=${sessionCookie}` },
      })
    );
    assert.strictEqual(protectedAfterLogout.status, 401, "Protected routes must reject invalidated session with 401");
    console.log("     ✓ Logout session invalidation verified.");

    // Create fresh session for Client A and create Client B
    const userA = await prisma.user.findUnique({ where: { id: regJson.user.id } });
    assert.ok(userA);
    const sessionA = await createSession(userA.id);
    const clientACookie = `edgelink_session=${sessionA.token}`;
    const clientACsrf = generateCsrfToken(sessionA.token);

    const userB = await prisma.user.create({
      data: {
        email: clientBEmail,
        name: "Client B",
        role: "CLIENT",
        passwordHash: await hashPassword(testPassword),
      },
    });
    cleanupUserIds.push(userB.id);
    const sessionB = await createSession(userB.id);
    const clientBCookie = `edgelink_session=${sessionB.token}`;

    const adminUser = await prisma.user.create({
      data: {
        email: adminEmail,
        name: "Admin User",
        role: "ADMIN",
        passwordHash: await hashPassword(testPassword),
      },
    });
    cleanupUserIds.push(adminUser.id);
    const adminSession = await createSession(adminUser.id);
    const adminCookie = `edgelink_session=${adminSession.token}`;

    // 1.7 Client Role & Resource Isolation
    console.log("  -> 1.7 Testing role authorization and cross-client isolation...");
    // Client cannot access admin APIs
    const clientAdminCheck = new NextRequest("http://localhost:3000/api/admin/audits", {
      headers: { Cookie: clientACookie },
    });
    // Dynamically check admin route
    const { GET: handleAdminAudits } = await import("../src/app/api/admin/audits/route");
    const clientAdminRes = await handleAdminAudits(clientAdminCheck);
    assert.ok([401, 403].includes(clientAdminRes.status), "Non-admin client must be forbidden from admin APIs (401 or 403)");

    const adminCheckRes = await handleAdminAudits(
      new NextRequest("http://localhost:3000/api/admin/audits", {
        headers: { Cookie: adminCookie },
      })
    );
    assert.strictEqual(adminCheckRes.status, 200, "Admin must be permitted to access admin APIs (200)");
    console.log("     ✓ Admin role enforcement verified.");

    // =========================================================================
    // SECTION 2: SCHEDULED SEO AUDITS
    // =========================================================================
    console.log("\n[2/6] Testing Recurring SEO Schedules & Schedule Management...");

    // 2.1 Create Weekly Schedule
    console.log("  -> 2.1 Creating weekly recurring schedule...");
    const createWeeklyReq = new NextRequest("http://localhost:3000/api/schedules", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: clientACookie,
        "x-csrf-token": clientACsrf,
      },
      body: JSON.stringify({
        targetUrl: "https://seattle-dentist.example.com",
        businessType: "Dental Practice",
        city: "Seattle",
        state: "WA",
        frequency: "WEEKLY",
      }),
    });
    const createWeeklyRes = await handleCreateSchedule(createWeeklyReq);
    assert.strictEqual(createWeeklyRes.status, 201, "Weekly schedule creation must return 201");
    const weeklyData = await createWeeklyRes.json();
    assert.ok(weeklyData.schedule?.id);
    cleanupScheduleIds.push(weeklyData.schedule.id);

    // Verify nextRunAt is ~7 days later
    const nextRun = new Date(weeklyData.schedule.nextRunAt).getTime();
    const now = Date.now();
    const diffDays = (nextRun - now) / (1000 * 60 * 60 * 24);
    assert.ok(diffDays >= 6.9 && diffDays <= 7.1, `Weekly schedule nextRunAt should be ~7 days ahead (got ${diffDays.toFixed(2)})`);
    console.log(`     ✓ Weekly schedule created with nextRunAt: ${weeklyData.schedule.nextRunAt} (~${diffDays.toFixed(1)} days)`);

    // 2.2 Create Monthly Schedule
    console.log("  -> 2.2 Creating monthly recurring schedule...");
    const createMonthlyReq = new NextRequest("http://localhost:3000/api/schedules", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: clientACookie,
        "x-csrf-token": clientACsrf,
      },
      body: JSON.stringify({
        targetUrl: "https://chicago-lawyer.example.com",
        businessType: "Legal Practice",
        city: "Chicago",
        state: "IL",
        frequency: "MONTHLY",
      }),
    });
    const createMonthlyRes = await handleCreateSchedule(createMonthlyReq);
    assert.strictEqual(createMonthlyRes.status, 201, "Monthly schedule creation must return 201");
    const monthlyData = await createMonthlyRes.json();
    cleanupScheduleIds.push(monthlyData.schedule.id);

    const monthlyDiff = (new Date(monthlyData.schedule.nextRunAt).getTime() - now) / (1000 * 60 * 60 * 24);
    assert.ok(monthlyDiff >= 27.9 && monthlyDiff <= 32.1, `Monthly schedule nextRunAt should be ~1 month ahead (got ${monthlyDiff.toFixed(2)})`);
    console.log(`     ✓ Monthly schedule created with nextRunAt: ${monthlyData.schedule.nextRunAt} (~${monthlyDiff.toFixed(1)} days)`);

    // 2.3 Cross-Client Schedule Access Denial
    console.log("  -> 2.3 Verifying Client B cannot access or modify Client A's schedule...");
    const clientBAccessReq = new NextRequest(`http://localhost:3000/api/schedules/${weeklyData.schedule.id}`, {
      headers: { Cookie: clientBCookie },
    });
    const clientBAccessRes = await handleGetSchedule(clientBAccessReq, { params: { id: weeklyData.schedule.id } });
    assert.strictEqual(clientBAccessRes.status, 404, "Client B must receive 404 for Client A's private schedule");

    // 2.4 Pause and Resume Schedule
    console.log("  -> 2.4 Testing Pause and Resume schedule actions...");
    // Pause
    const pauseReq = new NextRequest(`http://localhost:3000/api/schedules/${weeklyData.schedule.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: clientACookie,
        "x-csrf-token": clientACsrf,
      },
      body: JSON.stringify({ isActive: false }),
    });
    const pauseRes = await handlePatchSchedule(pauseReq, { params: { id: weeklyData.schedule.id } });
    assert.strictEqual(pauseRes.status, 200);
    const pauseData = await pauseRes.json();
    assert.strictEqual(pauseData.schedule.isActive, false, "Schedule should be paused");

    // Resume
    const resumeReq = new NextRequest(`http://localhost:3000/api/schedules/${weeklyData.schedule.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: clientACookie,
        "x-csrf-token": clientACsrf,
      },
      body: JSON.stringify({ isActive: true }),
    });
    const resumeRes = await handlePatchSchedule(resumeReq, { params: { id: weeklyData.schedule.id } });
    assert.strictEqual(resumeRes.status, 200);
    const resumeData = await resumeRes.json();
    assert.strictEqual(resumeData.schedule.isActive, true, "Schedule should be resumed");
    console.log("     ✓ Pause and resume actions verified.");

    // 2.5 Manual Immediate Execution ("Run Now")
    console.log("  -> 2.5 Testing manual immediate execution ('Run Now')...");
    const runNowReq = new NextRequest(`http://localhost:3000/api/schedules/${weeklyData.schedule.id}/run`, {
      method: "POST",
      headers: {
        Cookie: clientACookie,
        "x-csrf-token": clientACsrf,
      },
    });
    const runNowRes = await handleRunSchedule(runNowReq, { params: { id: weeklyData.schedule.id } });
    assert.strictEqual(runNowRes.status, 200, "Manual schedule execution should return 200");
    const runNowJson = await runNowRes.json();
    assert.ok(runNowJson.audit?.id, "Run now must create an audit");
    cleanupAuditIds.push(runNowJson.audit.id);

    // Verify lastAuditId updated on schedule
    const updatedSchedule = await prisma.scheduledAudit.findUnique({ where: { id: weeklyData.schedule.id } });
    assert.strictEqual(updatedSchedule?.lastAuditId, runNowJson.audit.id);
    assert.ok(updatedSchedule?.lastRunAt, "lastRunAt must be populated");
    console.log("     ✓ Immediate execution created audit and updated lastAuditId.");

    // =========================================================================
    // SECTION 3: SECURE CRON ENDPOINT & CONCURRENCY IDEMPOTENCY
    // =========================================================================
    console.log("\n[3/6] Testing Secure Cron Endpoint & Concurrency Idempotency...");

    const cronSecret = process.env.CRON_SECRET || "dev-cron-secret-12345";

    // 3.1 Unauthorized Cron Rejections
    console.log("  -> 3.1 Testing unauthorized cron request rejection...");
    const unauthCronReq = new NextRequest("http://localhost:3000/api/cron/audits", { method: "POST" });
    const unauthCronRes = await handleCronAudits(unauthCronReq);
    assert.strictEqual(unauthCronRes.status, 401, "Missing CRON_SECRET must return 401");

    const badSecretCronReq = new NextRequest("http://localhost:3000/api/cron/audits", {
      method: "POST",
      headers: { Authorization: "Bearer wrong-secret" },
    });
    const badSecretCronRes = await handleCronAudits(badSecretCronReq);
    assert.strictEqual(badSecretCronRes.status, 401, "Invalid CRON_SECRET must return 401");
    console.log("     ✓ Unauthorized cron requests correctly rejected.");

    // 3.1b Production-specific Cron Security Checks
    console.log("  -> 3.1b Testing production-specific CRON_SECRET enforcement...");
    const envObj = process.env as Record<string, string | undefined>;
    const originalEnv = envObj.NODE_ENV;
    const originalSecret = envObj.CRON_SECRET;
    try {
      envObj.NODE_ENV = "production";

      // 1. Production with dev fallback secret: MUST FAIL
      envObj.CRON_SECRET = "dev-cron-secret-12345";
      const prodDevFallbackReq = new NextRequest("http://localhost:3000/api/cron/audits", {
        method: "POST",
        headers: { Authorization: "Bearer dev-cron-secret-12345" },
      });
      assert.strictEqual(
        isAuthorizedCronRequest(prodDevFallbackReq),
        false,
        "Production must strictly reject 'dev-cron-secret-12345'"
      );

      // 2. Production with missing CRON_SECRET: MUST FAIL
      delete envObj.CRON_SECRET;
      const prodMissingSecretReq = new NextRequest("http://localhost:3000/api/cron/audits", {
        method: "POST",
        headers: { Authorization: "Bearer some-attempted-token" },
      });
      assert.strictEqual(
        isAuthorizedCronRequest(prodMissingSecretReq),
        false,
        "Production must fail closed when CRON_SECRET is missing"
      );

      // 3. Production with valid custom secret: MUST SUCCEED with matching Bearer token
      envObj.CRON_SECRET = "prod-strong-entropy-secret-9876543210";
      const prodValidReq = new NextRequest("http://localhost:3000/api/cron/audits", {
        method: "POST",
        headers: { Authorization: "Bearer prod-strong-entropy-secret-9876543210" },
      });
      assert.strictEqual(
        isAuthorizedCronRequest(prodValidReq),
        true,
        "Production must authorize with matching custom CRON_SECRET"
      );

      // 4. Production with valid custom secret but wrong token: MUST FAIL
      const prodWrongTokenReq = new NextRequest("http://localhost:3000/api/cron/audits", {
        method: "POST",
        headers: { Authorization: "Bearer wrong-token" },
      });
      assert.strictEqual(
        isAuthorizedCronRequest(prodWrongTokenReq),
        false,
        "Production must reject invalid token"
      );
    } finally {
      envObj.NODE_ENV = originalEnv;
      envObj.CRON_SECRET = originalSecret;
    }
    console.log("     ✓ Production-specific CRON_SECRET enforcement verified.");

    // 3.2 Due Schedule Execution
    console.log("  -> 3.2 Testing due schedule processing via authorized cron...");
    // Create a due schedule with nextRunAt in the past
    const dueSchedule = await prisma.scheduledAudit.create({
      data: {
        userId: userA.id,
        targetUrl: "https://seattle-plumber.example.com",
        businessType: "Plumbing Services",
        city: "Seattle",
        state: "WA",
        frequency: "WEEKLY",
        isActive: true,
        nextRunAt: new Date(Date.now() - 3600000), // 1 hour ago
      },
    });
    cleanupScheduleIds.push(dueSchedule.id);

    const validCronReq = new NextRequest("http://localhost:3000/api/cron/audits", {
      method: "POST",
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    const validCronRes = await handleCronAudits(validCronReq);
    assert.strictEqual(validCronRes.status, 200, "Authorized cron should return 200");
    const cronStats = await validCronRes.json();
    assert.ok(cronStats.stats.schedulesChecked >= 1, "At least 1 schedule should be checked");
    assert.ok(cronStats.stats.auditsCreated >= 1, "At least 1 audit should be created");
    assert.ok(cronStats.stats.jobsQueued >= 1, "At least 1 job queued");

    // Collect created audit for cleanup
    const refreshedDueSchedule = await prisma.scheduledAudit.findUnique({ where: { id: dueSchedule.id } });
    if (refreshedDueSchedule?.lastAuditId) {
      cleanupAuditIds.push(refreshedDueSchedule.lastAuditId);
    }
    assert.ok(new Date(refreshedDueSchedule!.nextRunAt).getTime() > Date.now(), "nextRunAt must be pushed into future");
    console.log(`     ✓ Cron execution processed due schedule. Stats: ${JSON.stringify(cronStats.stats)}`);

    // 3.3 Concurrency & Idempotency Check
    console.log("  -> 3.3 Verifying concurrent duplicate cron protection...");
    // Create another due schedule
    const raceSchedule = await prisma.scheduledAudit.create({
      data: {
        userId: userA.id,
        targetUrl: "https://race-condition-test.example.com",
        businessType: "Auto Repair",
        city: "Tacoma",
        state: "WA",
        frequency: "WEEKLY",
        isActive: true,
        nextRunAt: new Date(Date.now() - 60000), // 1 minute ago
      },
    });
    cleanupScheduleIds.push(raceSchedule.id);

    // Fire 2 concurrent schedule process calls simulating overlapping cron invocations
    const [result1, result2] = await Promise.all([
      ScheduleService.processDueSchedules(10),
      ScheduleService.processDueSchedules(10),
    ]);

    const totalAuditsCreated = result1.auditsCreated + result2.auditsCreated;
    assert.strictEqual(totalAuditsCreated, 1, `Atomic claim lock must ensure exactly 1 audit created for the due schedule (got ${totalAuditsCreated})`);

    const refreshedRace = await prisma.scheduledAudit.findUnique({ where: { id: raceSchedule.id } });
    if (refreshedRace?.lastAuditId) {
      cleanupAuditIds.push(refreshedRace.lastAuditId);
    }
    console.log("     ✓ Atomic claim lock prevented concurrent duplicate execution.");

    // =========================================================================
    // SECTION 4: CLOUDFLARE R2 / S3 STORAGE INTEGRATION
    // =========================================================================
    console.log("\n[4/6] Testing Cloudflare R2 / S3 Storage Abstraction...");
    console.log(`  -> Current Report Storage Provider: ${ReportStorageService.getProviderName()}`);

    const testPdfBuffer = Buffer.from("%PDF-1.4 Mock PDF Content For Phase 11 Testing");
    const testAuditId = `phase11_test_${timestamp}`;

    const saveResult = await ReportStorageService.saveReportPdf(testAuditId, testPdfBuffer);
    assert.ok(saveResult.reportUrl, "Report storage must return stored file location/key");
    console.log(`     ✓ Saved report PDF via storage provider to: ${saveResult.reportUrl} (provider: ${saveResult.storageType})`);

    const retrievedBuffer = await ReportStorageService.getReportPdf(testAuditId);
    assert.ok(retrievedBuffer, "Stored report must be retrievable");
    assert.strictEqual(retrievedBuffer.toString(), testPdfBuffer.toString(), "Retrieved buffer must match original");
    console.log("     ✓ Report retrieved successfully with matching content.");

    const signedUrl = (await ReportStorageService.getSignedDownloadUrl(testAuditId, 900)) || saveResult.reportUrl;
    assert.ok(signedUrl, "Storage service must generate download URL");
    console.log(`     ✓ Generated download URL: ${signedUrl.substring(0, 60)}...`);

    // Clean up test report file
    await ReportStorageService.deleteReportPdf(testAuditId);
    console.log("     ✓ Test report object cleaned up.");

    // =========================================================================
    // SECTION 5: HEALTH ENDPOINT & RATE LIMITING
    // =========================================================================
    console.log("\n[5/6] Testing System Health & Rate Limiting...");

    // 5.1 Health Check
    console.log("  -> 5.1 Testing /api/health endpoint...");
    const healthReq = new NextRequest("http://localhost:3000/api/health");
    const healthRes = await handleHealth();
    assert.ok([200, 503].includes(healthRes.status), "Health check endpoint should return valid HTTP status");
    const healthJson = await healthRes.json();
    assert.ok(["healthy", "ok", "degraded"].includes(healthJson.status), "Health status should be healthy, ok or degraded");
    assert.ok(healthJson.services?.database || healthJson.checks?.database, "Database status check must be present");
    console.log(`     ✓ Health check status: ${healthJson.status} (DB: ${healthJson.services?.database}, Redis: ${healthJson.services?.redis})`);

    // 5.2 Rate Limiting
    console.log("  -> 5.2 Testing Sliding Window Rate Limiting...");
    const rateLimitKey = `test_rate_limit_${timestamp}`;
    const limit = 3;
    const windowSeconds = 5;

    // First 3 requests should be allowed
    for (let i = 1; i <= limit; i++) {
      const res = await checkRateLimit(rateLimitKey, limit, windowSeconds);
      assert.strictEqual(res.success, true, `Request ${i} within limit should be allowed`);
    }

    // 4th request must be rejected
    const blockedRes = await checkRateLimit(rateLimitKey, limit, windowSeconds);
    assert.strictEqual(blockedRes.success, false, "Request exceeding limit must be blocked");
    assert.ok(blockedRes.resetSeconds > 0, "Blocked request must indicate resetSeconds");
    console.log(`     ✓ Rate limiting blocked excess requests as expected (reset after ${blockedRes.resetSeconds}s).`);

    // =========================================================================
    // SECTION 6: CLEANUP
    // =========================================================================
    console.log("\n[6/6] Cleaning up test fixtures from PostgreSQL...");
  } finally {
    // Delete test schedules
    if (cleanupScheduleIds.length > 0) {
      await prisma.scheduledAudit.deleteMany({
        where: { id: { in: cleanupScheduleIds } },
      }).catch((e) => console.error("Error cleaning up schedules:", e));
      console.log(`  ✓ Cleaned up ${cleanupScheduleIds.length} test schedules.`);
    }

    // Delete test audits
    if (cleanupAuditIds.length > 0) {
      await prisma.audit.deleteMany({
        where: { id: { in: cleanupAuditIds } },
      }).catch((e) => console.error("Error cleaning up audits:", e));
      console.log(`  ✓ Cleaned up ${cleanupAuditIds.length} test audits.`);
    }

    // Delete test users (cascades sessions)
    if (cleanupUserIds.length > 0) {
      await prisma.session.deleteMany({
        where: { userId: { in: cleanupUserIds } },
      }).catch(() => null);

      await prisma.user.deleteMany({
        where: { id: { in: cleanupUserIds } },
      }).catch((e) => console.error("Error cleaning up users:", e));
      console.log(`  ✓ Cleaned up ${cleanupUserIds.length} test users.`);
    }

    await closeRedisConnections();
  }

  console.log("\n==================================================================");
  console.log("✅ ALL PHASE 11 FULL DEPLOYMENT & QA TESTS PASSED SUCCESSFULLY!");
  console.log("==================================================================\n");
}

runPhase11Tests().catch((err) => {
  console.error("\n❌ PHASE 11 TEST SUITE FAILED:", err);
  process.exit(1);
});
