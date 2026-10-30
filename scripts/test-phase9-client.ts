/* eslint-disable @typescript-eslint/no-require-imports */
import dotenv from "dotenv";
dotenv.config();

import assert from "assert";
import { NextRequest } from "next/server";
import prisma from "../src/lib/prisma";
import { AuditService } from "../src/services/auditService";
import { POST as handlePostAudit, GET as handleGetAudits } from "../src/app/api/audits/route";
import { GET as handleGetAuditById } from "../src/app/api/audits/[id]/route";
import { GET as handleGetClientOverview } from "../src/app/api/audits/overview/route";
import { closeRedisConnections } from "../src/queue";

async function runPhase9ClientTests() {
  console.log("==================================================================");
  console.log("EDGELINK SEO DASHBOARD - PHASE 9 CLIENT DASHBOARD & AUDIT EXPERIENCE");
  console.log("==================================================================");

  const cleanupAuditIds: string[] = [];
  const cleanupUserIds: string[] = [];

  try {
    // ---------------------------------------------------------------------------
    // 0. Setup Isolated Test Clients
    // ---------------------------------------------------------------------------
    console.log("\n[0/7] Setting up isolated test fixtures in PostgreSQL...");

    const clientAlice = await prisma.user.create({
      data: {
        email: `alice_${Date.now()}@edgelink-test.local`,
        name: "Alice Client",
        role: "CLIENT",
      },
    });
    cleanupUserIds.push(clientAlice.id);

    const clientBob = await prisma.user.create({
      data: {
        email: `bob_${Date.now()}@edgelink-test.local`,
        name: "Bob Client",
        role: "CLIENT",
      },
    });
    cleanupUserIds.push(clientBob.id);

    console.log(`  ✓ Created test clients: Alice (${clientAlice.id}), Bob (${clientBob.id})`);

    // ---------------------------------------------------------------------------
    // 1. Audit Submission & Request Validation
    // ---------------------------------------------------------------------------
    console.log("\n[1/7] Testing Audit Submission & Client Validation (POST /api/audits)...");

    // 1a. Invalid URL protocol (ftp://)
    const reqFtp = new NextRequest("http://localhost:3000/api/audits", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": clientAlice.id,
      },
      body: JSON.stringify({ targetUrl: "ftp://example.com" }),
    });
    const resFtp = await handlePostAudit(reqFtp);
    assert.strictEqual(resFtp.status, 400, "Expected 400 for ftp protocol");
    console.log("  ✓ Unsupported protocol (ftp://) rejected with HTTP 400");

    // 1b. Embedded credentials (user:pass@)
    const reqCreds = new NextRequest("http://localhost:3000/api/audits", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": clientAlice.id,
      },
      body: JSON.stringify({ targetUrl: "https://user:password@example.com" }),
    });
    const resCreds = await handlePostAudit(reqCreds);
    assert.strictEqual(resCreds.status, 400, "Expected 400 for embedded credentials");
    console.log("  ✓ URLs with embedded credentials rejected with HTTP 400");

    // 1c. Valid submission with optional metadata
    const reqValid = new NextRequest("http://localhost:3000/api/audits", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": clientAlice.id,
      },
      body: JSON.stringify({
        targetUrl: "https://alice-dental-clinic-pune.com",
        businessType: "Dental Healthcare",
        city: "Pune",
        state: "Maharashtra",
      }),
    });
    const resValid = await handlePostAudit(reqValid);
    assert.strictEqual(resValid.status, 201, "Expected 201 for valid submission");
    const jsonValid = await resValid.json();
    assert.strictEqual(jsonValid.success, true);
    assert.ok(jsonValid.data.id);
    assert.strictEqual(jsonValid.data.status, "QUEUED");
    cleanupAuditIds.push(jsonValid.data.id);
    const aliceAudit1Id = jsonValid.data.id;
    console.log(`  ✓ Valid audit created and enqueued: ${aliceAudit1Id} (QUEUED)`);

    // 1d. Duplicate submission prevention (submitting same URL within 5 minutes)
    const reqDuplicate = new NextRequest("http://localhost:3000/api/audits", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": clientAlice.id,
      },
      body: JSON.stringify({
        targetUrl: "https://alice-dental-clinic-pune.com",
      }),
    });
    const resDuplicate = await handlePostAudit(reqDuplicate);
    assert.strictEqual(resDuplicate.status, 200, "Expected 200 for duplicate submission");
    const jsonDuplicate = await resDuplicate.json();
    assert.strictEqual(jsonDuplicate.success, true);
    assert.strictEqual(jsonDuplicate.data.id, aliceAudit1Id);
    assert.strictEqual(jsonDuplicate.meta.deduplicated, true);
    console.log("  ✓ Active duplicate submission prevented: existing job returned without duplicate enqueue");

    // ---------------------------------------------------------------------------
    // 2. Client Authentication & Data Isolation (Ownership Enforcement)
    // ---------------------------------------------------------------------------
    console.log("\n[2/7] Testing Client Data Isolation & Ownership Access Control...");

    // 2a. Alice can access her own audit
    const reqAliceGet = new NextRequest(`http://localhost:3000/api/audits/${aliceAudit1Id}`, {
      headers: { "x-user-id": clientAlice.id },
    });
    const resAliceGet = await handleGetAuditById(reqAliceGet, { params: { id: aliceAudit1Id } });
    assert.strictEqual(resAliceGet.status, 200, "Alice should be able to view her own audit");
    const jsonAliceGet = await resAliceGet.json();
    assert.strictEqual(jsonAliceGet.data.id, aliceAudit1Id);
    console.log("  ✓ Alice successfully accessed her private audit");

    // 2b. Bob attempts to access Alice's audit -> 403 Forbidden
    const reqBobGet = new NextRequest(`http://localhost:3000/api/audits/${aliceAudit1Id}`, {
      headers: { "x-user-id": clientBob.id },
    });
    const resBobGet = await handleGetAuditById(reqBobGet, { params: { id: aliceAudit1Id } });
    assert.strictEqual(resBobGet.status, 403, "Bob must be denied access to Alice's audit");
    const jsonBobGet = await resBobGet.json();
    assert.strictEqual(jsonBobGet.error, "Forbidden");
    console.log("  ✓ Cross-client audit inspection strictly blocked (HTTP 403 Forbidden)");

    // 2c. Anonymous requester attempts to access Alice's private audit -> 403 Forbidden
    const reqAnonGet = new NextRequest(`http://localhost:3000/api/audits/${aliceAudit1Id}`);
    const resAnonGet = await handleGetAuditById(reqAnonGet, { params: { id: aliceAudit1Id } });
    assert.strictEqual(resAnonGet.status, 403, "Anonymous caller must be denied access to private audit");
    console.log("  ✓ Unauthenticated requester blocked from private client audit (HTTP 403 Forbidden)");

    // 2d. Public / Anonymous audit can be retrieved by possessing the ID
    const anonAudit = await prisma.audit.create({
      data: {
        targetUrl: "https://anonymous-public-site.com",
        status: "QUEUED",
        userId: null,
      },
    });
    cleanupAuditIds.push(anonAudit.id);

    const reqPublicAudit = new NextRequest(`http://localhost:3000/api/audits/${anonAudit.id}`);
    const resPublicAudit = await handleGetAuditById(reqPublicAudit, { params: { id: anonAudit.id } });
    assert.strictEqual(resPublicAudit.status, 200, "Public anonymous audit should be accessible with ID");
    console.log("  ✓ Anonymous public audit accessible with possession of audit ID");

    // ---------------------------------------------------------------------------
    // 3. Client Dashboard Overview Metrics (GET /api/audits/overview)
    // ---------------------------------------------------------------------------
    console.log("\n[3/7] Testing Client Overview Metrics Aggregation (GET /api/audits/overview)...");

    // Seed completed audit with score for Alice
    const aliceCompletedAudit = await prisma.audit.create({
      data: {
        targetUrl: "https://alice-completed-clinic.com",
        status: "COMPLETED",
        score: 86,
        userId: clientAlice.id,
        aiAnalysisData: {
          overall_score: 86,
          executive_summary: "Strong on-page signals and clean technical hierarchy.",
          score_breakdown: {
            technical: 88,
            on_page: 85,
            content: 85,
            core_web_vitals: 90,
            schema: 80,
          },
          critical_issues: [],
          important_issues: [
            {
              title: "Missing H1 on contact page",
              severity: "HIGH",
              category: "OnPage",
              description: "The contact page lacks a top-level H1 tag.",
              evidence: "<h1> count: 0",
              recommendation: "Add descriptive H1 heading to page.",
            },
          ],
          quick_wins: [
            {
              finding: "Add OpenGraph image tags",
              fix: "Specify og:image in <head>",
              estimated_impact: "MEDIUM",
              effort: "LOW",
              priority: "MEDIUM",
              category: "OnPage",
            },
          ],
          recommendations: [
            {
              finding: "Implement MedicalBusiness Schema JSON-LD",
              fix: "Add @type MedicalBusiness markup",
              estimated_impact: "HIGH",
              effort: "MEDIUM",
              priority: "HIGH",
              category: "Schema",
              falsifiability_check: "Verify with Google Rich Results Test",
            },
          ],
        },
      },
    });
    cleanupAuditIds.push(aliceCompletedAudit.id);

    // Seed failed audit for Alice
    const aliceFailedAudit = await prisma.audit.create({
      data: {
        targetUrl: "https://alice-unreachable-site.com",
        status: "FAILED",
        errorMessage: "DNS lookup failed for host 'alice-unreachable-site.com'",
        userId: clientAlice.id,
      },
    });
    cleanupAuditIds.push(aliceFailedAudit.id);

    const reqOverviewAlice = new NextRequest("http://localhost:3000/api/audits/overview", {
      headers: { "x-user-id": clientAlice.id },
    });
    const resOverviewAlice = await handleGetClientOverview(reqOverviewAlice);
    assert.strictEqual(resOverviewAlice.status, 200);
    const jsonOverviewAlice = await resOverviewAlice.json();
    assert.strictEqual(jsonOverviewAlice.success, true);
    assert.strictEqual(jsonOverviewAlice.data.totalAudits, 3, "Alice should have 3 total audits");
    assert.strictEqual(jsonOverviewAlice.data.completedAudits, 1, "Alice should have 1 completed audit");
    assert.strictEqual(jsonOverviewAlice.data.processingAudits, 1, "Alice should have 1 processing audit");
    assert.strictEqual(jsonOverviewAlice.data.failedAudits, 1, "Alice should have 1 failed audit");
    assert.strictEqual(jsonOverviewAlice.data.latestScore, 86, "Alice latest score should be 86");
    assert.strictEqual(jsonOverviewAlice.data.averageScore, 86, "Alice average score should be 86");
    assert.strictEqual(jsonOverviewAlice.meta.userId, clientAlice.id);
    console.log("  ✓ Alice's overview metrics aggregated with exact database counts");

    // Bob's overview must reflect zero audits (strict isolation)
    const reqOverviewBob = new NextRequest("http://localhost:3000/api/audits/overview", {
      headers: { "x-user-id": clientBob.id },
    });
    const resOverviewBob = await handleGetClientOverview(reqOverviewBob);
    const jsonOverviewBob = await resOverviewBob.json();
    assert.strictEqual(jsonOverviewBob.data.totalAudits, 0, "Bob must see 0 audits");
    assert.strictEqual(jsonOverviewBob.data.completedAudits, 0);
    assert.strictEqual(jsonOverviewBob.data.latestScore, null);
    console.log("  ✓ Bob's overview verified as cleanly isolated (0 audits)");

    // ---------------------------------------------------------------------------
    // 4. Audit History & Server-Side Pagination (GET /api/audits)
    // ---------------------------------------------------------------------------
    console.log("\n[4/7] Testing Audit History Listing & Filtering (GET /api/audits)...");

    // 4a. Alice's paginated audit list
    const reqHistory = new NextRequest("http://localhost:3000/api/audits?page=1&pageSize=10", {
      headers: { "x-user-id": clientAlice.id },
    });
    const resHistory = await handleGetAudits(reqHistory);
    assert.strictEqual(resHistory.status, 200);
    const jsonHistory = await resHistory.json();
    assert.strictEqual(jsonHistory.success, true);
    assert.strictEqual(jsonHistory.data.length, 3);
    assert.strictEqual(jsonHistory.pagination.totalCount, 3);
    console.log(`  ✓ Listed ${jsonHistory.data.length} audits for Alice`);

    // 4b. Status filtering: COMPLETED
    const reqFilterCompleted = new NextRequest("http://localhost:3000/api/audits?status=COMPLETED", {
      headers: { "x-user-id": clientAlice.id },
    });
    const resFilterCompleted = await handleGetAudits(reqFilterCompleted);
    const jsonFilterCompleted = await resFilterCompleted.json();
    assert.strictEqual(jsonFilterCompleted.data.length, 1);
    assert.strictEqual(jsonFilterCompleted.data[0].id, aliceCompletedAudit.id);
    console.log("  ✓ Filter by status=COMPLETED returned only completed audit");

    // 4c. Search by target URL
    const reqSearchUrl = new NextRequest("http://localhost:3000/api/audits?search=unreachable", {
      headers: { "x-user-id": clientAlice.id },
    });
    const resSearchUrl = await handleGetAudits(reqSearchUrl);
    const jsonSearchUrl = await resSearchUrl.json();
    assert.strictEqual(jsonSearchUrl.data.length, 1);
    assert.strictEqual(jsonSearchUrl.data[0].id, aliceFailedAudit.id);
    console.log("  ✓ Search by target URL keyword returned expected record");

    // ---------------------------------------------------------------------------
    // 5. Detailed Audit Results Inspection & AI Schema Conformance
    // ---------------------------------------------------------------------------
    console.log("\n[5/7] Testing Detailed Audit Results & Category Breakdown...");

    const reqDetail = new NextRequest(`http://localhost:3000/api/audits/${aliceCompletedAudit.id}`, {
      headers: { "x-user-id": clientAlice.id },
    });
    const resDetail = await handleGetAuditById(reqDetail, { params: { id: aliceCompletedAudit.id } });
    assert.strictEqual(resDetail.status, 200);
    const jsonDetail = await resDetail.json();
    const auditData = jsonDetail.data;

    // Verify Overall Score
    assert.strictEqual(auditData.score, 86);

    // Verify 5 Weighted Categories
    const breakdown = auditData.aiAnalysisData.score_breakdown;
    assert.strictEqual(breakdown.technical, 88);
    assert.strictEqual(breakdown.on_page, 85);
    assert.strictEqual(breakdown.content, 85);
    assert.strictEqual(breakdown.core_web_vitals, 90);
    assert.strictEqual(breakdown.schema, 80);

    // Verify Issues, Quick Wins, and Recommendations
    assert.strictEqual(auditData.aiAnalysisData.important_issues.length, 1);
    assert.strictEqual(auditData.aiAnalysisData.important_issues[0].title, "Missing H1 on contact page");
    assert.strictEqual(auditData.aiAnalysisData.quick_wins.length, 1);
    assert.strictEqual(auditData.aiAnalysisData.quick_wins[0].finding, "Add OpenGraph image tags");
    assert.strictEqual(auditData.aiAnalysisData.recommendations.length, 1);
    assert.strictEqual(auditData.aiAnalysisData.recommendations[0].category, "Schema");

    // Verify executive summary
    assert.ok(auditData.aiAnalysisData.executive_summary.includes("Strong on-page"));

    console.log("  ✓ Verified Overall Score (86/100)");
    console.log("  ✓ Verified Category Breakdown: Tech (88), OnPage (85), Content (85), CWV (90), Schema (80)");
    console.log("  ✓ Verified Issues, Quick Wins, and Strategic Recommendations");

    // ---------------------------------------------------------------------------
    // 6. Failed Audit Visibility & Sanitized Error Details
    // ---------------------------------------------------------------------------
    console.log("\n[6/7] Testing Failed Audit State & Error Sanitization...");

    const reqFailedDetail = new NextRequest(`http://localhost:3000/api/audits/${aliceFailedAudit.id}`, {
      headers: { "x-user-id": clientAlice.id },
    });
    const resFailedDetail = await handleGetAuditById(reqFailedDetail, { params: { id: aliceFailedAudit.id } });
    assert.strictEqual(resFailedDetail.status, 200);
    const jsonFailedDetail = await resFailedDetail.json();
    assert.strictEqual(jsonFailedDetail.data.status, "FAILED");
    assert.ok(jsonFailedDetail.data.errorMessage.includes("DNS lookup failed"));
    // Ensure no secrets or stack traces leaked
    assert.ok(!jsonFailedDetail.data.errorMessage.includes("password"));
    assert.ok(!jsonFailedDetail.data.errorMessage.includes("sk-ant-"));
    console.log("  ✓ Failed audit returned sanitized error message without leaking internal secrets");

    // ---------------------------------------------------------------------------
    // 7. Page Refresh Recovery (Idempotent Status Inquiries)
    // ---------------------------------------------------------------------------
    console.log("\n[7/7] Testing Page Refresh Recovery & Polling Idempotency...");

    // Repeated GET requests must never mutate audit state
    const resRecover1 = await handleGetAuditById(reqDetail, { params: { id: aliceCompletedAudit.id } });
    const resRecover2 = await handleGetAuditById(reqDetail, { params: { id: aliceCompletedAudit.id } });
    assert.strictEqual(resRecover1.status, 200);
    assert.strictEqual(resRecover2.status, 200);
    const jsonRecover1 = await resRecover1.json();
    const jsonRecover2 = await resRecover2.json();
    assert.deepStrictEqual(jsonRecover1.data, jsonRecover2.data, "Repeated reads must return identical record");
    console.log("  ✓ Page refresh recovery verified: state retrieved without duplicate record creation");

    console.log("\n==================================================================");
    console.log("PHASE 9 CLIENT DASHBOARD VERIFICATION COMPLETED SUCCESSFULLY!");
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

runPhase9ClientTests().catch((err) => {
  console.error("\n❌ PHASE 9 CLIENT TESTS FAILED:", err);
  process.exit(1);
});
