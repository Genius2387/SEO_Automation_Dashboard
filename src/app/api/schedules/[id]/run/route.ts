import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, enforceCsrfProtection } from "@/lib/auth";
import { ScheduleService } from "@/services/scheduleService";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const ip = getClientIp(req);
    const auth = await authenticateRequest(req);

    if (!auth.user && !auth.isAdmin) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 }
      );
    }

    // Rate limiting: 10 manual schedule executions per minute
    const rateLimit = await checkRateLimit(`schedule_run:${auth.user?.id || ip}`, 10, 60);
    if (!rateLimit.success) {
      return NextResponse.json(
        { success: false, error: "Too many execution requests. Please wait a moment." },
        { status: 429, headers: { "Retry-After": String(rateLimit.resetSeconds) } }
      );
    }

    if (!enforceCsrfProtection(req, auth)) {
      return NextResponse.json(
        { success: false, error: "Invalid or missing CSRF token" },
        { status: 403 }
      );
    }

    const isMock = process.env.USE_MOCKS === "true";
    const result = await ScheduleService.runScheduleNow(params.id, auth, {
      useMocks: isMock,
    });

    return NextResponse.json({
      success: true,
      message: "Scheduled audit triggered immediately and enqueued",
      audit: result.audit,
      schedule: result.schedule,
      data: {
        auditId: result.audit.id,
        targetUrl: result.audit.targetUrl,
        status: result.audit.status,
        scheduleId: result.schedule.id,
        lastRunAt: result.schedule.lastRunAt,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error triggering schedule execution";
    const status = msg.includes("Unauthorized") ? 403 : msg.includes("not found") ? 404 : 400;
    return NextResponse.json({ success: false, error: msg }, { status });
  }
}
