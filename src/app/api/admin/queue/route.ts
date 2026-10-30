import { NextRequest, NextResponse } from "next/server";
import { getQueueMetrics } from "@/queue";
import { authenticateRequest } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const auth = await authenticateRequest(req);

  if (!auth.isAdmin) {
    return NextResponse.json(
      {
        success: false,
        error: "Unauthorized",
        message: "Valid admin credentials required to access queue diagnostics.",
      },
      { status: 401 }
    );
  }

  try {
    const metrics = await getQueueMetrics();
    return NextResponse.json({
      success: true,
      data: metrics,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Queue connection failed";
    console.error("Queue metrics error:", msg.replace(/:[^:@]+@/, ":***@"));

    return NextResponse.json(
      {
        success: false,
        error: "Queue inspection failed",
        message: "Could not retrieve BullMQ metrics from Redis service.",
      },
      { status: 503 }
    );
  }
}
