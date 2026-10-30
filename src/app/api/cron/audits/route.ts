import { NextRequest, NextResponse } from "next/server";
import { ScheduleService } from "@/services/scheduleService";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Validates the caller's CRON_SECRET from authorization header or x-cron-secret
 */
function isAuthorizedCronRequest(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET || "dev-cron-secret-12345";
  const headerSecret = req.headers.get("x-cron-secret")?.trim();
  const authHeader = req.headers.get("authorization");
  const bearerSecret = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;

  const provided = headerSecret || bearerSecret;
  return Boolean(provided && provided === cronSecret);
}

async function handleCronTrigger(req: NextRequest) {
  const ip = getClientIp(req);

  // Rate limiting for cron endpoint: max 60 calls per minute
  const rateLimit = await checkRateLimit(`cron:${ip}`, 60, 60);
  if (!rateLimit.success) {
    return NextResponse.json(
      { success: false, error: "Too many cron requests" },
      { status: 429, headers: { "Retry-After": String(rateLimit.resetSeconds) } }
    );
  }

  // Enforce CRON_SECRET authorization
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized cron invocation. Valid CRON_SECRET is required." },
      { status: 401 }
    );
  }

  try {
    const isMock = process.env.USE_MOCKS === "true";
    const stats = await ScheduleService.processDueSchedules({
      batchSize: 50,
      useMocks: isMock,
    });

    return NextResponse.json({
      success: true,
      message: `Processed ${stats.schedulesChecked} due schedule(s). Created ${stats.auditsCreated} audit(s).`,
      stats,
      data: stats,
    });
  } catch (err) {
    console.error("[Cron Trigger] Error executing scheduled audits cron job:", err);
    return NextResponse.json(
      {
        success: false,
        error: "Internal error executing cron job",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return handleCronTrigger(req);
}

export async function GET(req: NextRequest) {
  return handleCronTrigger(req);
}
