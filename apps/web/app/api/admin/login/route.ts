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
      path: "/admin",
      maxAge: MAX_AGE,
    });

    return response;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
