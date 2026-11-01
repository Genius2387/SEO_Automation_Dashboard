import prisma from "@/lib/prisma";
import { crawlWebsite } from "@/crawlers";
import { analyzeSeoAudit } from "@/ai";
import { Prisma, Role, AuditStatus } from "@prisma/client";
import { AuditInput, AuditRecord } from "@/types";
import { addAuditJob } from "@/queue";

export class DatabasePersistenceError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "DatabasePersistenceError";
  }
}

export class QueueEnqueueError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "QueueEnqueueError";
  }
}

export interface PaginationOptions {
  page?: number;
  pageSize?: number;
  userId?: string | null;
  isAdmin?: boolean;
  status?: AuditStatus;
  search?: string;
}

export interface PaginatedAuditsResult {
  audits: AuditRecord[];
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
  };
}

export interface AdminOverviewMetrics {
  totalAudits: number;
  completedAudits: number;
  failedAudits: number;
  queuedAudits: number;
  crawlingAudits: number;
  analyzingAudits: number;
  averageScore: number | null;
  totalUsers: number;
  recentFailures: {
    id: string;
    targetUrl: string;
    errorMessage: string | null;
    updatedAt: Date | string;
    createdAt: Date | string;
  }[];
}

export interface ClientOverviewMetrics {
  totalAudits: number;
  completedAudits: number;
  processingAudits: number;
  failedAudits: number;
  latestScore: number | null;
  averageScore: number | null;
  recentAudits: {
    id: string;
    targetUrl: string;
    status: AuditStatus;
    score: number | null;
    createdAt: Date | string;
    completedAt?: Date | string | null;
  }[];
}

export interface UserSummaryItem {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  createdAt: Date | string;
  auditCount: number;
}

export interface PaginatedUsersResult {
  users: UserSummaryItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
  };
}

export class AuditService {
  /**
   * Enqueue an audit for asynchronous processing via BullMQ & Upstash Redis.
   * 1. Validates and checks for recent active duplicate audit to prevent redundant work
   * 2. Persists an Audit record in PostgreSQL with status QUEUED
   * 3. Enqueues a job in BullMQ with deterministic job ID
   * 4. Updates record to FAILED if enqueueing fails to prevent stuck records
   */
  static async createQueuedAudit(input: AuditInput): Promise<AuditRecord & { jobId?: string }> {
    const isMock =
      input.useMocks !== undefined
        ? input.useMocks
        : process.env.USE_MOCKS === "true";

    // Validate user exists if userId was provided
    let verifiedUserId: string | null = null;
    if (input.userId) {
      try {
        const user = await prisma.user.findUnique({
          where: { id: input.userId },
        });
        if (user) {
          verifiedUserId = user.id;
        }
      } catch {
        // If DB query fails for user, leave verifiedUserId null
      }
    }

    // 1. Check for active duplicate audit (submitted within last 5 minutes that is still processing)
    try {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const existingActive = await prisma.audit.findFirst({
        where: {
          targetUrl: input.targetUrl,
          userId: verifiedUserId,
          status: { in: ["QUEUED", "CRAWLING", "ANALYZING"] },
          createdAt: { gte: fiveMinutesAgo },
        },
        orderBy: { createdAt: "desc" },
      });

      if (existingActive) {
        return {
          ...existingActive,
          persisted: true,
          storage: "database",
          jobId: `audit-${existingActive.id}`,
          deduplicated: true,
        };
      }
    } catch {
      // Continue to creation if duplicate check fails
    }

    // 2. Create persistent Audit record in PostgreSQL with initial status QUEUED
    let record;
    try {
      record = await prisma.audit.create({
        data: {
          targetUrl: input.targetUrl,
          businessType: input.businessType || null,
          city: input.city || null,
          state: input.state || null,
          status: "QUEUED",
          userId: verifiedUserId,
        },
      });
    } catch (dbErr: unknown) {
      const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
      console.error("❌ Failed to persist initial Audit record to PostgreSQL:", msg);
      throw new DatabasePersistenceError(`Failed to persist audit to database: ${msg}`, dbErr);
    }

    // 3. Enqueue job into BullMQ
    try {
      const { jobId, deduplicated } = await addAuditJob({
        auditId: record.id,
        targetUrl: record.targetUrl,
        businessType: record.businessType,
        city: record.city,
        state: record.state,
        userId: record.userId,
        useMocks: isMock,
      });

      return {
        ...record,
        persisted: true,
        storage: "database",
        jobId,
        deduplicated,
      };
    } catch (queueErr: unknown) {
      const msg = queueErr instanceof Error ? queueErr.message : String(queueErr);
      console.error(`❌ Failed to enqueue job for audit #${record.id}:`, msg);

      // Prevent record from being permanently stuck in QUEUED
      try {
        await prisma.audit.update({
          where: { id: record.id },
          data: {
            status: "FAILED",
            errorMessage: `Failed to enqueue job to queue service: ${msg}`,
          },
        });
      } catch (cleanupErr) {
        console.error("Failed to update status to FAILED after enqueue error:", cleanupErr);
      }

      throw new QueueEnqueueError(`Failed to enqueue job in BullMQ queue: ${msg}`, queueErr);
    }
  }

  /**
   * Run an audit synchronously (Preserved for backwards compatibility & smoke tests)
   */
  static async runAudit(input: AuditInput | string): Promise<AuditRecord> {
    const params: AuditInput =
      typeof input === "string" ? { targetUrl: input } : input;
    const { targetUrl, businessType, city, state, userId } = params;

    const isMock =
      params.useMocks !== undefined
        ? params.useMocks
        : process.env.USE_MOCKS === "true";

    // 1. Crawl website
    const crawlData = await crawlWebsite(targetUrl, {
      useMocks: isMock,
      businessType,
      city,
      state,
    });

    // 2. Perform AI analysis using Phase 6 Claude AI Engine
    const aiAnalysis = await analyzeSeoAudit(crawlData, { useMocks: isMock });

    // 3. Handle Persistence
    // Case A: Mock Mode is explicitly active
    if (isMock) {
      return {
        id: `mock-audit-${Date.now()}`,
        targetUrl,
        businessType: businessType || null,
        city: city || null,
        state: state || null,
        status: "COMPLETED",
        score: aiAnalysis.overall_score,
        rawCrawlData: crawlData,
        aiAnalysisData: aiAnalysis,
        pdfReportUrl: null,
        errorMessage: null,
        completedAt: new Date(),
        userId: userId || null,
        createdAt: new Date(),
        updatedAt: new Date(),
        persisted: false,
        storage: "in-memory-mock",
        deduplicated: false,
      };
    }

    // Case B: Real mode - database persistence MUST succeed.
    try {
      const record = await prisma.audit.create({
        data: {
          targetUrl,
          businessType: businessType || null,
          city: city || null,
          state: state || null,
          status: "COMPLETED",
          score: aiAnalysis.overall_score,
          rawCrawlData: crawlData as unknown as Prisma.InputJsonValue,
          aiAnalysisData: aiAnalysis as unknown as Prisma.InputJsonValue,
          completedAt: new Date(),
          userId: userId || null,
        },
      });

      return {
        ...record,
        persisted: true,
        storage: "database",
        deduplicated: false,
      };
    } catch (dbError: unknown) {
      const errorMsg =
        dbError instanceof Error ? dbError.message : String(dbError);
      console.error("❌ PostgreSQL persistence failed during audit:", errorMsg);
      throw new DatabasePersistenceError(
        `Failed to persist audit to PostgreSQL database: ${errorMsg}`,
        dbError
      );
    }
  }

  /**
   * Retrieves paginated audits with database-level skip/take, search, status filtering,
   * and strict user ownership filtering.
   */
  static async listAuditsPaginated(options: PaginationOptions = {}): Promise<PaginatedAuditsResult> {
    const isMock = process.env.USE_MOCKS === "true";

    const page = Math.max(1, Math.floor(options.page || 1));
    const pageSize = Math.min(50, Math.max(1, Math.floor(options.pageSize || 10)));
    const skip = (page - 1) * pageSize;

    // Build filter based on role, user ID, status, and search string
    const where: Prisma.AuditWhereInput = {};

    if (!options.isAdmin) {
      if (options.userId) {
        where.userId = options.userId;
      } else {
        // Unauthenticated client only views public/anonymous audits
        where.userId = null;
      }
    } else if (options.userId) {
      // Admin filtering for a specific user
      where.userId = options.userId;
    }

    if (options.status) {
      where.status = options.status;
    }

    if (options.search && options.search.trim().length > 0) {
      where.targetUrl = {
        contains: options.search.trim(),
        mode: "insensitive",
      };
    }

    try {
      const [totalCount, records] = await prisma.$transaction([
        prisma.audit.count({ where }),
        prisma.audit.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: pageSize,
        }),
      ]);

      const totalPages = Math.ceil(totalCount / pageSize) || 1;

      return {
        audits: records.map((rec) => ({
          ...rec,
          persisted: true,
          storage: "database" as const,
        })),
        pagination: {
          page,
          pageSize,
          totalCount,
          totalPages,
        },
      };
    } catch (dbError) {
      if (isMock) {
        console.warn("⚠️ Database unreachable in mock mode. Returning empty paginated audit list.");
        return {
          audits: [],
          pagination: {
            page: 1,
            pageSize,
            totalCount: 0,
            totalPages: 1,
          },
        };
      }
      const errorMsg = dbError instanceof Error ? dbError.message : String(dbError);
      console.error("❌ Failed to query paginated audits from PostgreSQL:", errorMsg);
      throw new DatabasePersistenceError(`Failed to retrieve audits from database: ${errorMsg}`, dbError);
    }
  }

  /**
   * Backward-compatible audit listing (returns up to 20 audits).
   */
  static async listAudits(userId?: string | null, isAdmin?: boolean): Promise<AuditRecord[]> {
    const result = await this.listAuditsPaginated({
      page: 1,
      pageSize: 20,
      userId,
      isAdmin,
    });
    return result.audits;
  }

  /**
   * Retrieves an audit by ID from PostgreSQL.
   */
  static async getAuditById(id: string): Promise<AuditRecord | null> {
    const isMock = process.env.USE_MOCKS === "true";

    if (!id || id.trim() === "" || id.startsWith("mock-")) {
      return null;
    }

    try {
      const record = await prisma.audit.findUnique({
        where: { id },
      });
      if (!record) return null;
      return {
        ...record,
        persisted: true,
        storage: "database",
      };
    } catch (dbError) {
      if (isMock) return null;
      throw dbError;
    }
  }

  /**
   * Aggregates real operational metrics from PostgreSQL for the Admin Overview dashboard.
   */
  static async getAdminOverviewMetrics(): Promise<AdminOverviewMetrics> {
    const isMock = process.env.USE_MOCKS === "true";

    try {
      const [
        totalAudits,
        completedAudits,
        failedAudits,
        queuedAudits,
        crawlingAudits,
        analyzingAudits,
        scoreAgg,
        totalUsers,
        recentFailures,
      ] = await prisma.$transaction([
        prisma.audit.count(),
        prisma.audit.count({ where: { status: "COMPLETED" } }),
        prisma.audit.count({ where: { status: "FAILED" } }),
        prisma.audit.count({ where: { status: "QUEUED" } }),
        prisma.audit.count({ where: { status: "CRAWLING" } }),
        prisma.audit.count({ where: { status: "ANALYZING" } }),
        prisma.audit.aggregate({
          where: { status: "COMPLETED", score: { not: null } },
          _avg: { score: true },
        }),
        prisma.user.count(),
        prisma.audit.findMany({
          where: { status: "FAILED" },
          select: {
            id: true,
            targetUrl: true,
            errorMessage: true,
            updatedAt: true,
            createdAt: true,
          },
          orderBy: { updatedAt: "desc" },
          take: 5,
        }),
      ]);

      const avg = scoreAgg._avg.score;
      const averageScore = avg !== null ? Math.round(avg) : null;

      return {
        totalAudits,
        completedAudits,
        failedAudits,
        queuedAudits,
        crawlingAudits,
        analyzingAudits,
        averageScore,
        totalUsers,
        recentFailures,
      };
    } catch (err) {
      if (isMock) {
        return {
          totalAudits: 0,
          completedAudits: 0,
          failedAudits: 0,
          queuedAudits: 0,
          crawlingAudits: 0,
          analyzingAudits: 0,
          averageScore: null,
          totalUsers: 0,
          recentFailures: [],
        };
      }
      throw new DatabasePersistenceError("Failed to calculate admin overview metrics from database.", err);
    }
  }

  /**
   * Aggregates client-scoped overview metrics directly in PostgreSQL via atomic transactions.
   */
  static async getClientOverviewMetrics(userId: string | null): Promise<ClientOverviewMetrics> {
    const isMock = process.env.USE_MOCKS === "true";
    const where: Prisma.AuditWhereInput = userId ? { userId } : { userId: null };

    try {
      const [
        totalAudits,
        completedAudits,
        processingAudits,
        failedAudits,
        scoreAgg,
        latestCompleted,
        recentAudits,
      ] = await prisma.$transaction([
        prisma.audit.count({ where }),
        prisma.audit.count({ where: { ...where, status: "COMPLETED" } }),
        prisma.audit.count({
          where: {
            ...where,
            status: { in: ["PENDING", "QUEUED", "CRAWLING", "ANALYZING"] },
          },
        }),
        prisma.audit.count({ where: { ...where, status: "FAILED" } }),
        prisma.audit.aggregate({
          where: { ...where, status: "COMPLETED", score: { not: null } },
          _avg: { score: true },
        }),
        prisma.audit.findFirst({
          where: { ...where, status: "COMPLETED", score: { not: null } },
          orderBy: { createdAt: "desc" },
          select: { score: true },
        }),
        prisma.audit.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            targetUrl: true,
            status: true,
            score: true,
            createdAt: true,
            completedAt: true,
          },
        }),
      ]);

      const avg = scoreAgg._avg.score;
      const averageScore = avg !== null ? Math.round(avg) : null;
      const latestScore = latestCompleted?.score ?? null;

      return {
        totalAudits,
        completedAudits,
        processingAudits,
        failedAudits,
        latestScore,
        averageScore,
        recentAudits,
      };
    } catch (err) {
      if (isMock) {
        return {
          totalAudits: 0,
          completedAudits: 0,
          processingAudits: 0,
          failedAudits: 0,
          latestScore: null,
          averageScore: null,
          recentAudits: [],
        };
      }
      throw new DatabasePersistenceError("Failed to calculate client overview metrics from database.", err);
    }
  }

  /**
   * Safely retries an eligible FAILED audit by resetting status to QUEUED and re-enqueuing in BullMQ.
   */
  static async retryFailedAudit(auditId: string): Promise<{ id: string; status: AuditStatus; jobId: string }> {
    const audit = await prisma.audit.findUnique({
      where: { id: auditId },
    });

    if (!audit) {
      throw new Error(`Audit with ID '${auditId}' not found.`);
    }

    if (audit.status !== "FAILED") {
      throw new Error(`Only audits in FAILED status can be retried. Current status is ${audit.status}.`);
    }

    // Reset status to QUEUED and clear error message
    const updated = await prisma.audit.update({
      where: { id: auditId },
      data: {
        status: "QUEUED",
        errorMessage: null,
      },
    });

    // Enqueue job back into BullMQ
    const { jobId } = await addAuditJob({
      auditId: updated.id,
      targetUrl: updated.targetUrl,
      businessType: updated.businessType,
      city: updated.city,
      state: updated.state,
      userId: updated.userId,
      useMocks: process.env.USE_MOCKS === "true",
    });

    return {
      id: updated.id,
      status: "QUEUED",
      jobId,
    };
  }

  /**
   * Lists users with audit counts and database pagination for user administration.
   */
  static async listUsersPaginated(options: { page?: number; pageSize?: number; search?: string } = {}): Promise<PaginatedUsersResult> {
    const isMock = process.env.USE_MOCKS === "true";

    const page = Math.max(1, Math.floor(options.page || 1));
    const pageSize = Math.min(50, Math.max(1, Math.floor(options.pageSize || 10)));
    const skip = (page - 1) * pageSize;

    const where: Prisma.UserWhereInput = {};
    if (options.search && options.search.trim().length > 0) {
      const q = options.search.trim();
      where.OR = [
        { email: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
      ];
    }

    try {
      const [totalCount, users] = await prisma.$transaction([
        prisma.user.count({ where }),
        prisma.user.findMany({
          where,
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            createdAt: true,
            _count: {
              select: { audits: true },
            },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: pageSize,
        }),
      ]);

      const totalPages = Math.ceil(totalCount / pageSize) || 1;

      return {
        users: users.map((u) => ({
          id: u.id,
          email: u.email,
          name: u.name,
          role: u.role,
          createdAt: u.createdAt,
          auditCount: u._count.audits,
        })),
        pagination: {
          page,
          pageSize,
          totalCount,
          totalPages,
        },
      };
    } catch (err) {
      if (isMock) {
        return {
          users: [],
          pagination: { page: 1, pageSize: 10, totalCount: 0, totalPages: 1 },
        };
      }
      throw new DatabasePersistenceError("Failed to list users from database.", err);
    }
  }

  /**
   * Updates a user's role with protection against removing the sole administrator.
   */
  static async updateUserRole(userId: string, newRole: Role, requesterUserId?: string): Promise<{ id: string; email: string; role: Role }> {
    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!targetUser) {
      throw new Error(`User with ID '${userId}' not found.`);
    }

    if (targetUser.role === "ADMIN" && newRole === "CLIENT") {
      if (requesterUserId && requesterUserId === userId) {
        throw new Error("Administrators cannot demote their own account.");
      }

      const adminCount = await prisma.user.count({
        where: { role: "ADMIN" },
      });

      if (adminCount <= 1) {
        throw new Error("Cannot demote the sole administrator of the system.");
      }
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { role: newRole },
      select: {
        id: true,
        email: true,
        role: true,
      },
    });

    return updated;
  }

  /**
   * Reconciles audits that have been stuck in an active state (QUEUED, CRAWLING, ANALYZING)
   * past a specified time threshold (default: 15 minutes), marking them as FAILED.
   */
  static async reconcileStalledAudits(stalledMinutes = 15): Promise<number> {
    const threshold = new Date(Date.now() - stalledMinutes * 60 * 1000);

    try {
      const result = await prisma.audit.updateMany({
        where: {
          status: { in: ["QUEUED", "CRAWLING", "ANALYZING"] },
          updatedAt: { lt: threshold },
        },
        data: {
          status: "FAILED",
          errorMessage: "Audit processing timed out or worker stalled.",
        },
      });

      if (result.count > 0) {
        console.log(`[Audit Reconciliation] Reconciled ${result.count} stalled audit(s) to FAILED.`);
      }

      return result.count;
    } catch (err) {
      console.error("Failed to reconcile stalled audits:", err);
      return 0;
    }
  }
}
