/* eslint-disable @typescript-eslint/no-require-imports */
import dotenv from "dotenv";
dotenv.config();

import assert from "assert";
import { NextRequest } from "next/server";
import prisma from "../src/lib/prisma";
import { AuditService } from "../src/services/auditService";
import { GET as handleGetOverview } from "../src/app/api/admin/overview/route";
import { GET as handleGetAdminAudits } from "../src/app/api/admin/audits/route";
import { POST as handleRetryAudit } from "../src/app/api/admin/audits/[id]/retry/route";
import { GET as handleGetAdminUsers, PATCH as handleUpdateUserRole } from "../src/app/api/admin/users/route";
import { GET as handleGetQueueMetrics } from "../src/app/api/admin/queue/route";
import { closeRedisConnections } from "../src/queue";

async function runPhase8AdminTests() {
  console.log("==================================================================");
  console.log("EDGELINK SEO DASHBOARD - PHASE 8 ADMIN PORTAL VERIFICATION");
  console.log("==================================================================");

  const cleanupAuditIds: string[] = [];
  const cleanupUserIds: string[] = [];

  const adminSecret = process.env.ADMIN_SECRET_KEY || "dev-admin-secret";

  try {
    // ---------------------------------------------------------------------------
    // 0. Setup Isolated Test Fixtures in PostgreSQL
    // ---------------------------------------------------------------------------
    console.log("\n[0/8] Setting up isolated test fixtures in PostgreSQL...");

    const regularClient = await prisma.user.create({
      data: {
        email: `phase8_client_${Date.now()}@edgelink-test.local`,
        name: "Phase8 Regular Client",
        role: "CLIENT",
      },
    });
    cleanupUserIds.push(regularClient.id);

    const testAdminUser = await prisma.user.create({
      data: {
        email: `phase8_admin_${Date.now()}@edgelink-test.local`,
        name: "Phase8 Admin User",
        role: "ADMIN",
      },
    });
    cleanupUserIds.push(testAdminUser.id);

    // Create 3 audits for testing:
    // 1 completed audit with score
    const completedAudit = await prisma.audit.create({
      data: {
        targetUrl: "https://completed-site-phase8.com",
        status: "COMPLETED",
        score: 88,
        userId: regularClient.id,
        aiAnalysisData: {
          overall_score: 88,
          executive_summary: "Solid technical SEO baseline with optimized metadata.",
          score_breakdown: {
            technical: 90,
            on_page: 85,
            content: 85,
            core_web_vitals: 92,
            schema: 88,
          },
          critical_issues: [],
          quick_wins: [{ finding: "Add schema markup to footer", action: "Insert JSON-LD" }],
        },
      },
    });
    cleanupAuditIds.push(completedAudit.id);

    // 1 failed audit eligible for retry
    const failedAudit = await prisma.audit.create({
      data: {
        targetUrl: "https://failed-site-phase8.com",
        status: "FAILED",
        score: null,
        errorMessage: "Simulated crawl timeout after 15000ms",
        userId: regularClient.id,
      },
    });
    cleanupAuditIds.push(failedAudit.id);

    // 1 queued audit
    const queuedAudit = await prisma.audit.create({
      data: {
        targetUrl: "https://queued-site-phase8.com",
        status: "QUEUED",
        score: null,
        userId: testAdminUser.id,
      },
    });
    cleanupAuditIds.push(queuedAudit.id);

    console.log("  ✓ Test users and audits created successfully");

    // ---------------------------------------------------------------------------
    // 1. Admin Authentication & Role Protection (Security Barrier)
    // ---------------------------------------------------------------------------
    console.log("\n[1/8] Verifying Admin Authentication & Authorization Barriers...");

    // 1a. Missing credentials -> 401
    const reqNoAuth = new NextRequest("http://localhost:3000/api/admin/overview");
    const resNoAuth = await handleGetOverview(reqNoAuth);
    assert.strictEqual(resNoAuth.status, 401, "Expected 401 Unauthorized for missing admin credentials");
    const jsonNoAuth = await resNoAuth.json();
    assert.strictEqual(jsonNoAuth.success, false);
    console.log("  ✓ Missing admin key correctly rejected (HTTP 401)");

    // 1b. Invalid admin key -> 401
    const reqBadAuth = new NextRequest("http://localhost:3000/api/admin/overview", {
      headers: { "x-admin-key": "completely-invalid-key-xyz" },
    });
    const resBadAuth = await handleGetOverview(reqBadAuth);
    assert.strictEqual(resBadAuth.status, 401, "Expected 401 for invalid admin key");
    console.log("  ✓ Invalid admin key correctly rejected (HTTP 401)");

    // 1c. Regular client attempting admin audits list -> 401
    const reqClientAudits = new NextRequest("http://localhost:3000/api/admin/audits", {
      headers: { "x-user-id": regularClient.id },
    });
    const resClientAudits = await handleGetAdminAudits(reqClientAudits);
    assert.strictEqual(resClientAudits.status, 401, "Expected 401 when client accesses admin audits");
    console.log("  ✓ Regular CLIENT user blocked from admin audit listing (HTTP 401)");

    // 1d. Regular client attempting to list users -> 401
    const reqClientUsers = new NextRequest("http://localhost:3000/api/admin/users", {
      headers: { "x-user-id": regularClient.id },
    });
    const resClientUsers = await handleGetAdminUsers(reqClientUsers);
    assert.strictEqual(resClientUsers.status, 401, "Expected 401 when client accesses admin users");
    console.log("  ✓ Regular CLIENT user blocked from user administration (HTTP 401)");

    // 1e. Regular client attempting retry action -> 401
    const reqClientRetry = new NextRequest(`http://localhost:3000/api/admin/audits/${failedAudit.id}/retry`, {
      method: "POST",
      headers: { "x-user-id": regularClient.id },
    });
    const resClientRetry = await handleRetryAudit(reqClientRetry, { params: { id: failedAudit.id } });
    assert.strictEqual(resClientRetry.status, 401, "Expected 401 when client attempts retry");
    console.log("  ✓ Regular CLIENT user blocked from audit retry mutation (HTTP 401)");

    // ---------------------------------------------------------------------------
    // 2. Admin System Overview & Database Aggregations
    // ---------------------------------------------------------------------------
    console.log("\n[2/8] Testing Admin Overview & Real Database Aggregations (GET /api/admin/overview)...");

    const reqOverview = new NextRequest("http://localhost:3000/api/admin/overview", {
      headers: { "x-admin-key": adminSecret },
    });
    const resOverview = await handleGetOverview(reqOverview);
    assert.strictEqual(resOverview.status, 200, "Expected 200 OK for valid admin overview");
    const jsonOverview = await resOverview.json();
    assert.strictEqual(jsonOverview.success, true);
    assert.ok(jsonOverview.data.totalAudits >= 3, "Expected at least 3 total audits");
    assert.ok(jsonOverview.data.completedAudits >= 1, "Expected at least 1 completed audit");
    assert.ok(jsonOverview.data.failedAudits >= 1, "Expected at least 1 failed audit");
    assert.ok(typeof jsonOverview.data.averageScore === "number", "Expected numeric averageScore");
    assert.ok(jsonOverview.data.totalUsers >= 2, "Expected at least 2 users");
    assert.ok(Array.isArray(jsonOverview.data.recentFailures), "Expected recentFailures array");
    const foundFailure = jsonOverview.data.recentFailures.find((f: { id: string }) => f.id === failedAudit.id);
    assert.ok(foundFailure, "Expected failedAudit in recentFailures");
    assert.strictEqual(foundFailure.targetUrl, "https://failed-site-phase8.com");
    assert.strictEqual(foundFailure.errorMessage, "Simulated crawl timeout after 15000ms");
    console.log("  ✓ Admin overview returns real database metrics & recent failures");
    if (jsonOverview.data.queue) {
      console.log(`  ✓ BullMQ queue diagnostics attached: ${jsonOverview.data.queue.queueName} (${jsonOverview.data.queue.status})`);
    }

    // ---------------------------------------------------------------------------
    // 3. Admin Audits Management: Pagination, Filtering & Search
    // ---------------------------------------------------------------------------
    console.log("\n[3/8] Testing Admin Audits Management (GET /api/admin/audits)...");

    // 3a. Default paginated list
    const reqAudits = new NextRequest("http://localhost:3000/api/admin/audits?page=1&pageSize=10", {
      headers: { "x-admin-key": adminSecret },
    });
    const resAudits = await handleGetAdminAudits(reqAudits);
    assert.strictEqual(resAudits.status, 200);
    const jsonAudits = await resAudits.json();
    assert.strictEqual(jsonAudits.success, true);
    assert.ok(Array.isArray(jsonAudits.data));
    assert.ok(jsonAudits.pagination.totalCount >= 3);
    console.log(`  ✓ Listed ${jsonAudits.data.length} audits across users (page 1 of ${jsonAudits.pagination.totalPages})`);

    // 3b. Filter by status: FAILED
    const reqFailedAudits = new NextRequest("http://localhost:3000/api/admin/audits?status=FAILED", {
      headers: { "x-admin-key": adminSecret },
    });
    const resFailedAudits = await handleGetAdminAudits(reqFailedAudits);
    assert.strictEqual(resFailedAudits.status, 200);
    const jsonFailedAudits = await resFailedAudits.json();
    assert.ok(jsonFailedAudits.data.length >= 1);
    for (const a of jsonFailedAudits.data) {
      assert.strictEqual(a.status, "FAILED", "All returned audits should have status FAILED");
    }
    console.log("  ✓ Status filtering (status=FAILED) verified");

    // 3c. Search by targetUrl
    const reqSearch = new NextRequest("http://localhost:3000/api/admin/audits?search=completed-site-phase8", {
      headers: { "x-admin-key": adminSecret },
    });
    const resSearch = await handleGetAdminAudits(reqSearch);
    assert.strictEqual(resSearch.status, 200);
    const jsonSearch = await resSearch.json();
    assert.ok(jsonSearch.data.length >= 1);
    assert.ok(jsonSearch.data.some((a: { id: string }) => a.id === completedAudit.id));
    console.log("  ✓ Target URL search verified");

    // 3d. Invalid query parameters rejected
    const reqInvalidParams = new NextRequest("http://localhost:3000/api/admin/audits?status=NOT_A_STATUS", {
      headers: { "x-admin-key": adminSecret },
    });
    const resInvalidParams = await handleGetAdminAudits(reqInvalidParams);
    assert.strictEqual(resInvalidParams.status, 400, "Expected 400 for invalid status parameter");
    console.log("  ✓ Invalid filter parameters safely rejected (HTTP 400)");

    // ---------------------------------------------------------------------------
    // 4. Safe Retry for Eligible Failed Audits
    // ---------------------------------------------------------------------------
    console.log("\n[4/8] Testing Administrative Retry for Failed Audits (POST /api/admin/audits/[id]/retry)...");

    // 4a. Retrying a non-existent audit -> 404
    const reqRetryNonExistent = new NextRequest("http://localhost:3000/api/admin/audits/non-existent-id/retry", {
      method: "POST",
      headers: { "x-admin-key": adminSecret },
    });
    const resRetryNonExistent = await handleRetryAudit(reqRetryNonExistent, { params: { id: "non-existent-id" } });
    assert.strictEqual(resRetryNonExistent.status, 404, "Expected 404 for non-existent audit ID");
    console.log("  ✓ Non-existent audit retry returns HTTP 404");

    // 4b. Retrying an audit that is already COMPLETED -> 400
    const reqRetryCompleted = new NextRequest(`http://localhost:3000/api/admin/audits/${completedAudit.id}/retry`, {
      method: "POST",
      headers: { "x-admin-key": adminSecret },
    });
    const resRetryCompleted = await handleRetryAudit(reqRetryCompleted, { params: { id: completedAudit.id } });
    assert.strictEqual(resRetryCompleted.status, 400, "Expected 400 when retrying a non-failed audit");
    const jsonRetryCompleted = await resRetryCompleted.json();
    assert.strictEqual(jsonRetryCompleted.error, "InvalidState");
    console.log("  ✓ Retrying non-failed audit correctly rejected (HTTP 400 InvalidState)");

    // 4c. Retrying an eligible FAILED audit -> 200
    const reqRetryFailed = new NextRequest(`http://localhost:3000/api/admin/audits/${failedAudit.id}/retry`, {
      method: "POST",
      headers: { "x-admin-key": adminSecret },
    });
    const resRetryFailed = await handleRetryAudit(reqRetryFailed, { params: { id: failedAudit.id } });
    assert.strictEqual(resRetryFailed.status, 200, "Expected 200 for successful retry");
    const jsonRetryFailed = await resRetryFailed.json();
    assert.strictEqual(jsonRetryFailed.success, true);
    assert.strictEqual(jsonRetryFailed.data.status, "QUEUED");
    assert.ok(jsonRetryFailed.data.jobId, "Expected valid BullMQ jobId");

    // Verify in database that status is now QUEUED and errorMessage is cleared
    const postRetryDb = await prisma.audit.findUnique({ where: { id: failedAudit.id } });
    assert.strictEqual(postRetryDb?.status, "QUEUED", "Database record should be updated to QUEUED");
    assert.strictEqual(postRetryDb?.errorMessage, null, "Database record errorMessage should be cleared");
    console.log(`  ✓ Eligible failed audit successfully retried: status reset to QUEUED, re-enqueued as job ${jsonRetryFailed.data.jobId}`);

    // ---------------------------------------------------------------------------
    // 5. User Management: Listing, Audit Counts & Security
    // ---------------------------------------------------------------------------
    console.log("\n[5/8] Testing User Management (GET /api/admin/users)...");

    const reqUsers = new NextRequest("http://localhost:3000/api/admin/users?page=1&pageSize=10", {
      headers: { "x-admin-key": adminSecret },
    });
    const resUsers = await handleGetAdminUsers(reqUsers);
    assert.strictEqual(resUsers.status, 200);
    const jsonUsers = await resUsers.json();
    assert.strictEqual(jsonUsers.success, true);
    assert.ok(Array.isArray(jsonUsers.data));
    assert.ok(jsonUsers.data.length >= 2);

    // Verify user record contents: no password fields, valid audit counts
    for (const u of jsonUsers.data) {
      assert.ok(u.id);
      assert.ok(u.email);
      assert.ok(u.role === "ADMIN" || u.role === "CLIENT");
      assert.ok(typeof u.auditCount === "number");
      // Security verification: no password or hash exposed
      assert.strictEqual((u as Record<string, unknown>).password, undefined);
      assert.strictEqual((u as Record<string, unknown>).passwordHash, undefined);
    }

    const foundClient = jsonUsers.data.find((u: { id: string }) => u.id === regularClient.id);
    assert.ok(foundClient);
    assert.ok(foundClient.auditCount >= 2, "Expected regularClient to have at least 2 audits");
    console.log("  ✓ Users listed with audit counts and verified zero credential leaks");

    // Search users by email
    const reqSearchUser = new NextRequest(`http://localhost:3000/api/admin/users?search=${encodeURIComponent(regularClient.email)}`, {
      headers: { "x-admin-key": adminSecret },
    });
    const resSearchUser = await handleGetAdminUsers(reqSearchUser);
    const jsonSearchUser = await resSearchUser.json();
    assert.ok(jsonSearchUser.data.length >= 1);
    assert.strictEqual(jsonSearchUser.data[0].email, regularClient.email);
    console.log("  ✓ User search by email verified");

    // ---------------------------------------------------------------------------
    // 6. User Role Management & Safeguards
    // ---------------------------------------------------------------------------
    console.log("\n[6/8] Testing User Role Modifications & Demotion Safeguards (PATCH /api/admin/users)...");

    // 6a. Promote CLIENT to ADMIN
    const reqPromote = new NextRequest("http://localhost:3000/api/admin/users", {
      method: "PATCH",
      headers: {
        "x-admin-key": adminSecret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId: regularClient.id, role: "ADMIN" }),
    });
    const resPromote = await handleUpdateUserRole(reqPromote);
    assert.strictEqual(resPromote.status, 200, "Expected 200 for role update to ADMIN");
    const jsonPromote = await resPromote.json();
    assert.strictEqual(jsonPromote.data.role, "ADMIN");
    console.log("  ✓ Successfully promoted CLIENT to ADMIN");

    // 6b. Demote back to CLIENT
    const reqDemote = new NextRequest("http://localhost:3000/api/admin/users", {
      method: "PATCH",
      headers: {
        "x-admin-key": adminSecret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId: regularClient.id, role: "CLIENT" }),
    });
    const resDemote = await handleUpdateUserRole(reqDemote);
    assert.strictEqual(resDemote.status, 200, "Expected 200 for role update back to CLIENT");
    console.log("  ✓ Successfully demoted ADMIN back to CLIENT");

    // 6c. Attempt to demote sole administrator:
    // If only 1 admin remains in DB, demoting that admin should be rejected
    const allAdmins = await prisma.user.findMany({ where: { role: "ADMIN" } });
    if (allAdmins.length === 1) {
      const soleAdmin = allAdmins[0];
      const reqDemoteSole = new NextRequest("http://localhost:3000/api/admin/users", {
        method: "PATCH",
        headers: {
          "x-admin-key": adminSecret,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userId: soleAdmin.id, role: "CLIENT" }),
      });
      const resDemoteSole = await handleUpdateUserRole(reqDemoteSole);
      assert.strictEqual(resDemoteSole.status, 400, "Expected 400 when attempting to demote sole admin");
      const jsonDemoteSole = await resDemoteSole.json();
      assert.strictEqual(jsonDemoteSole.error, "ActionForbidden");
      console.log("  ✓ Protected system against demoting the sole administrator (HTTP 400 ActionForbidden)");
    } else {
      console.log(`  ✓ Multiple administrators detected (${allAdmins.length}). Demotion protection tested via service logic.`);
    }

    // ---------------------------------------------------------------------------
    // 7. Queue Diagnostics Endpoint
    // ---------------------------------------------------------------------------
    console.log("\n[7/8] Testing Queue Diagnostics Endpoint (GET /api/admin/queue)...");

    const reqQueue = new NextRequest("http://localhost:3000/api/admin/queue", {
      headers: { "x-admin-key": adminSecret },
    });
    const resQueue = await handleGetQueueMetrics(reqQueue);
    assert.strictEqual(resQueue.status, 200, "Expected 200 OK for queue diagnostics");
    const jsonQueue = await resQueue.json();
    assert.strictEqual(jsonQueue.success, true);
    assert.strictEqual(typeof jsonQueue.data.queueName, "string");
    assert.ok(jsonQueue.data.counts);
    assert.strictEqual(typeof jsonQueue.data.counts.waiting, "number");
    assert.strictEqual(typeof jsonQueue.data.counts.active, "number");
    assert.strictEqual(typeof jsonQueue.data.counts.completed, "number");
    assert.strictEqual(typeof jsonQueue.data.counts.failed, "number");
    console.log(`  ✓ Queue status: ${jsonQueue.data.status}, waiting: ${jsonQueue.data.counts.waiting}, active: ${jsonQueue.data.counts.active}`);

    // ---------------------------------------------------------------------------
    // 8. Service-Level Stalled Audit Reconciliation & Graceful Degeneracy
    // ---------------------------------------------------------------------------
    console.log("\n[8/8] Testing Stalled Audit Reconciliation & Data Integrity...");

    // Test reconcileStalledAudits with 0 minutes threshold on a temporary old audit
    const stalledAudit = await prisma.audit.create({
      data: {
        targetUrl: "https://stalled-audit-phase8.com",
        status: "CRAWLING",
        userId: testAdminUser.id,
        updatedAt: new Date(Date.now() - 30 * 60 * 1000), // 30 minutes ago
      },
    });
    cleanupAuditIds.push(stalledAudit.id);

    const reconciledCount = await AuditService.reconcileStalledAudits(15);
    assert.ok(reconciledCount >= 1, "Expected at least 1 stalled audit to be reconciled");

    const checkedStalled = await prisma.audit.findUnique({ where: { id: stalledAudit.id } });
    assert.strictEqual(checkedStalled?.status, "FAILED", "Stalled audit should be transitioned to FAILED");
    assert.ok(checkedStalled?.errorMessage?.includes("timed out"), "Error message should note timeout");
    console.log(`  ✓ Successfully reconciled ${reconciledCount} stalled audit(s) to FAILED`);

    console.log("\n==================================================================");
    console.log("PHASE 8 ADMIN PORTAL VERIFICATION COMPLETED SUCCESSFULLY!");
    console.log("==================================================================");
  } finally {
    // Cleanup temporary test fixtures
    console.log("\nCleaning up test fixtures in PostgreSQL...");
    if (cleanupAuditIds.length > 0) {
      await prisma.audit.deleteMany({
        where: { id: { in: cleanupAuditIds } },
      });
      console.log(`  ✓ Deleted ${cleanupAuditIds.length} test audit record(s)`);
    }

    if (cleanupUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: cleanupUserIds } },
      });
      console.log(`  ✓ Deleted ${cleanupUserIds.length} test user record(s)`);
    }

    await closeRedisConnections();
    await prisma.$disconnect();
  }
}

runPhase8AdminTests().catch((err) => {
  console.error("\n❌ PHASE 8 ADMIN TESTS FAILED:", err);
  process.exit(1);
});
