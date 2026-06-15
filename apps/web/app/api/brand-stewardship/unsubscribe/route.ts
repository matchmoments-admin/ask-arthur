import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe";
import { logger } from "@askarthur/utils/logger";

export const dynamic = "force-dynamic";

/**
 * Unsubscribe handler for the monthly Brand Stewardship Report.
 *
 * - POST: RFC 8058 one-click target (Gmail/Outlook native "Unsubscribe"
 *   button). Always returns 200 — never reveal whether the address was on the
 *   list. Mirrors /api/unsubscribe-one-click, but writes the brand-report
 *   suppression list (brand_report_unsubscribes, v182) rather than the consumer
 *   email_subscribers table.
 * - GET: the in-body "Unsubscribe" link a human clicks — performs the same
 *   suppression then renders a tiny confirmation page.
 *
 * Both verify the HMAC token (signed over the lowercased email) so a stranger
 * can't unsubscribe an arbitrary address.
 */
async function suppress(email: string): Promise<void> {
  const sb = createServiceClient();
  if (!sb) return;
  const { error } = await sb
    .from("brand_report_unsubscribes")
    .upsert(
      { email: email.toLowerCase(), source: "brand_stewardship_email" },
      { onConflict: "email", ignoreDuplicates: true },
    );
  if (error) {
    logger.error("brand-report unsubscribe: upsert failed", {
      error: error.message,
    });
  }
}

export async function POST(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email");
  const token = req.nextUrl.searchParams.get("token");
  if (email && token && verifyUnsubscribeToken(email, token)) {
    await suppress(email);
  }
  // RFC 8058: always 200, no body.
  return new NextResponse(null, { status: 200 });
}

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email");
  const token = req.nextUrl.searchParams.get("token");
  const ok = Boolean(email && token && verifyUnsubscribeToken(email, token));
  if (ok) await suppress(email!);

  const body = ok
    ? `<h1>You're unsubscribed</h1><p>We won't send any more Ask Arthur brand-protection summaries to <strong>${escapeHtml(
        email!,
      )}</strong>.</p>`
    : `<h1>Link expired</h1><p>This unsubscribe link is invalid or has expired. Reply <strong>STOP</strong> to any Ask Arthur email and we'll remove you.</p>`;

  return new NextResponse(page(body), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function page(inner: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Ask Arthur — Unsubscribe</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#F8FAFC;color:#334155;margin:0;padding:48px 20px}main{max-width:480px;margin:0 auto;background:#fff;border:1px solid #E2E8F0;border-radius:8px;padding:28px}h1{color:#1B2A4A;font-size:20px;margin:0 0 10px}p{line-height:1.6;margin:0}a{color:#0F766E}</style></head><body><main><p style="font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#0F766E;margin:0 0 12px">Ask Arthur</p>${inner}<p style="margin-top:20px"><a href="https://askarthur.au/">Visit askarthur.au</a></p></main></body></html>`;
}
