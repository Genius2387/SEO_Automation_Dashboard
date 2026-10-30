import { NextRequest, NextResponse } from "next/server";
import { AuditService } from "@/services/auditService";
import { getQueueMetrics } from "@/queue";
import { authenticateRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await authenticateRequest(req);

  if (!auth.isAdmin) {
    return NextResponse.json(
      {
        success: false,
        error: "Unauthorized",
        message: "Valid administrative credentials are required to view system overview metrics.",
      },
      { status: 401 }
    );
  }

  try {
    const [overview, queueMetrics] = await Promise.all([
      AuditService.getAdminOverviewMetrics(),
      getQueueMetrics().catch((err) => {
        console.warn("Queue metrics unavailable for overview:", err instanceof Error ? err.message : String(err));
        return null;
      }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        ...overview,
        queue: queueMetrics,
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Internal database error";
    console.error("Admin overview error:", errorMsg);

    return NextResponse.json(
      {
        success: false,
        error: "ServiceUnavailable",
        message: "Could not retrieve administrative overview metrics from database.",
      },
      { status: 503 }
    );
  }
}
