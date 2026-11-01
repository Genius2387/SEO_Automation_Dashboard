import "dotenv/config";
import { Queue, QueueOptions } from "bullmq";
import Redis, { RedisOptions } from "ioredis";
import { z } from "zod";
import { AuditJobData } from "@/types";

export const AUDIT_QUEUE_NAME = "seo-audit-queue";
export const AUDIT_JOB_NAME = "process-audit";

export const auditJobDataSchema = z.object({
  auditId: z.string().min(1, "auditId is required"),
  targetUrl: z.string().url("A valid target URL is required"),
  businessType: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  userId: z.string().nullable().optional(),
  useMocks: z.boolean().optional(),
});

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const activeConnections: Set<Redis> = new Set();
let sharedQueueConnection: Redis | null = null;
let auditQueueInstance: Queue<AuditJobData> | null = null;

/**
 * Creates a new dedicated Redis connection for BullMQ with required options.
 * BullMQ Workers require dedicated connections and maxRetriesPerRequest: null.
 */
export function createRedisConnection(customOptions: Partial<RedisOptions> = {}): Redis {
  const options: RedisOptions = {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy(times) {
      // Bounded retry backoff up to 30s
      return Math.min(times * 1000, 30000);
    },
    ...customOptions,
  };

  const client = new Redis(REDIS_URL, options);
  activeConnections.add(client);

  client.on("error", (err) => {
    // Suppress unhandled crash while logging sanitized message without credentials
    const sanitized = err.message ? err.message.replace(/:[^:@]+@/, ":***@") : "Redis connection error";
    console.error(`[Redis Error]: ${sanitized}`);
  });

  return client;
}

/**
 * Shared connection for Queue producers (enqueuing, querying status)
 */
export function getRedisConnection(): Redis {
  if (!sharedQueueConnection || sharedQueueConnection.status === "end") {
    sharedQueueConnection = createRedisConnection({ lazyConnect: true });
  }
  return sharedQueueConnection;
}

/**
 * Returns the singleton Audit Queue
 */
export function getAuditQueue(options?: Partial<QueueOptions>): Queue<AuditJobData> {
  if (!auditQueueInstance) {
    auditQueueInstance = new Queue<AuditJobData>(AUDIT_QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 3000,
        },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 1000 },
      },
      ...options,
    });
  }
  return auditQueueInstance;
}

/**
 * Enqueues an audit job with deterministic job ID deduplication.
 * Prevents duplicate active jobs for the same auditId.
 */
export async function addAuditJob(data: AuditJobData): Promise<{ jobId: string; deduplicated: boolean }> {
  // Validate payload against schema before enqueueing
  const parsed = auditJobDataSchema.parse(data);

  const queue = getAuditQueue();
  const deterministicJobId = `audit-${parsed.auditId}`;

  // Check if job already exists to avoid redundant duplicate enqueue
  const existingJob = await queue.getJob(deterministicJobId);
  if (existingJob) {
    const state = await existingJob.getState();
    // If waiting or active, return existing job ID without duplicating
    if (state === "waiting" || state === "active" || state === "delayed") {
      return { jobId: existingJob.id || deterministicJobId, deduplicated: true };
    }
  }

  const job = await queue.add(AUDIT_JOB_NAME, parsed, {
    jobId: deterministicJobId,
  });

  return { jobId: job.id || deterministicJobId, deduplicated: false };
}

/**
 * Retrieve queue health and count statistics for monitoring
 */
export async function getQueueMetrics() {
  const queue = getAuditQueue();
  const counts = await queue.getJobCounts(
    "waiting",
    "active",
    "completed",
    "failed",
    "delayed"
  );

  return {
    queueName: AUDIT_QUEUE_NAME,
    status: "active",
    counts,
  };
}

/**
 * Gracefully closes the audit queue instance
 */
export async function closeAuditQueue(): Promise<void> {
  if (auditQueueInstance) {
    await auditQueueInstance.close();
    auditQueueInstance = null;
  }
}

/**
 * Gracefully disconnects all tracked Redis connections
 */
export async function closeRedisConnections(): Promise<void> {
  await closeAuditQueue();

  const closePromises = Array.from(activeConnections).map(async (client) => {
    try {
      if (client.status !== "end") {
        await client.quit();
      }
    } catch {
      client.disconnect();
    }
  });

  await Promise.all(closePromises);
  activeConnections.clear();
  sharedQueueConnection = null;
}
