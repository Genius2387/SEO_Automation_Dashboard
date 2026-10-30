import { NextRequest, NextResponse } from "next/server";
import {
  AuditService,
  DatabasePersistenceError,
  QueueEnqueueError,
} from "@/services/auditService";
import { authenticateRequest } from "@/lib/auth";
import { z } from "zod";

const createAuditSchema = z.object({
  targetUrl: z
    .string()
    .min(1, "Target URL is required.")
    .max(2048, "URL exceeds maximum permitted length of 2048 characters.")
    .refine((val) => {
      try {
        const parsed = new URL(val.trim());
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        return false;
      }
    }, "A valid HTTP or HTTPS website URL is required.")
    .refine((val) => {
      try {
        const parsed = new URL(val.trim());
        return !parsed.username && !parsed.password;
      } catch {
        return false;
      }
    }, "URLs containing embedded credentials (user:pass@) are disallowed."),
  businessType: z
    .string()
    .max(100, "Business type must not exceed 100 characters.")
    .optional()
    .nullable(),
  city: z
    .string()
    .max(100, "City must not exceed 100 characters.")
    .optional()
    .nullable(),
  state: z
    .string()
    .max(50, "State must not exceed 50 characters.")
    .optional()
    .nullable(),
  useMocks: z.boolean().optional(),
  sync: z.boolean().optional(),
});

import { AuditStatus } from "@prisma/client";

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateRequest(req);
    const { searchParams } = new URL(req.url);

    const rawPage = searchParams.get("page");
    const rawPageSize = searchParams.get("pageSize");
    const statusParam = searchParams.get("status");
    const searchParam = searchParams.get("search");

    // Parameter validation
    let page = 1;
    let pageSize = 10;

    if (rawPage !== null) {
      const parsedPage = parseInt(rawPage, 10);
      if (isNaN(parsedPage) || parsedPage < 1) {
        return NextResponse.json(
          {
            success: false,
            error: "Invalid query parameter",
            message: "The 'page' parameter must be an integer greater than or equal to 1.",
          },
          { status: 400 }
        );
      }
      page = parsedPage;
    }

    if (rawPageSize !== null) {
      const parsedSize = parseInt(rawPageSize, 10);
      if (isNaN(parsedSize) || parsedSize < 1 || parsedSize > 50) {
        return NextResponse.json(
          {
            success: false,
            error: "Invalid query parameter",
            message: "The 'pageSize' parameter must be an integer between 1 and 50.",
          },
          { status: 400 }
        );
      }
      pageSize = parsedSize;
    }

    let status: AuditStatus | undefined = undefined;
    if (statusParam) {
      const validStatuses: AuditStatus[] = [
        "PENDING",
        "QUEUED",
        "CRAWLING",
        "ANALYZING",
        "COMPLETED",
        "FAILED",
      ];
      if (!validStatuses.includes(statusParam as AuditStatus)) {
        return NextResponse.json(
          {
            success: false,
            error: "Invalid query parameter",
            message: `The 'status' parameter must be one of: ${validStatuses.join(", ")}`,
          },
          { status: 400 }
        );
      }
      status = statusParam as AuditStatus;
    }

    const result = await AuditService.listAuditsPaginated({
      page,
      pageSize,
      userId: auth.user?.id || null,
      isAdmin: auth.isAdmin,
      status,
      search: searchParam?.trim() || undefined,
    });

    return NextResponse.json({
      success: true,
      data: result.audits,
      pagination: result.pagination,
      meta: {
        mode: process.env.USE_MOCKS === "true" ? "mock" : "production",
        authType: auth.authType,
        isAdmin: auth.isAdmin,
      },
    });
  } catch (error: unknown) {
    const isDbError = error instanceof DatabasePersistenceError;
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      {
        success: false,
        error: isDbError ? "Database connection error" : "Internal server error",
        message: isDbError ? "PostgreSQL database query failed." : message,
      },
      { status: isDbError ? 503 : 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await authenticateRequest(req);

    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    const parsed = createAuditSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Validation error",
          details: parsed.error.issues.map((i) => ({
            field: i.path.join("."),
            message: i.message,
          })),
        },
        { status: 400 }
      );
    }

    // Bind authenticated user ID (never trust arbitrary client-supplied body userId)
    const effectiveUserId = auth.user ? auth.user.id : undefined;

    // Route to synchronous execution if explicitly opted-in
    if (parsed.data.sync) {
      const audit = await AuditService.runAudit({
        targetUrl: parsed.data.targetUrl,
        businessType: parsed.data.businessType || undefined,
        city: parsed.data.city || undefined,
        state: parsed.data.state || undefined,
        useMocks: parsed.data.useMocks,
        userId: effectiveUserId,
      });

      return NextResponse.json(
        {
          success: true,
          data: audit,
          meta: {
            mode: "synchronous",
            persisted: audit.persisted,
            storage: audit.storage,
            deduplicated: Boolean(audit.deduplicated),
          },
        },
        { status: 201 }
      );
    }

    // Default flow: Persistent record creation + BullMQ queue enqueue
    const audit = await AuditService.createQueuedAudit({
      targetUrl: parsed.data.targetUrl,
      businessType: parsed.data.businessType || undefined,
      city: parsed.data.city || undefined,
      state: parsed.data.state || undefined,
      useMocks: parsed.data.useMocks,
      userId: effectiveUserId,
    });

    const statusCode = audit.deduplicated ? 200 : 201;

    return NextResponse.json(
      {
        success: true,
        data: {
          id: audit.id,
          targetUrl: audit.targetUrl,
          status: audit.status,
          businessType: audit.businessType,
          city: audit.city,
          state: audit.state,
          jobId: audit.jobId,
          createdAt: audit.createdAt,
        },
        meta: {
          queued: true,
          persisted: audit.persisted,
          storage: audit.storage,
          deduplicated: Boolean(audit.deduplicated),
        },
      },
      { status: statusCode }
    );
  } catch (error: unknown) {
    if (error instanceof DatabasePersistenceError) {
      return NextResponse.json(
        {
          success: false,
          error: "Database persistence failure",
          message: "Could not create audit record in database.",
        },
        { status: 503 }
      );
    }

    if (error instanceof QueueEnqueueError) {
      return NextResponse.json(
        {
          success: false,
          error: "Queue service unavailable",
          message: "Failed to enqueue audit job to queue service.",
        },
        { status: 503 }
      );
    }

    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      {
        success: false,
        error: "Audit execution error",
        message,
      },
      { status: 500 }
    );
  }
}
