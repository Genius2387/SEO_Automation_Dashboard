import { NextRequest, NextResponse } from "next/server";
import { AuditService } from "@/services/auditService";
import { authenticateRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateRequest(req);
    const userId = auth.user ? auth.user.id : null;

    const metrics = await AuditService.getClientOverviewMetrics(userId);

    return NextResponse.json({
      success: true,
      data: metrics,
      meta: {
        authType: auth.authType,
        userId,
        email: auth.user?.email || null,
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Database error";
    console.error("Client overview metrics error:", errorMsg);

    return NextResponse.json(
      {
        success: false,
        error: "ServiceUnavailable",
        message: "Could not retrieve client overview metrics from database.",
      },
      { status: 503 }
    );
  }
}
