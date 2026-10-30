import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getRedisConnection, getQueueMetrics } from "@/queue";

export const dynamic = "force-dynamic";

export async function GET() {
  const startTime = Date.now();
  let dbStatus = "disconnected";
  let redisStatus = "disconnected";
  let queueMetrics = null;

  // 1. Check PostgreSQL Database connection
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = "connected";
  } catch (err) {
    dbStatus = `error: ${err instanceof Error ? err.message : String(err)}`;
  }

  // 2. Check Redis connection
  try {
    const redis = getRedisConnection();
    const ping = await redis.ping();
    if (ping === "PONG") {
      redisStatus = "connected";
    }
  } catch (err) {
    redisStatus = `error: ${err instanceof Error ? err.message : String(err)}`;
  }

  // 3. Check Queue Metrics
  try {
    queueMetrics = await getQueueMetrics();
  } catch {
    queueMetrics = { status: "unavailable" };
  }

  const isHealthy = dbStatus === "connected" && redisStatus === "connected";
  const durationMs = Date.now() - startTime;

  return NextResponse.json(
    {
      status: isHealthy ? "healthy" : "degraded",
      ok: isHealthy,
      timestamp: new Date().toISOString(),
      durationMs,
      services: {
        database: dbStatus,
        redis: redisStatus,
        queue: queueMetrics,
      },
      checks: {
        database: { status: dbStatus },
        redis: { status: redisStatus },
        queue: queueMetrics,
      },
      environment: {
        nodeEnv: process.env.NODE_ENV || "development",
        appUrl: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
      },
    },
    { status: isHealthy ? 200 : 503 }
  );
}
