import { NextRequest, NextResponse } from "next/server";
import { AuditService } from "@/services/auditService";
import { authenticateRequest, canAccessAudit } from "@/lib/auth";
import { dispatchAuditNotifications, getAuditNotificationHistory } from "@/notifications";

export const dynamic = "force-dynamic";

/**
 * GET /api/audits/[id]/notifications
 * Retrieves notification history for an audit (protected by ownership/admin)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    if (!id || typeof id !== "string" || id.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: "Invalid audit ID" },
        { status: 400 }
      );
    }

    const cleanId = id.trim();

    // 1. Load audit
    const audit = await AuditService.getAuditById(cleanId);
    if (!audit && !cleanId.startsWith("mock-")) {
      return NextResponse.json(
        { success: false, error: "Audit not found" },
        { status: 404 }
      );
    }

    // 2. Authorization
    if (audit) {
      const auth = await authenticateRequest(req);
      if (!canAccessAudit(auth, audit)) {
        return NextResponse.json(
          { success: false, error: "Forbidden" },
          { status: 403 }
        );
      }
    }

    // 3. Load deliveries
    const history = await getAuditNotificationHistory(cleanId);

    return NextResponse.json({
      success: true,
      data: history,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json(
      { success: false, error: "Failed to retrieve notifications", message: msg },
      { status: 500 }
    );
  }
}

/**
 * POST /api/audits/[id]/notifications
 * Dispatches notifications on-demand for an audit
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    if (!id || typeof id !== "string" || id.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: "Invalid audit ID" },
        { status: 400 }
      );
    }

    const cleanId = id.trim();

    // 1. Load audit
    const audit = await AuditService.getAuditById(cleanId);
    if (!audit && !cleanId.startsWith("mock-")) {
      return NextResponse.json(
        { success: false, error: "Audit not found" },
        { status: 404 }
      );
    }

    // 2. Authorization
    if (audit) {
      const auth = await authenticateRequest(req);
      if (!canAccessAudit(auth, audit)) {
        return NextResponse.json(
          { success: false, error: "Forbidden" },
          { status: 403 }
        );
      }
    }

    // 3. Parse options from body
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      // Empty body
    }

    const emailRecipient = typeof body.emailRecipient === "string" ? body.emailRecipient : undefined;
    const whatsappRecipient = typeof body.whatsappRecipient === "string" ? body.whatsappRecipient : undefined;
    const channels = Array.isArray(body.channels) ? (body.channels as ("EMAIL" | "WHATSAPP")[]) : undefined;
    const force = body.force === true;

    // 4. Dispatch
    const results = await dispatchAuditNotifications(cleanId, {
      channels,
      emailRecipient,
      whatsappRecipient,
      force,
    });

    return NextResponse.json({
      success: true,
      data: results,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json(
      { success: false, error: "Failed to dispatch notifications", message: msg },
      { status: 500 }
    );
  }
}
