import { NextRequest, NextResponse } from "next/server";
import { AuditService } from "@/services/auditService";
import { authenticateRequest, canAccessAudit } from "@/lib/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    // Validate ID format
    if (!id || typeof id !== "string" || id.trim().length === 0 || id.length > 100) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid audit ID",
          message: "A valid audit ID identifier string is required.",
        },
        { status: 400 }
      );
    }

    // 1. Load authoritative record from PostgreSQL
    const audit = await AuditService.getAuditById(id.trim());
    if (!audit) {
      return NextResponse.json(
        {
          success: false,
          error: "Audit record not found",
          message: `No audit found matching ID '${id}'.`,
        },
        { status: 404 }
      );
    }

    // 2. Enforce authorization and audit ownership
    const auth = await authenticateRequest(req);
    if (!canAccessAudit(auth, audit)) {
      return NextResponse.json(
        {
          success: false,
          error: "Forbidden",
          message: "You do not have permission to view this audit record.",
        },
        { status: 403 }
      );
    }

    // 3. Return structured, sanitized audit details
    return NextResponse.json({
      success: true,
      data: {
        id: audit.id,
        targetUrl: audit.targetUrl,
        status: audit.status,
        score: audit.score,
        businessType: audit.businessType,
        city: audit.city,
        state: audit.state,
        createdAt: audit.createdAt,
        updatedAt: audit.updatedAt,
        completedAt: audit.completedAt,
        errorMessage: audit.errorMessage,
        aiAnalysisData: audit.aiAnalysisData,
        rawCrawlData: audit.rawCrawlData,
        pdfReportUrl: audit.pdfReportUrl,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json(
      { success: false, error: "Failed to retrieve audit", message },
      { status: 500 }
    );
  }
}
