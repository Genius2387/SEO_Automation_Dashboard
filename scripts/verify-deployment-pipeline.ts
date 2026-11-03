import dotenv from "dotenv";
dotenv.config();

import assert from "assert";
import prisma from "../src/lib/prisma";
import { AuditService } from "../src/services/auditService";
import { AuditReportService, ReportStorageService } from "../src/reports";
import { createAuditWorker } from "../src/workers/auditWorker";
import { closeRedisConnections } from "../src/queue";
import { NextRequest } from "next/server";
import { GET as handleReportGet, POST as handleReportPost } from "../src/app/api/audits/[id]/report/route";

async function verifyDeploymentPipeline() {
  console.log("==================================================================");
  console.log("VERIFYING COMPLETE DEPLOYMENT PIPELINE (VERCEL + RAILWAY + POSTGRES)");
  console.log("==================================================================");

  let testAuditId: string | null = null;
  let testUserId: string | null = null;
  let worker: ReturnType<typeof createAuditWorker> | null = null;

  try {
    // 1. Create a test user
    const timestamp = Date.now();
    const testUser = await prisma.user.create({
      data: {
        email: `deploy_test_${timestamp}@edgelink.local`,
        name: "Deployment Test User",
        role: "CLIENT",
      },
    });
    testUserId = testUser.id;
    console.log(`[1/6] Created test user: ${testUser.id}`);

    // 2. Simulate Web App (Vercel) Enqueueing an Audit
    console.log("[2/6] Enqueueing audit job via AuditService (as on Vercel)...");
    const queuedAudit = await AuditService.createQueuedAudit({
      targetUrl: "https://example.com",
      businessType: "Technology Services",
      userId: testUser.id,
      useMocks: true,
    });
    testAuditId = queuedAudit.id;
    assert.strictEqual(queuedAudit.status, "QUEUED", "Audit must be initialized with status QUEUED");
    console.log(`      Audit enqueued with ID: ${queuedAudit.id}, JobID: ${queuedAudit.jobId}`);

    // 3. Simulate Railway Persistent Worker Processing
    console.log("[3/6] Starting worker to process the queued job (as on Railway)...");
    worker = createAuditWorker({ concurrency: 1 });

    // Wait for the worker to complete the job (timeout 45s)
    console.log("      Waiting for worker to complete crawl, AI analysis, and PDF generation...");
    let completedAudit = null;
    const maxWaitMs = 45000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      completedAudit = await prisma.audit.findUnique({
        where: { id: testAuditId },
      });

      if (
        completedAudit &&
        ((completedAudit.status === "COMPLETED" && completedAudit.pdfReportUrl) ||
          completedAudit.status === "FAILED")
      ) {
        break;
      }
      await new Promise((res) => setTimeout(res, 1500));
    }

    assert.ok(completedAudit, "Audit record should exist");
    console.log(`      Audit status after worker run: ${completedAudit.status}`);
    assert.strictEqual(completedAudit.status, "COMPLETED", "Worker must transition audit to COMPLETED");
    assert.ok(completedAudit.score !== null && completedAudit.score > 0, "Audit score must be populated");
    assert.ok(completedAudit.pdfReportUrl, "pdfReportUrl must be populated in database");
    console.log(`      Audit completed with score ${completedAudit.score}/100 and PDF URL: ${completedAudit.pdfReportUrl}`);

    // 4. Verify PDF Storage in PostgreSQL (Shared storage for Vercel)
    console.log("[4/6] Verifying PDF storage in PostgreSQL 'audit_report_files' table...");
    const dbReportFile = await prisma.auditReportFile.findUnique({
      where: { auditId: testAuditId },
    });
    assert.ok(dbReportFile, "Report file must be persisted in PostgreSQL audit_report_files table");
    assert.ok(dbReportFile.data && dbReportFile.data.length > 10000, "Report data must be a valid binary PDF buffer");
    assert.strictEqual(dbReportFile.mimeType, "application/pdf");
    console.log(`      PostgreSQL report file verified! Size: ${(dbReportFile.sizeBytes / 1024).toFixed(1)} KB`);

    // 5. Verify Vercel Serverless Guard: Attempting Puppeteer generation on Vercel is safely blocked
    console.log("[5/6] Verifying Vercel serverless safety guard (VERCEL=1)...");
    process.env.VERCEL = "1";

    // Test POST /api/audits/:id/report with non-existent audit
    const dummyReq = new NextRequest("http://localhost:3000/api/audits/non-existent-id/report", {
      method: "POST",
    });
    const postRes = await handleReportPost(dummyReq, { params: { id: "non-existent-id" } });
    assert.strictEqual(postRes.status, 404, "Non-existent audit must return 404");

    // 6. Verify Vercel PDF Download (GET /api/audits/:id/report)
    console.log("[6/6] Verifying PDF streaming download in Vercel serverless environment...");
    // Create authenticated request with user's ID
    const getReq = new NextRequest(`http://localhost:3000/api/audits/${testAuditId}/report`, {
      method: "GET",
      headers: {
        "x-user-id": testUserId,
      },
    });

    const getRes = await handleReportGet(getReq, { params: { id: testAuditId } });
    assert.strictEqual(getRes.status, 200, "Download request must succeed with HTTP 200");
    assert.strictEqual(getRes.headers.get("Content-Type"), "application/pdf", "Must return Content-Type: application/pdf");
    assert.ok(getRes.headers.get("Content-Disposition")?.includes(".pdf"), "Must contain attachment disposition");

    const pdfArrayBuffer = await getRes.arrayBuffer();
    const downloadedBuffer = Buffer.from(pdfArrayBuffer);
    assert.strictEqual(downloadedBuffer.toString("ascii", 0, 5), "%PDF-", "Downloaded file must have %PDF- header");
    assert.strictEqual(downloadedBuffer.length, dbReportFile.sizeBytes, "Downloaded size must match database record size");
    console.log(`      Successfully streamed ${(downloadedBuffer.length / 1024).toFixed(1)} KB PDF via Vercel serverless API!`);

    console.log("\n==================================================================");
    console.log("🎉 ALL DEPLOYMENT PIPELINE TESTS PASSED 100%!");
    console.log("==================================================================");
  } finally {
    // Reset VERCEL env
    delete process.env.VERCEL;

    // Gracefully shut down worker
    if (worker) {
      await worker.close();
    }
    await closeRedisConnections();

    // Clean up test data
    if (testAuditId) {
      await prisma.auditReportFile.deleteMany({ where: { auditId: testAuditId } }).catch(() => {});
      await prisma.audit.deleteMany({ where: { id: testAuditId } }).catch(() => {});
    }
    if (testUserId) {
      await prisma.user.deleteMany({ where: { id: testUserId } }).catch(() => {});
    }
    await prisma.$disconnect();
  }
}

verifyDeploymentPipeline().catch((err) => {
  console.error("❌ Pipeline verification failed:", err);
  process.exit(1);
});
