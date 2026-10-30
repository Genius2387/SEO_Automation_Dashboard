import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequest, enforceCsrfProtection } from "@/lib/auth";
import { ScheduleService } from "@/services/scheduleService";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const createScheduleSchema = z.object({
  targetUrl: z.string().url("A valid target website URL is required"),
  frequency: z.enum(["WEEKLY", "MONTHLY"]).default("WEEKLY"),
  businessType: z.string().max(100).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(100).optional().nullable(),
});

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateRequest(req);
    if (!auth.user && !auth.isAdmin) {
      return NextResponse.json(
        { success: false, error: "Authentication required to view schedules" },
        { status: 401 }
      );
    }

    const schedules = await ScheduleService.listSchedules(auth);

    return NextResponse.json({
      success: true,
      data: schedules,
    });
  } catch (err) {
    console.error("[Schedules API] Error listing schedules:", err);
    return NextResponse.json(
      { success: false, error: "Internal error listing schedules" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const auth = await authenticateRequest(req);

    if (!auth.user && !auth.isAdmin) {
      return NextResponse.json(
        { success: false, error: "Authentication required to create a schedule" },
        { status: 401 }
      );
    }

    // Rate limiting: 20 schedule creations per minute per user/IP
    const rateLimit = await checkRateLimit(`schedule_create:${auth.user?.id || ip}`, 20, 60);
    if (!rateLimit.success) {
      return NextResponse.json(
        { success: false, error: "Too many schedule requests. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rateLimit.resetSeconds) } }
      );
    }

    // Enforce CSRF protection for cookie-authenticated requests
    if (!enforceCsrfProtection(req, auth)) {
      return NextResponse.json(
        { success: false, error: "Invalid or missing CSRF token" },
        { status: 403 }
      );
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Malformed JSON payload" },
        { status: 400 }
      );
    }

    const parseResult = createScheduleSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: parseResult.error.issues[0]?.message || "Invalid schedule data",
        },
        { status: 400 }
      );
    }

    const schedule = await ScheduleService.createSchedule({
      userId: auth.user!.id,
      targetUrl: parseResult.data.targetUrl,
      frequency: parseResult.data.frequency,
      businessType: parseResult.data.businessType,
      city: parseResult.data.city,
      state: parseResult.data.state,
    });

    return NextResponse.json(
      {
        success: true,
        data: schedule,
        schedule,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[Schedules API] Error creating schedule:", err);
    const msg = err instanceof Error ? err.message : "Internal error creating schedule";
    return NextResponse.json(
      { success: false, error: msg },
      { status: 400 }
    );
  }
}
