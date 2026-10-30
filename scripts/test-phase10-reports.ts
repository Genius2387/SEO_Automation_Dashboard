/* eslint-disable @typescript-eslint/no-require-imports */
import dotenv from "dotenv";
dotenv.config();

import assert from "assert";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import {
  AuditReportService,
  AuditNotFoundError,
  AuditNotCompletedError,
  InvalidAuditAnalysisError,
  ReportStorageService,
} from "../src/reports";
import { buildAuditReportHtml, escapeHtml } from "../src/reports/templates/auditReportTemplate";
import { sendEmailNotification, isValidEmail } from "../src/notifications/email";
import { sendWhatsAppNotification, isValidPhoneNumber, redactPhoneNumber } from "../src/notifications/whatsapp";
import { dispatchAuditNotifications, getAuditNotificationHistory } from "../src/notifications";
import { ProviderNotConfiguredError } from "../src/services/providers";
import { GET as handleGetReport, POST as handlePostReport } from "../src/app/api/audits/[id]/report/route";
import { GET as handleGetNotifications, POST as handlePostNotifications } from "../src/app/api/audits/[id]/notifications/route";
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

async function runPhase10Tests() {
  console.log("==================================================================");
  console.log("EDGELINK SEO DASHBOARD - PHASE 10 PDF REPORTS & NOTIFICATIONS");
  console.log("==================================================================");

  const cleanupAuditIds: string[] = [];
  const cleanupUserIds: string[] = [];

  try {
    // ---------------------------------------------------------------------------
    // 0. Setup Isolated Test Clients & Fixtures
    // ---------------------------------------------------------------------------
    console.log("\n[0/8] Setting up isolated test fixtures in PostgreSQL...");
    await ensureDatabaseReady();

    const testClientA = await prisma.user.create({
      data: {
        email: `phase10_client_a_${Date.now()}@edgelink-test.local`,
        name: "Phase10 Client A",
        role: "CLIENT",
      },
    });
    cleanupUserIds.push(testClientA.id);

    const testClientB = await prisma.user.create({
      data: {
        email: `phase10_client_b_${Date.now()}@edgelink-test.local`,
        name: "Phase10 Client B",
        role: "CLIENT",
      },
    });
    cleanupUserIds.push(testClientB.id);

    const validAiData = {
      audit_version: "1.0.0",
      overall_score: 82,
      score_breakdown: {
        technical: 85,
        on_page: 80,
        content: 80,
        core_web_vitals: 85,
        schema: 80,
      },
      critical_issues: [
        {
          code: "MISSING_TITLE",
          title: "Missing HTML Title Tag",
          severity: "CRITICAL" as const,
          category: "OnPage",
          description: "No title element discovered in crawled HTML document.",
          evidence: "0 title tags found",
          recommendation: "Add a descriptive <title> tag between 50-60 characters.",
        },
      ],
      important_issues: [
        {
          code: "SLOW_LCP",
          title: "Slow Largest Contentful Paint",
          severity: "HIGH" as const,
          category: "CoreWebVitals",
          description: "LCP measured above recommended 2.5s threshold.",
          evidence: "LCP: 3.4s",
          recommendation: "Preload banner image assets and eliminate render-blocking CSS.",
        },
      ],
      quick_wins: [
        {
          priority: "HIGH" as const,
          category: "OnPage" as const,
          finding: "Missing canonical tag",
          fix: "Add <link rel='canonical' href='https://example.com/'>",
          estimated_impact: "HIGH" as const,
          effort: "LOW" as const,
          falsifiability_check: "Inspect DOM for canonical element link",
        },
      ],
      recommendations: [
        {
          priority: "CRITICAL" as const,
          category: "Technical" as const,
          finding: "Missing robots.txt directives",
          fix: "Deploy a valid robots.txt file allowing search crawlers.",
          estimated_impact: "HIGH" as const,
          effort: "LOW" as const,
          falsifiability_check: "Verify HTTP 200 for /robots.txt",
        },
      ],
      executive_summary: "The target website exhibits solid on-page architecture with key optimization opportunities in Core Web Vitals and Schema markup.",
    };

    const completedAuditA = await prisma.audit.create({
      data: {
        targetUrl: "https://completed-site-a.example.com",
        businessType: "Dental Clinic",
        city: "Pune",
        state: "MH",
        status: "COMPLETED",
        score: 82,
        aiAnalysisData: validAiData,
        userId: testClientA.id,
        completedAt: new Date(),
      },
    });
    cleanupAuditIds.push(completedAuditA.id);

    const pendingAudit = await prisma.audit.create({
      data: {
        targetUrl: "https://pending-site.example.com",
        status: "CRAWLING",
        userId: testClientA.id,
      },
    });
    cleanupAuditIds.push(pendingAudit.id);

    console.log(`  ✔ Test clients and audits created: Client A (${testClientA.id}), Audit A (${completedAuditA.id})`);

    // ---------------------------------------------------------------------------
    // 1. PDF Generation & Lifecycle Verification
    // ---------------------------------------------------------------------------
    console.log("\n[1/8] Testing Server-Side PDF Generation & Lifecycle...");

    // 1a. Generate PDF for completed audit
    const reportResult = await AuditReportService.generateAuditPdf(completedAuditA.id, { force: true });
    assert(reportResult.success === true, "Report generation should succeed");
    assert(reportResult.sizeBytes > 5000, `PDF size should be > 5KB, got ${reportResult.sizeBytes}`);
    assert.strictEqual(reportResult.auditId, completedAuditA.id);
    assert.strictEqual(reportResult.pdfUrl, `/api/audits/${completedAuditA.id}/report`);

    // Verify raw PDF buffer header magic bytes
    const pdfBuffer = await AuditReportService.getAuditPdf(completedAuditA.id);
    assert(pdfBuffer !== null, "PDF buffer must exist in storage");
    assert.strictEqual(pdfBuffer.toString("ascii", 0, 5), "%PDF-", "PDF must start with %PDF- header");
    console.log(`  ✔ Valid A4 PDF generated (${(reportResult.sizeBytes / 1024).toFixed(1)} KB) with %PDF- file signature`);

    // 1b. Verify PostgreSQL reference persisted
    const updatedAuditRecord = await prisma.audit.findUnique({ where: { id: completedAuditA.id } });
    assert.strictEqual(updatedAuditRecord?.pdfReportUrl, `/api/audits/${completedAuditA.id}/report`);
    console.log("  ✔ PDF report reference persisted in PostgreSQL Audit.pdfReportUrl");

    // 1c. Idempotency: repeated generation returns cached report without re-render
    const cachedResult = await AuditReportService.generateAuditPdf(completedAuditA.id, { force: false });
    assert.strictEqual(cachedResult.cached, true, "Second call should return cached report");
    console.log("  ✔ Idempotent generation verified: existing report returned from cache");

    // ---------------------------------------------------------------------------
    // 2. Error Handling & Incomplete Audit Rejection
    // ---------------------------------------------------------------------------
    console.log("\n[2/8] Testing Error Boundaries & Status Constraints...");

    // 2a. Missing audit ID rejection
    let missingCaught = false;
    try {
      await AuditReportService.generateAuditPdf("non-existent-audit-id-12345");
    } catch (err) {
      missingCaught = err instanceof AuditNotFoundError;
    }
    assert(missingCaught, "Missing audit must throw AuditNotFoundError");
    console.log("  ✔ Missing audit correctly rejected with AuditNotFoundError");

    // 2b. Incomplete audit (CRAWLING) rejection
    let incompleteCaught = false;
    try {
      await AuditReportService.generateAuditPdf(pendingAudit.id);
    } catch (err) {
      incompleteCaught = err instanceof AuditNotCompletedError;
    }
    assert(incompleteCaught, "Incomplete audit must throw AuditNotCompletedError");
    console.log("  ✔ Incomplete audit (CRAWLING) rejected with AuditNotCompletedError");

    // 2c. Audit with missing AI analysis data
    const brokenAudit = await prisma.audit.create({
      data: {
        targetUrl: "https://broken-audit.example.com",
        status: "COMPLETED",
        score: null,
        aiAnalysisData: Prisma.DbNull,
        userId: testClientA.id,
      },
    });
    cleanupAuditIds.push(brokenAudit.id);

    let invalidAnalysisCaught = false;
    try {
      await AuditReportService.generateAuditPdf(brokenAudit.id);
    } catch (err) {
      invalidAnalysisCaught = err instanceof InvalidAuditAnalysisError;
    }
    assert(invalidAnalysisCaught, "Audit with null aiAnalysisData must throw InvalidAuditAnalysisError");
    console.log("  ✔ Corrupt/missing AI analysis safely rejected with InvalidAuditAnalysisError");

    // ---------------------------------------------------------------------------
    // 3. Security, HTML Escaping & Injection Protection
    // ---------------------------------------------------------------------------
    console.log("\n[3/8] Testing Security, HTML Sanitization & Injection Defense...");

    const maliciousInput = "<script>alert('xss');</script>&\"'<b>Test</b>";
    const escaped = escapeHtml(maliciousInput);
    assert(!escaped.includes("<script>"), "Must encode <script>");
    assert(!escaped.includes("</script>"), "Must encode </script>");
    assert(escaped.includes("&lt;script&gt;"), "Must convert < to &lt;");
    assert(escaped.includes("&amp;"), "Must convert & to &amp;");
    assert(escaped.includes("&quot;"), "Must convert \" to &quot;");
    assert(escaped.includes("&#39;"), "Must convert ' to &#39;");

    // Test template rendering with injection payloads
    const templateHtml = buildAuditReportHtml({
      auditId: "test-sec-id",
      targetUrl: "https://evil.com/<script>alert(1)</script>",
      score: 75,
      createdAt: new Date(),
      aiAnalysis: {
        ...validAiData,
        executive_summary: "Payload test: <img src=x onerror=alert(1)>",
      },
    });

    assert(!templateHtml.includes("<script>alert(1)</script>"), "Script tag in targetUrl must be neutralized");
    assert(!templateHtml.includes("<img src=x onerror=alert(1)>"), "Image injection in summary must be neutralized");
    assert(templateHtml.includes("Content-Security-Policy"), "Report must include strict Content-Security-Policy");
    console.log("  ✔ Strict HTML entity escaping and CSP protection verified");

    // ---------------------------------------------------------------------------
    // 4. Secure Download API & Cross-Client Access Control (GET /api/audits/[id]/report)
    // ---------------------------------------------------------------------------
    console.log("\n[4/8] Testing Secure Download API & Access Control...");

    // 4a. Client A downloads their own report (200 OK)
    const reqOwner = new NextRequest(`http://localhost:3000/api/audits/${completedAuditA.id}/report`, {
      method: "GET",
      headers: { "x-user-id": testClientA.id },
    });
    const resOwner = await handleGetReport(reqOwner, { params: { id: completedAuditA.id } });
    assert.strictEqual(resOwner.status, 200, "Owner must be permitted to download report");
    assert.strictEqual(resOwner.headers.get("content-type"), "application/pdf");
    assert(resOwner.headers.get("content-disposition")?.includes("attachment; filename="));
    assert.strictEqual(resOwner.headers.get("cache-control"), "private, no-cache, no-store, must-revalidate");
    console.log("  ✔ Owner client successfully downloads PDF with strict privacy cache headers (HTTP 200)");

    // 4b. Client B attempts cross-client download (403 Forbidden)
    const reqCrossClient = new NextRequest(`http://localhost:3000/api/audits/${completedAuditA.id}/report`, {
      method: "GET",
      headers: { "x-user-id": testClientB.id },
    });
    const resCrossClient = await handleGetReport(reqCrossClient, { params: { id: completedAuditA.id } });
    assert.strictEqual(resCrossClient.status, 403, "Cross-client download must be strictly denied with HTTP 403");
    console.log("  ✔ Cross-client download attempt strictly blocked (HTTP 403 Forbidden)");

    // 4c. Admin downloads Client A's report (200 OK)
    const reqAdmin = new NextRequest(`http://localhost:3000/api/audits/${completedAuditA.id}/report`, {
      method: "GET",
      headers: { "x-admin-key": process.env.ADMIN_SECRET_KEY || "dev-admin-secret" },
    });
    const resAdmin = await handleGetReport(reqAdmin, { params: { id: completedAuditA.id } });
    assert.strictEqual(resAdmin.status, 200, "Admin must be permitted to download any report");
    console.log("  ✔ Administrative cross-client download authorized via admin key (HTTP 200)");

    // 4d. Trigger generation via POST endpoint
    const reqPostGenerate = new NextRequest(`http://localhost:3000/api/audits/${completedAuditA.id}/report`, {
      method: "POST",
      headers: { "x-user-id": testClientA.id },
    });
    const resPostGenerate = await handlePostReport(reqPostGenerate, { params: { id: completedAuditA.id } });
    const jsonPostGenerate = await resPostGenerate.json();
    assert.strictEqual(resPostGenerate.status, 200);
    assert.strictEqual(jsonPostGenerate.success, true);
    assert.strictEqual(jsonPostGenerate.data.pdfReportUrl, `/api/audits/${completedAuditA.id}/report`);
    console.log("  ✔ POST /api/audits/[id]/report endpoint successfully triggered report generation");

    // ---------------------------------------------------------------------------
    // 5. Email Notification Integration
    // ---------------------------------------------------------------------------
    console.log("\n[5/8] Testing Email Notification Service & Validation...");

    // 5a. Validation: Invalid email address
    assert.strictEqual(isValidEmail("not-an-email"), false);
    assert.strictEqual(isValidEmail("user@domain"), false);
    assert.strictEqual(isValidEmail("user@domain.com"), true);

    let invalidEmailCaught = false;
    try {
      await sendEmailNotification({
        auditId: completedAuditA.id,
        recipientEmail: "invalid-email-string",
        targetUrl: completedAuditA.targetUrl,
        score: 82,
        summary: "Summary text",
        reportUrl: `/api/audits/${completedAuditA.id}/report`,
      });
    } catch {
      invalidEmailCaught = true;
    }
    assert(invalidEmailCaught, "Invalid recipient email must throw error");
    console.log("  ✔ Invalid recipient email address strictly rejected");

    // 5b. Mock email delivery execution
    const emailResult = await sendEmailNotification(
      {
        auditId: completedAuditA.id,
        recipientEmail: testClientA.email,
        targetUrl: completedAuditA.targetUrl,
        score: 82,
        summary: "Detailed SEO health report completed with 82/100 score.",
        reportUrl: `/api/audits/${completedAuditA.id}/report`,
        dashboardUrl: "http://localhost:3000/client",
      },
      { useMocks: true }
    );

    assert.strictEqual(emailResult.status, "SENT");
    assert.strictEqual(emailResult.channel, "EMAIL");
    assert(emailResult.providerId?.startsWith("MOCK_EMAIL_"));
    assert.strictEqual(emailResult.simulated, true);
    console.log("  ✔ Mock email delivery executed successfully with simulated provider ID");

    // 5c. Live mode guard: Missing provider credentials throws explicit ProviderNotConfiguredError
    let liveEmailNotConfigured = false;
    try {
      await sendEmailNotification(
        {
          auditId: completedAuditA.id,
          recipientEmail: testClientA.email,
          targetUrl: completedAuditA.targetUrl,
          score: 82,
          summary: "Summary",
          reportUrl: `/api/audits/${completedAuditA.id}/report`,
        },
        { useMocks: false }
      );
    } catch (err) {
      liveEmailNotConfigured = err instanceof ProviderNotConfiguredError;
    }
    assert(liveEmailNotConfigured, "Live email mode without configured provider must throw ProviderNotConfiguredError");
    console.log("  ✔ Live email mode guards against silent mock leaking (throws ProviderNotConfiguredError)");

    // ---------------------------------------------------------------------------
    // 6. WhatsApp Notification Integration (Preserving Phase 3 Twilio Fixture)
    // ---------------------------------------------------------------------------
    console.log("\n[6/8] Testing WhatsApp Notification Service & Twilio Fixture...");

    // 6a. Validation: Phone number validation & redaction
    assert.strictEqual(isValidPhoneNumber("+14155552671"), true);
    assert.strictEqual(isValidPhoneNumber("whatsapp:+919876543210"), true);
    assert.strictEqual(isValidPhoneNumber("1234"), false);
    assert.strictEqual(isValidPhoneNumber("invalid-phone"), false);

    const redacted = redactPhoneNumber("+14155552671");
    assert(!redacted.includes("5552"), "Phone number must be redacted");
    assert(redacted.includes("***"), "Must contain redaction asterisks");
    console.log("  ✔ E.164 phone number validation and credential/destination redaction verified");

    // 6b. WhatsApp mock dispatch (reusing exact Phase 3 Twilio mock fixture)
    const whatsappResult = await sendWhatsAppNotification(
      {
        auditId: completedAuditA.id,
        recipientPhone: "+14155552671",
        targetUrl: completedAuditA.targetUrl,
        score: 82,
        reportUrl: `/api/audits/${completedAuditA.id}/report`,
      },
      { useMocks: true }
    );

    assert.strictEqual(whatsappResult.status, "SENT");
    assert.strictEqual(whatsappResult.channel, "WHATSAPP");
    assert(whatsappResult.providerId?.startsWith("MOCK_SID_"), "Must return exact Phase 3 MOCK_SID_ format");
    assert.strictEqual(whatsappResult.simulated, true);
    console.log("  ✔ WhatsApp dispatch called exact Phase 3 Twilio fixture and returned MOCK_SID_");

    // 6c. Live mode guard for WhatsApp
    let liveWhatsAppNotConfigured = false;
    try {
      await sendWhatsAppNotification(
        {
          auditId: completedAuditA.id,
          recipientPhone: "+14155552671",
          targetUrl: completedAuditA.targetUrl,
          score: 82,
          reportUrl: `/api/audits/${completedAuditA.id}/report`,
        },
        { useMocks: false }
      );
    } catch (err) {
      liveWhatsAppNotConfigured = err instanceof ProviderNotConfiguredError;
    }
    assert(liveWhatsAppNotConfigured, "Live WhatsApp mode without credentials must throw ProviderNotConfiguredError");
    console.log("  ✔ Live WhatsApp mode throws ProviderNotConfiguredError when credentials absent");

    // ---------------------------------------------------------------------------
    // 7. Notification Tracking, Idempotency & Delivery History
    // ---------------------------------------------------------------------------
    console.log("\n[7/8] Testing Notification Dispatcher, Persistence & Idempotency...");

    // 7a. Dispatch notifications via unified dispatcher
    const dispatchResults = await dispatchAuditNotifications(completedAuditA.id, {
      channels: ["EMAIL", "WHATSAPP"],
      emailRecipient: testClientA.email,
      whatsappRecipient: "+14155552671",
      useMocks: true,
      force: true,
    });

    assert.strictEqual(dispatchResults.length, 2, "Both Email and WhatsApp should be dispatched");
    assert(dispatchResults.some((r) => r.channel === "EMAIL" && r.status === "SENT"));
    assert(dispatchResults.some((r) => r.channel === "WHATSAPP" && r.status === "SENT"));
    console.log("  ✔ Unified dispatcher executed both Email and WhatsApp notifications");

    // 7b. Verify tracking records in PostgreSQL
    const deliveries = await getAuditNotificationHistory(completedAuditA.id);
    assert(deliveries.length >= 2, "PostgreSQL must contain notification delivery records");
    const emailRec = deliveries.find((d) => d.channel === "EMAIL");
    const whatsappRec = deliveries.find((d) => d.channel === "WHATSAPP");
    assert.strictEqual(emailRec?.status, "SENT");
    assert.strictEqual(whatsappRec?.status, "SENT");
    console.log("  ✔ Notification delivery outcomes tracked in PostgreSQL notification_deliveries table");

    // 7c. Idempotency on repeated dispatch
    const repeatResults = await dispatchAuditNotifications(completedAuditA.id, {
      channels: ["EMAIL", "WHATSAPP"],
      emailRecipient: testClientA.email,
      whatsappRecipient: "+14155552671",
      useMocks: true,
      force: false, // Default: idempotency enforced
    });

    assert(repeatResults.every((r) => r.status === "SKIPPED"), "Repeated notification must be SKIPPED");
    console.log("  ✔ Idempotency enforced: duplicate notifications skipped on repeat dispatch");

    // 7d. Query notification history API endpoint
    const reqNotifications = new NextRequest(`http://localhost:3000/api/audits/${completedAuditA.id}/notifications`, {
      method: "GET",
      headers: { "x-user-id": testClientA.id },
    });
    const resNotifications = await handleGetNotifications(reqNotifications, { params: { id: completedAuditA.id } });
    const jsonNotifications = await resNotifications.json();
    assert.strictEqual(resNotifications.status, 200);
    assert.strictEqual(jsonNotifications.success, true);
    assert(Array.isArray(jsonNotifications.data));
    console.log("  ✔ GET /api/audits/[id]/notifications successfully returned delivery history");

    // ---------------------------------------------------------------------------
    // 8. Fault Isolation Verification
    // ---------------------------------------------------------------------------
    console.log("\n[8/8] Testing Fault Isolation: Notification Failure Does Not Corrupt Audit...");

    // Dispatching to invalid recipient
    const failedResults = await dispatchAuditNotifications(completedAuditA.id, {
      channels: ["EMAIL"],
      emailRecipient: "invalid-email-format",
      useMocks: true,
      force: true,
    });

    assert.strictEqual(failedResults[0].status, "FAILED");
    assert(Boolean(failedResults[0].errorMessage), "Error message should be recorded");

    // Check that completedAuditA is still COMPLETED and PDF still exists
    const checkAudit = await prisma.audit.findUnique({ where: { id: completedAuditA.id } });
    assert.strictEqual(checkAudit?.status, "COMPLETED", "Audit status must remain COMPLETED after notification failure");
    assert.strictEqual(checkAudit?.pdfReportUrl, `/api/audits/${completedAuditA.id}/report`, "PDF report URL must remain intact");

    const pdfStillExists = await ReportStorageService.hasReportPdf(completedAuditA.id);
    assert.strictEqual(pdfStillExists, true, "PDF file must not be deleted when notification fails");
    console.log("  ✔ Fault isolation verified: notification failure does NOT mark audit failed or delete PDF report");

    console.log("\n==================================================================");
    console.log("🎉 ALL 8 PHASE 10 PDF REPORT & NOTIFICATION TEST SUITES PASSED!");
    console.log("==================================================================");
  } finally {
    // Teardown test fixtures
    console.log("\nCleaning up test fixtures in PostgreSQL and Storage...");
    for (const auditId of cleanupAuditIds) {
      await ReportStorageService.deleteReportPdf(auditId).catch(() => {});
      await prisma.audit.delete({ where: { id: auditId } }).catch(() => {});
    }
    for (const userId of cleanupUserIds) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    }
    await closeRedisConnections().catch(() => {});
    console.log("  ✔ Cleaned up temporary test data.");
  }
}

runPhase10Tests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ PHASE 10 TEST SUITE FAILED:", err);
    process.exit(1);
  });
