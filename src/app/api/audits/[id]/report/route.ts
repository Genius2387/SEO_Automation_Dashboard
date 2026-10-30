import { NextRequest, NextResponse } from "next/server";
import { AuditService } from "@/services/auditService";
import { authenticateRequest, canAccessAudit } from "@/lib/auth";
import {
  AuditReportService,
  AuditNotFoundError,
  AuditNotCompletedError,
  InvalidAuditAnalysisError,
} from "@/reports";

export const dynamic = "force-dynamic";

/**
 * GET /api/audits/[id]/report
 * Securely streams the generated PDF report.
 * Strictly enforces authentication and ownership: cross-client access returns HTTP 403 Forbidden.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    // 1. Validate ID format
    if (!id || typeof id !== "string" || id.trim().length === 0 || id.length > 100) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid audit ID",
          message: "A valid audit ID string is required.",
        },
        { status: 400 }
      );
    }

    const cleanId = id.trim();

    // 2. Mock mode handling for mock- ID
    if (cleanId.startsWith("mock-")) {
      let mockBuffer = await AuditReportService.getAuditPdf(cleanId);
      if (!mockBuffer) {
        await AuditReportService.generateAuditPdf(cleanId, { useMocks: true });
        mockBuffer = await AuditReportService.getAuditPdf(cleanId);
      }

      if (mockBuffer) {
        const bodyArray = new Uint8Array(mockBuffer);
        return new NextResponse(bodyArray, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="edgelink-audit-${cleanId}.pdf"`,
            "Content-Length": mockBuffer.length.toString(),
            "Cache-Control": "private, no-cache, no-store, must-revalidate",
            Pragma: "no-cache",
            Expires: "0",
          },
        });
      }
    }

    // 3. Load authoritative audit record from PostgreSQL
    const audit = await AuditService.getAuditById(cleanId);
    if (!audit) {
      return NextResponse.json(
        {
          success: false,
          error: "Audit record not found",
          message: `No audit found matching ID '${cleanId}'.`,
        },
        { status: 404 }
      );
    }

    // 4. Authorization & Ownership enforcement
    const auth = await authenticateRequest(req);
    if (!canAccessAudit(auth, audit)) {
      return NextResponse.json(
        {
          success: false,
          error: "Forbidden",
          message: "You do not have authorization to download this report.",
        },
        { status: 403 }
      );
    }

    // 5. Require audit to be COMPLETED
    if (audit.status !== "COMPLETED") {
      return NextResponse.json(
        {
          success: false,
          error: "Audit not completed",
          message: `Audit is currently in status '${audit.status}'. Reports are only available for completed audits.`,
        },
        { status: 400 }
      );
    }

    // 6. Retrieve or generate PDF report buffer
    let pdfBuffer = await AuditReportService.getAuditPdf(cleanId);
    if (!pdfBuffer) {
      // Generate on-demand if completed but file not yet on disk
      await AuditReportService.generateAuditPdf(cleanId);
      pdfBuffer = await AuditReportService.getAuditPdf(cleanId);
    }

    if (!pdfBuffer) {
      return NextResponse.json(
        {
          success: false,
          error: "Report generation failed",
          message: "PDF report could not be generated or retrieved.",
        },
        { status: 500 }
      );
    }

    // 7. Stream secure binary PDF response
    const bodyArray = new Uint8Array(pdfBuffer);
    return new NextResponse(bodyArray, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="edgelink-audit-${cleanId}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    console.error(`[API /api/audits/${params?.id}/report] Error:`, msg);
    return NextResponse.json(
      { success: false, error: "Failed to download report", message: msg },
      { status: 500 }
    );
  }
}

/**
 * POST /api/audits/[id]/report
 * Explicitly triggers or regenerates a PDF report for a COMPLETED audit.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    if (!id || typeof id !== "string" || id.trim().length === 0 || id.length > 100) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid audit ID",
          message: "A valid audit ID string is required.",
        },
        { status: 400 }
      );
    }

    const cleanId = id.trim();

    // 1. Mock mode handling
    if (cleanId.startsWith("mock-")) {
      const result = await AuditReportService.generateAuditPdf(cleanId, {
        force: true,
        useMocks: true,
      });
      return NextResponse.json({
        success: true,
        data: result,
      });
    }

    // 2. Load audit record
    const audit = await AuditService.getAuditById(cleanId);
    if (!audit) {
      return NextResponse.json(
        {
          success: false,
          error: "Audit record not found",
          message: `No audit found matching ID '${cleanId}'.`,
        },
        { status: 404 }
      );
    }

    // 3. Ownership and authorization check
    const auth = await authenticateRequest(req);
    if (!canAccessAudit(auth, audit)) {
      return NextResponse.json(
        {
          success: false,
          error: "Forbidden",
          message: "You do not have permission to generate reports for this audit.",
        },
        { status: 403 }
      );
    }

    // 4. Status check
    if (audit.status !== "COMPLETED") {
      return NextResponse.json(
        {
          success: false,
          error: "Audit not completed",
          message: `Cannot generate PDF for audit with status '${audit.status}'. Only COMPLETED audits can produce reports.`,
        },
        { status: 400 }
      );
    }

    // 5. Parse optional force query parameter or body
    let force = false;
    try {
      const url = new URL(req.url);
      force = url.searchParams.get("force") === "true";
      const body = await req.json().catch(() => null);
      if (body && typeof body === "object" && body.force === true) {
        force = true;
      }
    } catch {
      // Continue with force = false
    }

    // 6. Generate report
    const result = await AuditReportService.generateAuditPdf(cleanId, { force });

    return NextResponse.json({
      success: true,
      data: {
        auditId: result.auditId,
        pdfReportUrl: result.pdfUrl,
        cached: result.cached,
        sizeBytes: result.sizeBytes,
      },
    });
  } catch (err: unknown) {
    if (err instanceof AuditNotFoundError) {
      return NextResponse.json({ success: false, error: err.name, message: err.message }, { status: 404 });
    }
    if (err instanceof AuditNotCompletedError || err instanceof InvalidAuditAnalysisError) {
      return NextResponse.json({ success: false, error: err.name, message: err.message }, { status: 400 });
    }

    const msg = err instanceof Error ? err.message : "Internal server error";
    console.error(`[API POST /api/audits/${params?.id}/report] Error:`, msg);
    return NextResponse.json(
      { success: false, error: "Failed to generate report", message: msg },
      { status: 500 }
    );
  }
}
