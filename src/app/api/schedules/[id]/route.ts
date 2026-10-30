import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { authenticateRequest, enforceCsrfProtection } from "@/lib/auth";
import { ScheduleService } from "@/services/scheduleService";

export const dynamic = "force-dynamic";

const updateScheduleSchema = z.object({
  isActive: z.boolean().optional(),
  frequency: z.enum(["WEEKLY", "MONTHLY"]).optional(),
  targetUrl: z.string().url().optional(),
  businessType: z.string().max(100).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(100).optional().nullable(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await authenticateRequest(req);
    if (!auth.user && !auth.isAdmin) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 }
      );
    }

    const schedule = await prisma.scheduledAudit.findUnique({
      where: { id: params.id },
    });

    if (!schedule) {
      return NextResponse.json(
        { success: false, error: "Schedule not found" },
        { status: 404 }
      );
    }

    // Ensure client ownership isolation - non-admins cannot access other clients' schedules
    if (!auth.isAdmin && schedule.userId !== auth.user!.id) {
      return NextResponse.json(
        { success: false, error: "Schedule not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: schedule,
      schedule,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error fetching schedule";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await authenticateRequest(req);
    if (!auth.user && !auth.isAdmin) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 }
      );
    }

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

    const parseResult = updateScheduleSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { success: false, error: parseResult.error.issues[0]?.message || "Invalid update data" },
        { status: 400 }
      );
    }

    const updated = await ScheduleService.updateSchedule(params.id, parseResult.data, auth);

    return NextResponse.json({
      success: true,
      data: updated,
      schedule: updated,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error updating schedule";
    const status = msg.includes("Unauthorized") ? 403 : msg.includes("not found") ? 404 : 400;
    return NextResponse.json({ success: false, error: msg }, { status });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await authenticateRequest(req);
    if (!auth.user && !auth.isAdmin) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 }
      );
    }

    if (!enforceCsrfProtection(req, auth)) {
      return NextResponse.json(
        { success: false, error: "Invalid or missing CSRF token" },
        { status: 403 }
      );
    }

    await ScheduleService.deleteSchedule(params.id, auth);

    return NextResponse.json({
      success: true,
      message: "Schedule successfully cancelled and deleted",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error deleting schedule";
    const status = msg.includes("Unauthorized") ? 403 : msg.includes("not found") ? 404 : 400;
    return NextResponse.json({ success: false, error: msg }, { status });
  }
}
