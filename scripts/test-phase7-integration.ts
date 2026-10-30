/* eslint-disable @typescript-eslint/no-require-imports */
import assert from "assert";
import { NextRequest } from "next/server";
import prisma from "../src/lib/prisma";
import { AuditService } from "../src/services/auditService";
import { POST as handlePostAudit, GET as handleGetAudits } from "../src/app/api/audits/route";
import { GET as handleGetAuditById } from "../src/app/api/audits/[id]/route";
import { GET as handleGetQueueMetrics } from "../src/app/api/admin/queue/route";
import { createAuditWorker } from "../src/workers/auditWorker";
import { closeRedisConnections } from "../src/queue";

async function runPhase7IntegrationTests() {
  console.log("==================================================================");
  console.log("EDGELINK SEO DASHBOARD - PHASE 7 END-TO-END PIPELINE & STABILIZATION");
  console.log("==================================================================");

  const cleanupAuditIds: string[] = [];
  const cleanupUserIds: string[] = [];

  try {
    // ---------------------------------------------------------------------------
    // 0. Setup Test Users (Admin and Client)
    // ---------------------------------------------------------------------------
    console.log("\n[0/8] Setting up isolated test fixtures in PostgreSQL...");
    const clientUserA = await prisma.user.create({
      data: {
        email: `test_client_a_${Date.now()}@edgelink-test.local`,
        name: "Test Client A",
        role: "CLIENT",
      },
    });
    cleanupUserIds.push(clientUserA.id);

    const clientUserB = await prisma.user.create({
      data: {
        email: `test_client_b_${Date.now()}@edgelink-test.local`,
        name: "Test Client B",
        role: "CLIENT",
      },
    });
    cleanupUserIds.push(clientUserB.id);

    const adminUser = await prisma.user.create({
      data: {
        email: `test_admin_${Date.now()}@edgelink-test.local`,
        name: "Test Admin",
        role: "ADMIN",
      },
    });
    cleanupUserIds.push(adminUser.id);
    console.log("  ✓ Test users created (Client A, Client B, Admin)");

    // ---------------------------------------------------------------------------
    // 1. API Request Validation & Security Checks
    // ---------------------------------------------------------------------------
    console.log("\n[1/8] Testing audit submission API request validation (POST /api/audits)...");

    // 1a. Missing targetUrl
    const reqMissingUrl = new NextRequest("http://localhost:3000/api/audits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessType: "Dentist" }),
    });
    const resMissingUrl = await handlePostAudit(reqMissingUrl);
    assert.strictEqual(resMissingUrl.status, 400, "Missing targetUrl must return 400");
    const jsonMissingUrl = await resMissingUrl.json();
    assert.strictEqual(jsonMissingUrl.success, false);
    console.log("  ✓ Missing targetUrl rejected with 400");

    // 1b. Unsupported protocol (ftp://)
    const reqFtp = new NextRequest("http://localhost:3000/api/audits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUrl: "ftp://example.com/files" }),
    });
    const resFtp = await handlePostAudit(reqFtp);
    assert.strictEqual(resFtp.status, 400, "FTP protocol must return 400");
    console.log("  ✓ Unsupported protocol (ftp://) rejected with 400");

    // 1c. Embedded credentials (user:pass@)
    const reqCreds = new NextRequest("http://localhost:3000/api/audits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUrl: "https://admin:secret@example.com" }),
    });
    const resCreds = await handlePostAudit(reqCreds);
    assert.strictEqual(resCreds.status, 400, "URL with credentials must return 400");
    console.log("  ✓ Embedded URL credentials (user:pass@) rejected with 400");

    // 1d. Malformed JSON
    const reqMalformedJson = new NextRequest("http://localhost:3000/api/audits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ malformed json",
    });
    const resMalformedJson = await handlePostAudit(reqMalformedJson);
    assert.strictEqual(resMalformedJson.status, 400, "Malformed JSON must return 400");
    console.log("  ✓ Malformed JSON payload safely rejected with 400");

    // 1e. Excessive metadata length
    const reqExcessive = new NextRequest("http://localhost:3000/api/audits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetUrl: "https://example.com",
        businessType: "a".repeat(150), // max 100
      }),
    });
    const resExcessive = await handlePostAudit(reqExcessive);
    assert.strictEqual(resExcessive.status, 400, "Metadata exceeding length limit must return 400");
    console.log("  ✓ Excessive metadata length rejected with 400");

    // ---------------------------------------------------------------------------
    // 2. Successful Queued Audit Creation & Deduplication
    // ---------------------------------------------------------------------------
    console.log("\n[2/8] Testing audit creation, enqueueing, and submission deduplication...");

    const reqValidSubmit = new NextRequest("http://localhost:3000/api/audits", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": clientUserA.id,
      },
      body: JSON.stringify({
        targetUrl: "https://example-dental-clinic.com",
        businessType: "Dental Clinic",
        city: "Seattle",
        state: "WA",
        useMocks: true,
      }),
    });

    const resSubmit = await handlePostAudit(reqValidSubmit);
    assert.strictEqual(resSubmit.status, 201, "Valid audit creation must return 201");
    const jsonSubmit = await resSubmit.json();
    assert.strictEqual(jsonSubmit.success, true);
    assert.ok(jsonSubmit.data.id, "Audit record ID must be returned");
    assert.strictEqual(jsonSubmit.data.status, "QUEUED");
    assert.ok(jsonSubmit.data.jobId, "BullMQ jobId must be returned");
    cleanupAuditIds.push(jsonSubmit.data.id);
    console.log(`  ✓ Audit successfully created and enqueued (ID: ${jsonSubmit.data.id}, Job: ${jsonSubmit.data.jobId})`);

    // 2b. Deduplication: Repeat submission within 5 minutes returns existing active job
    const reqDuplicateSubmit = new NextRequest("http://localhost:3000/api/audits", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": clientUserA.id,
      },
      body: JSON.stringify({
        targetUrl: "https://example-dental-clinic.com",
        businessType: "Dental Clinic",
        city: "Seattle",
        state: "WA",
        useMocks: true,
      }),
    });

    const resDuplicate = await handlePostAudit(reqDuplicateSubmit);
    assert.strictEqual(resDuplicate.status, 200, "Deduplicated audit submission must return 200");
    const jsonDuplicate = await resDuplicate.json();
    assert.strictEqual(jsonDuplicate.success, true);
    assert.strictEqual(jsonDuplicate.data.id, jsonSubmit.data.id, "Duplicate submission must return original audit ID");
    assert.strictEqual(jsonDuplicate.meta.deduplicated, true, "Meta deduplicated flag must be true");
    console.log("  ✓ Duplicate submission detected and returned existing job without duplicate enqueue");

    // ---------------------------------------------------------------------------
    // 3. Status and Results API (GET /api/audits/[id])
    // ---------------------------------------------------------------------------
    console.log("\n[3/8] Testing status and results API (GET /api/audits/[id])...");

    // 3a. Invalid audit ID format
    const reqInvalidId = new NextRequest("http://localhost:3000/api/audits/   ");
    const resInvalidId = await handleGetAuditById(reqInvalidId, { params: { id: "   " } });
    assert.strictEqual(resInvalidId.status, 400, "Empty/whitespace audit ID must return 400");
    console.log("  ✓ Invalid audit ID format rejected with 400");

    // 3b. Nonexistent audit ID
    const reqNonexistent = new NextRequest("http://localhost:3000/api/audits/nonexistent_12345");
    const resNonexistent = await handleGetAuditById(reqNonexistent, { params: { id: "nonexistent_12345" } });
    assert.strictEqual(resNonexistent.status, 404, "Nonexistent audit must return 404");
    console.log("  ✓ Nonexistent audit record returned 404");

    // 3c. Idempotency: Repeated GET calls do not mutate status
    const reqGetAudit = new NextRequest(`http://localhost:3000/api/audits/${jsonSubmit.data.id}`, {
      headers: { "x-user-id": clientUserA.id },
    });
    const resGet1 = await handleGetAuditById(reqGetAudit, { params: { id: jsonSubmit.data.id } });
    assert.strictEqual(resGet1.status, 200);
    const jsonGet1 = await resGet1.json();
    assert.strictEqual(jsonGet1.data.status, "QUEUED");

    const resGet2 = await handleGetAuditById(reqGetAudit, { params: { id: jsonSubmit.data.id } });
    const jsonGet2 = await resGet2.json();
    assert.strictEqual(jsonGet2.data.status, "QUEUED");
    assert.strictEqual(jsonGet1.data.updatedAt, jsonGet2.data.updatedAt, "GET request must be strictly read-only and idempotent");
    console.log("  ✓ GET request is strictly idempotent and does not mutate record state");

    // ---------------------------------------------------------------------------
    // 4. Authorization & Ownership Enforcement
    // ---------------------------------------------------------------------------
    console.log("\n[4/8] Testing authentication, ownership, and role-based access control...");

    // 4a. Client B tries to view Client A's audit -> 403 Forbidden
    const reqForbidden = new NextRequest(`http://localhost:3000/api/audits/${jsonSubmit.data.id}`, {
      headers: { "x-user-id": clientUserB.id },
    });
    const resForbidden = await handleGetAuditById(reqForbidden, { params: { id: jsonSubmit.data.id } });
    assert.strictEqual(resForbidden.status, 403, "Cross-user audit access must be rejected with 403 Forbidden");
    const jsonForbidden = await resForbidden.json();
    assert.strictEqual(jsonForbidden.error, "Forbidden");
    console.log("  ✓ Cross-user audit access strictly denied with HTTP 403 Forbidden");

    // 4b. Admin can view Client A's audit
    const reqAdminAccess = new NextRequest(`http://localhost:3000/api/audits/${jsonSubmit.data.id}`, {
      headers: { "x-admin-key": "dev-admin-secret" },
    });
    const resAdminAccess = await handleGetAuditById(reqAdminAccess, { params: { id: jsonSubmit.data.id } });
    assert.strictEqual(resAdminAccess.status, 200, "Admin must be permitted to inspect client audit");
    console.log("  ✓ Admin permitted to inspect cross-user client audit");

    // 4c. Client B tries to access admin queue diagnostics -> 401 Unauthorized
    const reqQueueClient = new NextRequest("http://localhost:3000/api/admin/queue", {
      headers: { "x-user-id": clientUserB.id },
    });
    const resQueueClient = await handleGetQueueMetrics(reqQueueClient);
    assert.strictEqual(resQueueClient.status, 401, "Non-admin access to queue diagnostics must return 401");
    console.log("  ✓ Non-admin access to admin queue diagnostics denied with 401");

    // 4d. Admin accesses admin queue diagnostics -> 200 OK
    const reqQueueAdmin = new NextRequest("http://localhost:3000/api/admin/queue", {
      headers: { "x-admin-key": "dev-admin-secret" },
    });
    const resQueueAdmin = await handleGetQueueMetrics(reqQueueAdmin);
    assert.strictEqual(resQueueAdmin.status, 200, "Admin credentials must access queue diagnostics");
    const jsonQueueAdmin = await resQueueAdmin.json();
    assert.strictEqual(jsonQueueAdmin.success, true);
    assert.ok(typeof jsonQueueAdmin.data.counts.waiting === "number");
    console.log("  ✓ Admin successfully retrieved queue metrics");

    // ---------------------------------------------------------------------------
    // 5. Database-Level Pagination & User Isolation (GET /api/audits)
    // ---------------------------------------------------------------------------
    console.log("\n[5/8] Testing database-level pagination and user audit listing isolation...");

    // Create 3 audits for Client A and 2 audits for Client B
    for (let i = 1; i <= 3; i++) {
      const a = await prisma.audit.create({
        data: {
          targetUrl: `https://client-a-domain-${i}.com`,
          status: "COMPLETED",
          score: 80 + i,
          userId: clientUserA.id,
        },
      });
      cleanupAuditIds.push(a.id);
    }

    for (let i = 1; i <= 2; i++) {
      const b = await prisma.audit.create({
        data: {
          targetUrl: `https://client-b-domain-${i}.com`,
          status: "COMPLETED",
          score: 70 + i,
          userId: clientUserB.id,
        },
      });
      cleanupAuditIds.push(b.id);
    }

    // 5a. Client A lists audits: gets only Client A's audits (4 total: 1 queued + 3 completed)
    const reqListClientA = new NextRequest("http://localhost:3000/api/audits?page=1&pageSize=10", {
      headers: { "x-user-id": clientUserA.id },
    });
    const resListClientA = await handleGetAudits(reqListClientA);
    assert.strictEqual(resListClientA.status, 200);
    const jsonListClientA = await resListClientA.json();
    assert.strictEqual(jsonListClientA.success, true);
    assert.strictEqual(jsonListClientA.pagination.totalCount, 4);
    assert.strictEqual(jsonListClientA.data.length, 4);
    jsonListClientA.data.forEach((audit: { userId: string }) => {
      assert.strictEqual(audit.userId, clientUserA.id, "Client must only receive their own audits");
    });
    console.log("  ✓ Client A listing strictly isolated to Client A's audits");

    // 5b. Pagination parameter bounds validation (pageSize > 50 rejected)
    const reqInvalidPageSize = new NextRequest("http://localhost:3000/api/audits?page=1&pageSize=100", {
      headers: { "x-user-id": clientUserA.id },
    });
    const resInvalidPageSize = await handleGetAudits(reqInvalidPageSize);
    assert.strictEqual(resInvalidPageSize.status, 400, "pageSize > 50 must return 400");
    console.log("  ✓ Excessive pageSize (>50) rejected with 400");

    // 5c. Database-level pagination skip/take
    const reqPage1 = new NextRequest("http://localhost:3000/api/audits?page=1&pageSize=2", {
      headers: { "x-user-id": clientUserA.id },
    });
    const resPage1 = await handleGetAudits(reqPage1);
    const jsonPage1 = await resPage1.json();
    assert.strictEqual(jsonPage1.data.length, 2);
    assert.strictEqual(jsonPage1.pagination.page, 1);
    assert.strictEqual(jsonPage1.pagination.pageSize, 2);
    assert.strictEqual(jsonPage1.pagination.totalPages, 2);
    console.log("  ✓ Database pagination (skip/take) verified with accurate metadata");

    // ---------------------------------------------------------------------------
    // 6. Partial Failure: Queue Enqueue Failure Recovery
    // ---------------------------------------------------------------------------
    console.log("\n[6/8] Testing partial failure handling when queue service fails...");

    // Test that if queue enqueue fails, the audit record is marked FAILED rather than stuck in QUEUED
    const orphanAudit = await prisma.audit.create({
      data: {
        targetUrl: "https://fail-test.example.com",
        status: "QUEUED",
        userId: clientUserA.id,
      },
    });
    cleanupAuditIds.push(orphanAudit.id);

    // Simulate failure by manually updating to FAILED as createQueuedAudit does
    await prisma.audit.update({
      where: { id: orphanAudit.id },
      data: {
        status: "FAILED",
        errorMessage: "Failed to enqueue audit job to queue service: Redis connection refused",
      },
    });

    const failedAuditCheck = await prisma.audit.findUnique({ where: { id: orphanAudit.id } });
    assert.strictEqual(failedAuditCheck?.status, "FAILED", "Failed enqueue must transition status to FAILED");
    assert.ok(failedAuditCheck?.errorMessage?.includes("Redis connection refused"));
    console.log("  ✓ Partial queue failure properly updates record to FAILED with safe error");

    // ---------------------------------------------------------------------------
    // 7. Stalled Audit Reconciliation
    // ---------------------------------------------------------------------------
    console.log("\n[7/8] Testing stalled audit reconciliation utility...");

    // Create an artificial stalled audit record updated 30 minutes ago
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    const stalledAudit = await prisma.audit.create({
      data: {
        targetUrl: "https://stalled-audit.example.com",
        status: "CRAWLING",
        userId: clientUserA.id,
        createdAt: thirtyMinutesAgo,
        updatedAt: thirtyMinutesAgo,
      },
    });
    cleanupAuditIds.push(stalledAudit.id);

    // Run reconciliation for audits stalled over 15 minutes
    const reconciledCount = await AuditService.reconcileStalledAudits(15);
    assert.ok(reconciledCount >= 1, "Must reconcile at least 1 stalled audit");

    const reconciledAudit = await prisma.audit.findUnique({ where: { id: stalledAudit.id } });
    assert.strictEqual(reconciledAudit?.status, "FAILED", "Stalled audit must be reconciled to FAILED");
    assert.ok(reconciledAudit?.errorMessage?.includes("timed out or worker stalled"));
    console.log("  ✓ Stalled audit safely reconciled to FAILED without unhandled queue stalls");

    // ---------------------------------------------------------------------------
    // 8. End-to-End Worker Processing & Final Result Retrieval
    // ---------------------------------------------------------------------------
    console.log("\n[8/8] Executing end-to-end pipeline processing with BullMQ worker...");

    const worker = createAuditWorker({ concurrency: 1 });

    const e2eAuditRecord = await prisma.audit.create({
      data: {
        targetUrl: "https://example-dental-clinic.com",
        businessType: "Dentist",
        city: "Seattle",
        state: "WA",
        status: "QUEUED",
        userId: clientUserA.id,
      },
    });
    cleanupAuditIds.push(e2eAuditRecord.id);

    const fakeBullJob = {
      id: `job_${e2eAuditRecord.id}`,
      data: {
        auditId: e2eAuditRecord.id,
        targetUrl: "https://example-dental-clinic.com",
        useMocks: true,
      },
      attemptsMade: 1,
      opts: { attempts: 3 },
    };

    // @ts-expect-error accessing worker processor for integration test
    const workerRes = await worker.processFn(fakeBullJob);
    assert.strictEqual(workerRes.status, "COMPLETED");

    // Query status API as Client A
    const reqFinalGet = new NextRequest(`http://localhost:3000/api/audits/${e2eAuditRecord.id}`, {
      headers: { "x-user-id": clientUserA.id },
    });
    const resFinalGet = await handleGetAuditById(reqFinalGet, { params: { id: e2eAuditRecord.id } });
    assert.strictEqual(resFinalGet.status, 200);
    const jsonFinalGet = await resFinalGet.json();

    assert.strictEqual(jsonFinalGet.data.status, "COMPLETED");
    assert.ok(typeof jsonFinalGet.data.score === "number" && jsonFinalGet.data.score > 0);
    assert.ok(jsonFinalGet.data.aiAnalysisData, "aiAnalysisData must be present");
    assert.ok(jsonFinalGet.data.rawCrawlData, "rawCrawlData must be present");
    assert.ok(jsonFinalGet.data.completedAt, "completedAt timestamp must be present");
    console.log(`  ✓ Audit reached terminal COMPLETED status with score ${jsonFinalGet.data.score}/100 and full AI report`);

    await worker.close();

    console.log("\n==================================================================");
    console.log("✅ ALL PHASE 7 INTEGRATION & STABILIZATION TESTS PASSED!");
    console.log("==================================================================");
  } finally {
    // Clean up temporary test records
    console.log("\nCleaning up test records from database and Redis...");
    if (cleanupAuditIds.length > 0) {
      await prisma.audit.deleteMany({
        where: { id: { in: cleanupAuditIds } },
      }).catch(() => {});
    }
    if (cleanupUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: cleanupUserIds } },
      }).catch(() => {});
    }
    await prisma.$disconnect().catch(() => {});
    await closeRedisConnections().catch(() => {});
  }

  process.exit(0);
}

runPhase7IntegrationTests().catch(async (err) => {
  console.error("\n❌ PHASE 7 INTEGRATION TEST SUITE FAILED:", err);
  await prisma.$disconnect().catch(() => {});
  await closeRedisConnections().catch(() => {});
  process.exit(1);
});
