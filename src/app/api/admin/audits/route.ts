import { NextRequest, NextResponse } from "next/server";
import { AuditService } from "@/services/auditService";
import { authenticateRequest } from "@/lib/auth";
import { AuditStatus } from "@prisma/client";
import { z } from "zod";

const VALID_STATUSES: AuditStatus[] = ["QUEUED", "CRAWLING", "ANALYZING", "COMPLETED", "FAILED"];

const AdminAuditsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
  status: z
    .string()
    .optional()
    .refine((val) => !val || VALID_STATUSES.includes(val as AuditStatus), {
      message: `Status must be one of: ${VALID_STATUSES.join(", ")}`,
    }),
  search: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const auth = await authenticateRequest(req);

  if (!auth.isAdmin) {
    return NextResponse.json(
      {
        success: false,
        error: "Unauthorized",
        message: "Valid administrative credentials are required to list all audits.",
      },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(req.url);
  const parseResult = AdminAuditsQuerySchema.safeParse({
    page: searchParams.get("page") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    search: searchParams.get("search") ?? undefined,
  });

  if (!parseResult.success) {
    return NextResponse.json(
      {
        success: false,
        error: "InvalidParameters",
        message: parseResult.error.issues.map((e) => e.message).join(", "),
      },
      { status: 400 }
    );
  }

  const { page, pageSize, status, search } = parseResult.data;

  try {
    const result = await AuditService.listAuditsPaginated({
      page,
      pageSize,
      isAdmin: true,
      status: status as AuditStatus | undefined,
      search: search?.trim() ? search.trim() : undefined,
    });

    return NextResponse.json({
      success: true,
      data: result.audits,
      pagination: result.pagination,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Internal database error";
    console.error("Admin audits list error:", errorMsg);

    return NextResponse.json(
      {
        success: false,
        error: "ServiceUnavailable",
        message: "Could not retrieve audit records from database.",
      },
      { status: 503 }
    );
  }
}
