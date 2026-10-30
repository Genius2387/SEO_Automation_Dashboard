import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  invalidateSession,
  clearSessionCookies,
} from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const sessionToken = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (sessionToken) {
      await invalidateSession(sessionToken);
    }

    const response = NextResponse.json({
      success: true,
      message: "Successfully logged out",
    });

    return clearSessionCookies(response);
  } catch (err) {
    console.error("[Auth API] Logout error:", err);
    const response = NextResponse.json({
      success: true,
      message: "Session cleared",
    });
    return clearSessionCookies(response);
  }
}
