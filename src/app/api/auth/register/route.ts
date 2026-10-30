import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import {
  hashPassword,
  createSession,
  attachSessionCookies,
  generateCsrfToken,
} from "@/lib/auth";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

const registerSchema = z.object({
  email: z.string().email("A valid email address is required").toLowerCase().trim(),
  password: z.string().min(8, "Password must be at least 8 characters long"),
  name: z.string().max(100).optional().nullable(),
});

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);

    // Rate limiting: 5 registrations per 15 minutes per IP
    const rateLimit = await checkRateLimit(`register:${ip}`, 5, 15 * 60);
    if (!rateLimit.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Too many registration attempts. Please try again later.",
          retryAfterSeconds: rateLimit.resetSeconds,
        },
        { status: 429, headers: { "Retry-After": String(rateLimit.resetSeconds) } }
      );
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Malformed JSON payload" },
        { status: 400 }
      );
    }

    const parseResult = registerSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: parseResult.error.issues[0]?.message || "Invalid registration input",
        },
        { status: 400 }
      );
    }

    const { email, password, name } = parseResult.data;

    // Check if user already exists
    const existing = await prisma.user.findUnique({
      where: { email },
    });

    if (existing) {
      return NextResponse.json(
        { success: false, error: "An account with this email address already exists" },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(password);

    // Create user in PostgreSQL
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name: name || null,
        role: "CLIENT",
      },
    });

    // Create session and set cookies
    const { token, expiresAt } = await createSession(user.id);
    const csrfToken = generateCsrfToken(token);

    const response = NextResponse.json(
      {
        success: true,
        csrfToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      },
      { status: 201 }
    );

    return attachSessionCookies(response, token, expiresAt);
  } catch (err) {
    console.error("[Auth API] Registration error:", err);
    return NextResponse.json(
      { success: false, error: "Internal registration error" },
      { status: 500 }
    );
  }
}
