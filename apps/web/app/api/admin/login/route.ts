import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { readStringEnv } from "@askarthur/utils/env";
import { checkFormRateLimit } from "@askarthur/utils/rate-limit";
import { logger } from "@askarthur/utils/logger";
import { createAdminToken, COOKIE_NAME, MAX_AGE } from "@/lib/adminAuth";

export async function POST(req: NextRequest) {
  try {
    // Per-route brute-force ceiling + failure logging (map #939 / #942
    // gap 4): before this, the only limiter on guessing the single shared
    // ADMIN_SECRET was the global per-IP middleware limit, and failed
    // attempts left no log line.
    const ip =
      req.headers.get("x-real-ip") ||
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown";
    const rate = await checkFormRateLimit(`admin-login:${ip}`);
    if (!rate.allowed) {
      logger.warn("admin_login_rate_limited", { ip });
      return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
    }

    const { secret } = await req.json();

    // Trimmed read — see packages/utils/src/env.ts. Without this, a
    // Vercel-stored `ADMIN_SECRET` with a trailing newline silently 401s
    // every login attempt with no diagnosable signal.
    const adminSecret = readStringEnv("ADMIN_SECRET");
    if (!adminSecret || typeof secret !== "string") {
      logger.warn("admin_login_failed", { ip, reason: "missing_input" });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Timing-safe comparison
    const secretBuf = Buffer.from(secret);
    const expectedBuf = Buffer.from(adminSecret);
    if (
      secretBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(secretBuf, expectedBuf)
    ) {
      logger.warn("admin_login_failed", { ip, reason: "secret_mismatch" });
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
