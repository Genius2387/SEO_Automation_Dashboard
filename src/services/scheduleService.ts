import prisma from "@/lib/prisma";
import { ScheduleFrequency, ScheduledAudit, Prisma } from "@prisma/client";
import { AuditService } from "./auditService";
import { AuthContext } from "@/lib/auth";
import { AuditRecord } from "@/types";

export interface CreateScheduleInput {
  userId: string;
  targetUrl: string;
  frequency: "WEEKLY" | "MONTHLY";
  businessType?: string | null;
  city?: string | null;
  state?: string | null;
}

export interface CronExecutionStats {
  schedulesChecked: number;
  auditsCreated: number;
  jobsQueued: number;
  duplicatesSkipped: number;
  failures: number;
  executedAt: string;
  results: Array<{
    scheduleId: string;
    targetUrl: string;
    auditId?: string;
    status: "CREATED" | "SKIPPED_DUPLICATE" | "FAILED";
    error?: string;
  }>;
}

export class ScheduleService {
  /**
   * Calculates the next execution timestamp based on frequency
   */
  static calculateNextRun(frequency: ScheduleFrequency | "WEEKLY" | "MONTHLY", fromDate = new Date()): Date {
    const next = new Date(fromDate.getTime());
    if (frequency === "WEEKLY") {
      next.setDate(next.getDate() + 7);
    } else {
      // Monthly: add 30 days or advance month
      next.setMonth(next.getMonth() + 1);
    }
    return next;
  }

  /**
   * Validates target URL syntax and security constraints (protocols, credentials)
   */
  static validateTargetUrl(rawUrl: string): string {
    if (!rawUrl || typeof rawUrl !== "string") {
      throw new Error("Target URL is required");
    }

    let parsed: URL;
    try {
      parsed = new URL(rawUrl.trim());
    } catch {
      throw new Error(`Invalid URL format: '${rawUrl}'`);
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(`Unsupported protocol '${parsed.protocol}'. Only http and https are allowed.`);
    }

    if (parsed.username || parsed.password) {
      throw new Error("URLs with embedded credentials are not allowed");
    }

    return parsed.href;
  }

  /**
   * Creates a new recurring scheduled audit
   */
  static async createSchedule(input: CreateScheduleInput): Promise<ScheduledAudit> {
    const validatedUrl = this.validateTargetUrl(input.targetUrl);
    const frequency = input.frequency === "MONTHLY" ? ScheduleFrequency.MONTHLY : ScheduleFrequency.WEEKLY;
    const nextRunAt = this.calculateNextRun(frequency);

    return prisma.scheduledAudit.create({
      data: {
        userId: input.userId,
        targetUrl: validatedUrl,
        frequency,
        businessType: input.businessType ? input.businessType.slice(0, 100) : null,
        city: input.city ? input.city.slice(0, 100) : null,
        state: input.state ? input.state.slice(0, 100) : null,
        isActive: true,
        nextRunAt,
      },
    });
  }

  /**
   * Lists scheduled audits with client-ownership or admin scoping
   */
  static async listSchedules(auth: AuthContext): Promise<ScheduledAudit[]> {
    const where: Prisma.ScheduledAuditWhereInput = {};

    if (!auth.isAdmin) {
      if (!auth.user) return [];
      where.userId = auth.user.id;
    }

    return prisma.scheduledAudit.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        lastAudit: {
          select: {
            id: true,
            status: true,
            score: true,
            pdfReportUrl: true,
            completedAt: true,
            createdAt: true,
          },
        },
      },
    });
  }

  /**
   * Retrieves a single scheduled audit ensuring caller authorization
   */
  static async getScheduleById(scheduleId: string, auth: AuthContext): Promise<ScheduledAudit | null> {
    const schedule = await prisma.scheduledAudit.findUnique({
      where: { id: scheduleId },
      include: {
        lastAudit: true,
      },
    });

    if (!schedule) return null;

    if (!auth.isAdmin && (!auth.user || auth.user.id !== schedule.userId)) {
      throw new Error("Unauthorized to access this scheduled audit");
    }

    return schedule;
  }

  /**
   * Updates an existing schedule (pause, resume, frequency, targetUrl)
   */
  static async updateSchedule(
    scheduleId: string,
    updates: {
      isActive?: boolean;
      frequency?: "WEEKLY" | "MONTHLY";
      targetUrl?: string;
      businessType?: string | null;
      city?: string | null;
      state?: string | null;
    },
    auth: AuthContext
  ): Promise<ScheduledAudit> {
    const schedule = await this.getScheduleById(scheduleId, auth);
    if (!schedule) {
      throw new Error("Scheduled audit not found");
    }

    const data: Prisma.ScheduledAuditUpdateInput = {};

    if (updates.targetUrl !== undefined) {
      data.targetUrl = this.validateTargetUrl(updates.targetUrl);
    }

    if (updates.frequency !== undefined) {
      data.frequency = updates.frequency === "MONTHLY" ? ScheduleFrequency.MONTHLY : ScheduleFrequency.WEEKLY;
      // Recalculate next run with new frequency if active
      if (schedule.isActive) {
        data.nextRunAt = this.calculateNextRun(data.frequency as ScheduleFrequency);
      }
    }

    if (updates.businessType !== undefined) {
      data.businessType = updates.businessType ? updates.businessType.slice(0, 100) : null;
    }

    if (updates.city !== undefined) {
      data.city = updates.city ? updates.city.slice(0, 100) : null;
    }

    if (updates.state !== undefined) {
      data.state = updates.state ? updates.state.slice(0, 100) : null;
    }

    if (updates.isActive !== undefined) {
      data.isActive = updates.isActive;
      // When resuming a paused schedule whose nextRunAt is in the past, update nextRunAt to future
      if (updates.isActive && schedule.nextRunAt <= new Date()) {
        data.nextRunAt = this.calculateNextRun(schedule.frequency);
      }
    }

    return prisma.scheduledAudit.update({
      where: { id: scheduleId },
      data,
      include: {
        lastAudit: true,
      },
    });
  }

  /**
   * Deletes a scheduled audit
   */
  static async deleteSchedule(scheduleId: string, auth: AuthContext): Promise<boolean> {
    const schedule = await this.getScheduleById(scheduleId, auth);
    if (!schedule) {
      throw new Error("Scheduled audit not found");
    }

    await prisma.scheduledAudit.delete({
      where: { id: scheduleId },
    });

    return true;
  }

  /**
   * Manually executes a scheduled audit immediately ("Run now")
   */
  static async runScheduleNow(
    scheduleId: string,
    auth: AuthContext,
    options?: { useMocks?: boolean }
  ): Promise<{ audit: AuditRecord; schedule: ScheduledAudit }> {
    const schedule = await this.getScheduleById(scheduleId, auth);
    if (!schedule) {
      throw new Error("Scheduled audit not found");
    }

    // Create and enqueue audit job
    const audit = await AuditService.createQueuedAudit({
      targetUrl: schedule.targetUrl,
      businessType: schedule.businessType || undefined,
      city: schedule.city || undefined,
      state: schedule.state || undefined,
      userId: schedule.userId,
      useMocks: options?.useMocks,
    });

    // Update schedule lastRunAt and lastAuditId
    const updatedSchedule = await prisma.scheduledAudit.update({
      where: { id: scheduleId },
      data: {
        lastRunAt: new Date(),
        lastAuditId: audit.id,
      },
      include: {
        lastAudit: true,
      },
    });

    return { audit, schedule: updatedSchedule };
  }

  /**
   * Core cron processing loop: identifies all due active schedules,
   * creates audits, updates next execution timestamps atomically,
   * and prevents duplicate execution across concurrent invocations.
   */
  static async processDueSchedules(options?: number | {
    batchSize?: number;
    useMocks?: boolean;
    now?: Date;
  }): Promise<CronExecutionStats> {
    const resolved = typeof options === "number" ? { batchSize: options } : options;
    const now = resolved?.now || new Date();
    const batchSize = Math.min(resolved?.batchSize || 50, 100);
    const useMocks = resolved?.useMocks ?? (process.env.USE_MOCKS === "true");

    // 1. Fetch due active schedules (nextRunAt <= now)
    const dueSchedules = await prisma.scheduledAudit.findMany({
      where: {
        isActive: true,
        nextRunAt: { lte: now },
      },
      take: batchSize,
      orderBy: { nextRunAt: "asc" },
    });

    const stats: CronExecutionStats = {
      schedulesChecked: dueSchedules.length,
      auditsCreated: 0,
      jobsQueued: 0,
      duplicatesSkipped: 0,
      failures: 0,
      executedAt: now.toISOString(),
      results: [],
    };

    if (dueSchedules.length === 0) {
      return stats;
    }

    // 2. Process each due schedule with concurrency and duplicate guards
    for (const schedule of dueSchedules) {
      try {
        const nextRunAt = this.calculateNextRun(schedule.frequency, now);

        // Concurrency defense: Atomically advance nextRunAt and set lastRunAt only if nextRunAt is still <= now
        const claimResult = await prisma.scheduledAudit.updateMany({
          where: {
            id: schedule.id,
            isActive: true,
            nextRunAt: { lte: now },
          },
          data: {
            lastRunAt: now,
            nextRunAt,
          },
        });

        if (claimResult.count === 0) {
          // Another concurrent cron runner already claimed this schedule
          stats.duplicatesSkipped += 1;
          stats.results.push({
            scheduleId: schedule.id,
            targetUrl: schedule.targetUrl,
            status: "SKIPPED_DUPLICATE",
          });
          continue;
        }

        // Create queued audit in PostgreSQL and enqueue BullMQ job
        const audit = await AuditService.createQueuedAudit({
          targetUrl: schedule.targetUrl,
          businessType: schedule.businessType || undefined,
          city: schedule.city || undefined,
          state: schedule.state || undefined,
          userId: schedule.userId,
          useMocks,
        });

        // Link audit ID to schedule
        await prisma.scheduledAudit.update({
          where: { id: schedule.id },
          data: { lastAuditId: audit.id },
        });

        stats.auditsCreated += 1;
        stats.jobsQueued += 1;
        stats.results.push({
          scheduleId: schedule.id,
          targetUrl: schedule.targetUrl,
          auditId: audit.id,
          status: "CREATED",
        });
      } catch (scheduleErr) {
        const msg = scheduleErr instanceof Error ? scheduleErr.message : String(scheduleErr);
        console.error(`[Cron Service] Failed to process schedule #${schedule.id}:`, msg);
        stats.failures += 1;
        stats.results.push({
          scheduleId: schedule.id,
          targetUrl: schedule.targetUrl,
          status: "FAILED",
          error: msg,
        });
      }
    }

    return stats;
  }
}
