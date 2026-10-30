import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import {
  verifyPassword,
  createSession,
  attachSessionCookies,
  generateCsrfToken,
} from "@/lib/auth";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

const loginSchema = z.object({
  email: z.string().email("A valid email address is required").toLowerCase().trim(),
  password: z.string().min(1, "Password is required"),
});

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);

    // Rate limiting: 5 failed attempts per 15 minutes per IP
    const rateLimit = await checkRateLimit(`login:${ip}`, 10, 15 * 60);
    if (!rateLimit.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Too many login attempts. Please try again later.",
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

    const parseResult = loginSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: parseResult.error.issues[0]?.message || "Invalid credentials format",
        },
        { status: 400 }
      );
    }

    const { email, password } = parseResult.data;

    // Look up user by email
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.passwordHash) {
      // Avoid revealing whether the user exists
      return NextResponse.json(
        { success: false, error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return NextResponse.json(
        { success: false, error: "Invalid email or password" },
        { status: 401 }
      );
    }

    // Create session and set cookies
    const { token, expiresAt } = await createSession(user.id);
    const csrfToken = generateCsrfToken(token);

    const response = NextResponse.json({
      success: true,
      csrfToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });

    return attachSessionCookies(response, token, expiresAt);
  } catch (err) {
    console.error("[Auth API] Login error:", err);
    return NextResponse.json(
      { success: false, error: "Internal authentication error" },
      { status: 500 }
    );
  }
}
