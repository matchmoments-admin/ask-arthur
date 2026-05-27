import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminToken, COOKIE_NAME, MAX_AGE } from "@/lib/adminAuth";

export async function POST(req: NextRequest) {
  try {
    const { secret } = await req.json();

    const adminSecret = process.env.ADMIN_SECRET;
    if (!adminSecret || typeof secret !== "string") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Timing-safe comparison
    const secretBuf = Buffer.from(secret);
    const expectedBuf = Buffer.from(adminSecret);
    if (
      secretBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(secretBuf, expectedBuf)
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = createAdminToken();
    const response = NextResponse.json({ success: true });

    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      // Path "/" not "/admin" — admin API routes live under /api/admin/*
      // (NOT /admin/*), so a cookie scoped to /admin is never sent on
      // dashboard button clicks. Symptom: every triage/send/reject POST
      // 307s to /admin/login because requireAdmin() doesn't see the
      // cookie. Caught 2026-05-27 during the PR #459 live e2e test.
      path: "/",
      maxAge: MAX_AGE,
    });

    return response;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
