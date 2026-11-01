import { Worker, Job, UnrecoverableError, WorkerOptions } from "bullmq";
import {
  AUDIT_QUEUE_NAME,
  auditJobDataSchema,
  createRedisConnection,
} from "@/queue";
import { crawlWebsite, CrawlExecutionError } from "@/crawlers";
import { analyzeSeoAudit, ClaudeNotConfiguredError, ClaudeAuditResult } from "@/ai";
import { AuditJobData, NormalizedAuditData } from "@/types";
import { isCrawlerMockActive, isAiMockActive } from "@/services/providers";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { AuditReportService } from "@/reports";
import { dispatchAuditNotifications } from "@/notifications";

export interface AuditWorkerResult {
  auditId: string;
  status: string;
  score?: number;
  durationMs?: number;
  reusedCrawl?: boolean;
  error?: string;
}

/**
 * Sanitizes an error message by stripping credentials, stack traces, and internal URLs
 */
function sanitizeErrorMessage(error: unknown): string {
  if (!error) return "Unknown error occurred";
  const raw = error instanceof Error ? error.message : String(error);
  // Redact passwords, tokens, connection strings, and API keys
  return raw
    .replace(/:[^:@]+@/, ":***@")
    .replace(/key=[^&]+/i, "key=***")
    .replace(/sk-ant-[a-zA-Z0-9_-]+/g, "sk-ant-***")
    .slice(0, 300);
}

/**
 * Checks whether an existing rawCrawlData payload has the structural integrity of NormalizedAuditData
 */
function isValidNormalizedCrawl(data: unknown): data is NormalizedAuditData {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return Boolean(d.target && d.crawl && d.onPage && d.technical && d.schema && Array.isArray(d.findings));
}

/**
 * Creates and returns the BullMQ Worker instance for processing SEO audit jobs.
 */
export function createAuditWorker(options?: Partial<WorkerOptions>): Worker<AuditJobData, AuditWorkerResult> {
  const connection = createRedisConnection({
    // Worker requires dedicated connection
    maxRetriesPerRequest: null,
  });

  const worker = new Worker<AuditJobData, AuditWorkerResult>(
    AUDIT_QUEUE_NAME,
    async (job: Job<AuditJobData>): Promise<AuditWorkerResult> => {
      const startTime = Date.now();
      const rawData = job.data;

      // 1. Validate job payload structure
      const parseResult = auditJobDataSchema.safeParse(rawData);
      if (!parseResult.success) {
        const errorMsg = `Invalid job payload: ${parseResult.error.issues.map((i) => i.message).join(", ")}`;
        console.error(`[Worker Job #${job.id}] ❌ Validation failed: ${errorMsg}`);
        throw new UnrecoverableError(errorMsg);
      }

      const { auditId, useMocks } = parseResult.data;
      console.log(`[Worker Job #${job.id}] ⏳ Processing audit: ${auditId}`);

      // 2. Load authoritative Audit record from PostgreSQL
      let auditRecord;
      try {
        auditRecord = await prisma.audit.findUnique({
          where: { id: auditId },
        });
      } catch (dbErr: unknown) {
        const msg = sanitizeErrorMessage(dbErr);
        console.error(`[Worker Job #${job.id}] ❌ Database read error: ${msg}`);
        // Transient database error should be retried
        throw new Error(`Database error loading audit: ${msg}`);
      }

      // Handle missing audit record safely
      if (!auditRecord) {
        console.warn(`[Worker Job #${job.id}] ⚠️ Audit record '${auditId}' not found in database. Skipping.`);
        return {
          auditId,
          status: "SKIPPED_MISSING_RECORD",
        };
      }

      // 3. Prevent duplicate work if audit is already completed
      if (auditRecord.status === "COMPLETED") {
        console.log(`[Worker Job #${job.id}] ℹ️ Audit '${auditId}' is already COMPLETED. Skipping duplicate execution.`);
        return {
          auditId,
          status: "ALREADY_COMPLETED",
          score: auditRecord.score ?? undefined,
        };
      }

      let crawlResult: NormalizedAuditData;
      let reusedCrawl = false;

      // 4. Optimization: Check if valid crawl data is already persisted from an earlier attempt
      if (isValidNormalizedCrawl(auditRecord.rawCrawlData)) {
        console.log(`[Worker Job #${job.id}] ♻️ Reusing existing persisted crawl data for '${auditId}'.`);
        crawlResult = auditRecord.rawCrawlData;
        reusedCrawl = true;
      } else {
        // Step 4a: Transition status to CRAWLING
        try {
          await prisma.audit.update({
            where: { id: auditId },
            data: {
              status: "CRAWLING",
              errorMessage: null,
            },
          });
        } catch (dbErr: unknown) {
          const msg = sanitizeErrorMessage(dbErr);
          console.error(`[Worker Job #${job.id}] ❌ Failed to transition status to CRAWLING: ${msg}`);
          throw new Error(`Database error transitioning to CRAWLING: ${msg}`);
        }

        // Step 4b: Execute Phase 4 Fetch + Cheerio Crawler
        try {
          const crawlerMock = isCrawlerMockActive(useMocks);
          console.log(`[Worker Job #${job.id}] 🕸️ Crawling target (${crawlerMock ? "MOCK" : "REAL"}): ${auditRecord.targetUrl}`);
          crawlResult = await crawlWebsite(auditRecord.targetUrl, {
            useMocks: crawlerMock,
            businessType: auditRecord.businessType || undefined,
            city: auditRecord.city || undefined,
            state: auditRecord.state || undefined,
            timeoutMs: 25000,
          });

          // Step 4c: Persist normalized crawl data into PostgreSQL
          await prisma.audit.update({
            where: { id: auditId },
            data: {
              rawCrawlData: crawlResult as unknown as Prisma.InputJsonValue,
            },
          });
        } catch (crawlErr: unknown) {
          const durationMs = Date.now() - startTime;
          const sanitized = sanitizeErrorMessage(crawlErr);
          console.error(`[Worker Job #${job.id}] ❌ Crawl failed for audit '${auditId}' after ${durationMs}ms: ${sanitized}`);

          try {
            await prisma.audit.update({
              where: { id: auditId },
              data: {
                status: "FAILED",
                errorMessage: sanitized,
              },
            });
          } catch (dbErr: unknown) {
            console.error(`[Worker Job #${job.id}] Failed to persist FAILED status:`, sanitizeErrorMessage(dbErr));
          }

          if (
            crawlErr instanceof CrawlExecutionError &&
            (crawlErr.code === "SSRF_BLOCKED" || crawlErr.code === "INVALID_URL")
          ) {
            throw new UnrecoverableError(sanitized);
          }

          throw new Error(sanitized);
        }
      }

      // 5. Transition status to ANALYZING
      try {
        await prisma.audit.update({
          where: { id: auditId },
          data: {
            status: "ANALYZING",
            errorMessage: null,
          },
        });
      } catch (dbErr: unknown) {
        const msg = sanitizeErrorMessage(dbErr);
        console.error(`[Worker Job #${job.id}] ❌ Failed to transition to ANALYZING: ${msg}`);
        throw new Error(`Database error transitioning to ANALYZING: ${msg}`);
      }

      // 6. Execute Claude AI Analysis Engine
      let aiResult: ClaudeAuditResult;
      try {
        const aiMock = isAiMockActive(useMocks);
        console.log(`[Worker Job #${job.id}] 🧠 Running ${aiMock ? "MOCK" : "REAL"} Claude AI Analysis Engine for '${auditId}'`);
        aiResult = await analyzeSeoAudit(crawlResult, {
          useMocks: aiMock,
        });
      } catch (aiErr: unknown) {
        const durationMs = Date.now() - startTime;
        const sanitized = sanitizeErrorMessage(aiErr);
        console.error(`[Worker Job #${job.id}] ❌ AI Analysis failed for audit '${auditId}' after ${durationMs}ms: ${sanitized}`);

        // Update database with latest error description without deleting rawCrawlData
        try {
          await prisma.audit.update({
            where: { id: auditId },
            data: {
              status: "FAILED",
              errorMessage: sanitized,
            },
          });
        } catch (dbErr: unknown) {
          console.error(`[Worker Job #${job.id}] Failed to persist AI error:`, sanitizeErrorMessage(dbErr));
        }

        // Permanent failure: unconfigured key in live mode should not be endlessly retried
        if (aiErr instanceof ClaudeNotConfiguredError) {
          throw new UnrecoverableError(sanitized);
        }

        // Transient errors trigger BullMQ exponential backoff
        throw new Error(sanitized);
      }

      // 7. Persist AI Analysis, final overall score, and mark COMPLETED
      const durationMs = Date.now() - startTime;
      try {
        await prisma.audit.update({
          where: { id: auditId },
          data: {
            status: "COMPLETED",
            aiAnalysisData: aiResult as unknown as Prisma.InputJsonValue,
            score: aiResult.overall_score,
            completedAt: new Date(),
            errorMessage: null,
          },
        });

        console.log(
          `[Worker Job #${job.id}] ✅ Audit '${auditId}' completed with overall score ${aiResult.overall_score}/100 in ${durationMs}ms (reusedCrawl: ${reusedCrawl}).`
        );

        // 8. Phase 10: Generate PDF report and dispatch notifications (Fault-isolated)
        try {
          console.log(`[Worker Job #${job.id}] 📄 Generating PDF audit report for '${auditId}'...`);
          const report = await AuditReportService.generateAuditPdf(auditId, { useMocks });
          console.log(`[Worker Job #${job.id}] 📄 PDF report ready at: ${report.pdfUrl}`);

          // Dispatch notifications
          await dispatchAuditNotifications(auditId, { useMocks });
        } catch (reportErr: unknown) {
          // Fault isolation: A report or notification failure must NEVER destroy or invalidate a completed audit
          console.warn(`[Worker Job #${job.id}] ⚠️ Post-completion report/notification warning: ${sanitizeErrorMessage(reportErr)}`);
        }

        return {
          auditId,
          status: "COMPLETED",
          score: aiResult.overall_score,
          durationMs,
          reusedCrawl,
        };
      } catch (dbErr: unknown) {
        const sanitized = sanitizeErrorMessage(dbErr);
        console.error(`[Worker Job #${job.id}] ❌ Failed to persist COMPLETED audit record: ${sanitized}`);
        throw new Error(`Database error finalizing audit: ${sanitized}`);
      }
    },
    {
      connection,
      concurrency: 2,
      ...options,
    }
  );

  worker.on("failed", (job, err) => {
    console.error(`[Worker Event] Job #${job?.id} failed (attempt ${job?.attemptsMade}/${job?.opts.attempts}): ${err.message}`);
  });

  worker.on("completed", (job) => {
    console.log(`[Worker Event] Job #${job?.id} marked COMPLETED in BullMQ.`);
  });

  return worker;
}
