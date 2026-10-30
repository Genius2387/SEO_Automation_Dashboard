import { NextRequest, NextResponse } from "next/server";
import { AuditService } from "@/services/auditService";
import { authenticateRequest } from "@/lib/auth";
import { Role } from "@prisma/client";
import { z } from "zod";

const AdminUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
  search: z.string().optional(),
});

const UpdateUserRoleSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  role: z.enum(["ADMIN", "CLIENT"] as const),
});

export async function GET(req: NextRequest) {
  const auth = await authenticateRequest(req);

  if (!auth.isAdmin) {
    return NextResponse.json(
      {
        success: false,
        error: "Unauthorized",
        message: "Valid administrative credentials are required to list users.",
      },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(req.url);
  const parseResult = AdminUsersQuerySchema.safeParse({
    page: searchParams.get("page") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
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

  const { page, pageSize, search } = parseResult.data;

  try {
    const result = await AuditService.listUsersPaginated({
      page,
      pageSize,
      search: search?.trim() ? search.trim() : undefined,
    });

    return NextResponse.json({
      success: true,
      data: result.users,
      pagination: result.pagination,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Internal database error";
    console.error("Admin users list error:", errorMsg);

    return NextResponse.json(
      {
        success: false,
        error: "ServiceUnavailable",
        message: "Could not retrieve user records from database.",
      },
      { status: 503 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await authenticateRequest(req);

  if (!auth.isAdmin) {
    return NextResponse.json(
      {
        success: false,
        error: "Unauthorized",
        message: "Valid administrative credentials are required to modify user roles.",
      },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "InvalidBody",
        message: "Request body must be valid JSON.",
      },
      { status: 400 }
    );
  }

  const parseResult = UpdateUserRoleSchema.safeParse(body);
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

  const { userId, role } = parseResult.data;

  try {
    const updated = await AuditService.updateUserRole(
      userId,
      role as Role,
      auth.user?.id
    );

    return NextResponse.json({
      success: true,
      message: `User role successfully updated to ${role}.`,
      data: updated,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Failed to update user role";

    if (errorMsg.includes("not found")) {
      return NextResponse.json(
        {
          success: false,
          error: "NotFound",
          message: errorMsg,
        },
        { status: 404 }
      );
    }

    if (errorMsg.includes("sole administrator")) {
      return NextResponse.json(
        {
          success: false,
          error: "ActionForbidden",
          message: errorMsg,
        },
        { status: 400 }
      );
    }

    console.error("Update user role error:", errorMsg);
    return NextResponse.json(
      {
        success: false,
        error: "InternalError",
        message: "Failed to update user role.",
      },
      { status: 500 }
    );
  }
}
