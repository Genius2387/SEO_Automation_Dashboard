import "dotenv/config";
import http from "http";
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

// 2b. Lightweight HTTP health server (Allows running as free Web Service on Render / Railway / Koyeb)
const healthPort = parseInt(process.env.PORT || "10000", 10);
const healthServer = http.createServer(async (req, res) => {
  if (req.url === "/health" || req.url === "/") {
    try {
      const metrics = await getQueueMetrics();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "healthy",
          service: "seo-audit-worker",
          concurrency,
          queue: metrics.counts,
          timestamp: new Date().toISOString(),
        })
      );
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "healthy", service: "seo-audit-worker" }));
    }
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  }
});

healthServer.listen(healthPort, () => {
  console.log(`[Worker Service] HTTP health check listening on port ${healthPort}`);
});

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
    healthServer.close();
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
