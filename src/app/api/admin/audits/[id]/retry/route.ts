import { NextRequest, NextResponse } from "next/server";
import { AuditService } from "@/services/auditService";
import { authenticateRequest } from "@/lib/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await authenticateRequest(req);

  if (!auth.isAdmin) {
    return NextResponse.json(
      {
        success: false,
        error: "Unauthorized",
        message: "Valid administrative credentials are required to retry an audit.",
      },
      { status: 401 }
    );
  }

  const auditId = params.id;

  if (!auditId) {
    return NextResponse.json(
      {
        success: false,
        error: "InvalidParameters",
        message: "Missing audit ID parameter.",
      },
      { status: 400 }
    );
  }

  try {
    const result = await AuditService.retryFailedAudit(auditId);

    return NextResponse.json({
      success: true,
      message: "Audit successfully re-enqueued for processing.",
      data: result,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Failed to retry audit";

    if (errorMsg.includes("not found")) {
      return NextResponse.json(
        {
          success: false,
          error: "NotFound",
          message: errorMsg,
        },
        { status: 404 }
      );
    }

    if (errorMsg.includes("Only audits in FAILED status")) {
      return NextResponse.json(
        {
          success: false,
          error: "InvalidState",
          message: errorMsg,
        },
        { status: 400 }
      );
    }

    console.error(`Audit retry error for ${auditId}:`, errorMsg);
    return NextResponse.json(
      {
        success: false,
        error: "InternalError",
        message: "Could not retry the specified audit.",
      },
      { status: 500 }
    );
  }
}
