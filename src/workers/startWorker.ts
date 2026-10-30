import { createAuditWorker } from "./auditWorker";
import { closeRedisConnections, getQueueMetrics } from "@/queue";
import { AuditService } from "@/services/auditService";
import prisma from "@/lib/prisma";

console.log("==================================================================");
console.log("EDGELINK SEO AUTOMATION DASHBOARD - BULLMQ WORKER SERVICE");
console.log("==================================================================");

// 1. Reconcile stalled audits on worker startup
AuditService.reconcileStalledAudits(15)
  .then((count) => {
    if (count > 0) {
      console.log(`[Worker Startup] Reconciled ${count} stalled audit(s) to FAILED.`);
    }
  })
  .catch((err) => {
    console.warn("[Worker Startup] Warning during stalled audit reconciliation:", err);
  });

// 2. Spawn worker
const concurrency = parseInt(process.env.WORKER_CONCURRENCY || "2", 10);
const worker = createAuditWorker({ concurrency });

console.log(`[Worker Service] Worker started and listening on queue 'seo-audit-queue'...`);
console.log(`[Worker Service] Concurrency: ${concurrency}. Redis: Upstash TLS.`);

// 3. Periodic health heartbeat every 60 seconds
const heartbeatTimer = setInterval(async () => {
  try {
    const metrics = await getQueueMetrics();
    console.log(
      `[Worker Heartbeat] Queue Status: ${metrics.status} | Waiting: ${metrics.counts.waiting} | Active: ${metrics.counts.active} | Completed: ${metrics.counts.completed} | Failed: ${metrics.counts.failed}`
    );
  } catch {
    // Suppress transient Redis disconnects in heartbeat
  }
}, 60 * 1000);

heartbeatTimer.unref();

// 4. Graceful shutdown handler
let isShuttingDown = false;
export const shutdownWorker = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[Worker Service] Received ${signal}. Shutting down gracefully...`);

  const forceTimeout = setTimeout(() => {
    console.error("[Worker Service] Forcefully exiting after shutdown timeout (10s)");
    process.exit(1);
  }, 10000);
  forceTimeout.unref();

  try {
    clearInterval(heartbeatTimer);
    await worker.close();
    await closeRedisConnections();
    await prisma.$disconnect();
    console.log("[Worker Service] Worker, Redis, and Database connections closed successfully.");
    clearTimeout(forceTimeout);
    process.exit(0);
  } catch (err) {
    console.error("[Worker Service] Error during graceful shutdown:", err);
    clearTimeout(forceTimeout);
    process.exit(1);
  }
};

process.on("SIGINT", () => shutdownWorker("SIGINT"));
process.on("SIGTERM", () => shutdownWorker("SIGTERM"));

process.on("unhandledRejection", (reason) => {
  console.error("[Worker Service] Unhandled Promise Rejection:", reason);
});
