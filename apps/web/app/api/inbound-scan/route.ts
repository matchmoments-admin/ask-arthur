// F1 — User-scan email-forward endpoint.
//
// Receives parsed-email payloads from the Cloudflare Email Routing Worker
// (apps/cloudflare-email-worker) when the recipient tag is `scan` (the
// public-facing form is `scan+report@askarthur-inbound.com` via the
// Cloudflare subaddressing split). The worker resolves
// source = "inbound_scan" → routes here instead of the
// intel-inbound-email Edge Function.
//
// Flow:
//   1. Auth (shared-secret) + kill-switch + Zod
//   2. Parse the From: header → reply address + display name
//   3. Per-sender rate-limit (20/h)
//   4. Run analyzeForBot on subject + body (combined as a single text blob)
//   5. Send a verdict reply via Resend
//   6. logCost(feature='inbound_scan')
//
// Auth: shared-secret in `x-webhook-secret` header. Same secret value as
// INBOUND_EMAIL_WEBHOOK_SECRET so the Cloudflare Worker only carries one
// credential.
//
// Kill switch: ENABLE_USER_SCAN_INBOUND=false → 204 (Worker treats as
// "drop quietly").
//
// Cost model: ~A$0.001/Claude-Haiku call + 1 outbound Resend (in plan).
// Rate-limited per normalised sender email (plus-tags stripped, lowercased).

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Resend } from "resend";
import { render } from "@react-email/components";

import { analyzeForBot } from "@askarthur/bot-core/analyze";
import { checkInboundScanRateLimit } from "@askarthur/utils/rate-limit";
import { logger } from "@askarthur/utils/logger";
import type { Verdict } from "@askarthur/types";

import { logCost } from "@/lib/cost-telemetry";
import { buildFeedbackUrl } from "@/lib/inbound-scan-feedback";
import InboundScanResult from "@/emails/InboundScanResult";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── Payload schema (matches intel-inbound-email shape) ──────────────────

const InboundScanPayload = z.object({
  source: z.literal("inbound_scan"),
  external_id: z.string().min(8).max(128),
  subject: z.string().min(1).max(2000),
  body_md: z.string().min(1).max(50_000),
  url: z.string().url().optional(),
  from: z.string().min(3).max(320),
  to: z.string().min(3).max(320),
  received_at: z.string().datetime(),
  tags: z.array(z.string().max(64)).max(20).optional(),
});

type InboundScanPayload = z.infer<typeof InboundScanPayload>;

// ── Helpers ─────────────────────────────────────────────────────────────

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Parse RFC5322 From: "Display Name <user@example.com>" or "user@example.com". */
function parseFromHeader(from: string): { email: string; displayName?: string } | null {
  const bracketMatch = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (bracketMatch) {
    const display = bracketMatch[1]?.replace(/^"|"$/g, "").trim();
    const email = bracketMatch[2]?.trim().toLowerCase();
    if (email && /^[^@\s]+@[^@\s]+$/.test(email)) {
      return display ? { email, displayName: display } : { email };
    }
  }
  const bare = from.trim().toLowerCase();
  if (/^[^@\s]+@[^@\s]+$/.test(bare)) return { email: bare };
  return null;
}

// ── Reply rendering ─────────────────────────────────────────────────────
//
// HTML lives in apps/web/emails/InboundScanResult.tsx (React Email).
// This module only owns the headline copy (used for the email subject)
// and the plain-text fallback that goes alongside the rendered HTML in
// the Resend send.

const VERDICT_HEADLINE: Record<Verdict, string> = {
  SAFE: "Looks safe — still verify",
  UNCERTAIN: "We couldn't classify this",
  SUSPICIOUS: "This looks suspicious",
  HIGH_RISK: "Very likely a scam — do not engage",
};

function headlineFor(verdict: string): string {
  return (VERDICT_HEADLINE as Record<string, string>)[verdict] ?? "Result";
}

function buildPlainText(opts: {
  verdict: string;
  confidence: number;
  summary: string;
  redFlags: string[];
  nextSteps: string[];
  forwardedSubject: string;
  displayName?: string;
  feedbackUpUrl: string;
  feedbackDownUrl: string;
}): string {
  const headline = headlineFor(opts.verdict);
  const greeting = opts.displayName
    ? `Hi ${opts.displayName.split(" ")[0]},`
    : "Hi,";
  const lines = [
    greeting,
    "",
    "Here's what Arthur found in the email you forwarded:",
    "",
    `Verdict: ${headline}`,
    `Confidence: ${Math.round(opts.confidence * 100)}%`,
    "",
  ];
  if (opts.summary) lines.push(`Why: ${opts.summary}`, "");
  if (opts.redFlags.length > 0) {
    lines.push("Red flags:");
    for (const f of opts.redFlags.slice(0, 6)) lines.push(`  • ${f}`);
    lines.push("");
  }
  if (opts.nextSteps.length > 0) {
    lines.push("What to do:");
    opts.nextSteps.slice(0, 5).forEach((s, i) => {
      lines.push(`  ${i + 1}. ${s}`);
    });
    lines.push("");
  }
  lines.push(
    "How did we do?",
    `  Helpful: ${opts.feedbackUpUrl}`,
    `  Not helpful: ${opts.feedbackDownUrl}`,
    "",
    "Help other Aussies find Arthur — leave a review:",
    "  https://au.trustpilot.com/evaluate/askarthur.au",
    "",
    `We scanned the subject "${opts.forwardedSubject}". Forward more suspicious emails to scan@askarthur.au any time, or paste them at askarthur.au.`,
    "",
    "Ask Arthur · askarthur.au · Reply STOP to opt out.",
  );
  return lines.join("\n");
}

// ── Handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Kill switch — defaults to true so this ships safely with the F1 PR;
  // setting ENABLE_USER_SCAN_INBOUND=false in env disables the endpoint
  // without redeploying the Worker.
  const enabled = process.env.ENABLE_USER_SCAN_INBOUND;
  if (enabled === "false") {
    return new NextResponse(null, { status: 204 });
  }

  // Auth — same shared secret as intel-inbound-email.
  const expected = process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
  const provided = req.headers.get("x-webhook-secret") ?? "";
  if (!expected || !timingSafeEqual(provided, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = InboundScanPayload.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const payload = parsed.data;

  // Reply address must be parseable; otherwise we can't email a verdict.
  const sender = parseFromHeader(payload.from);
  if (!sender) {
    logger.warn("inbound-scan: unparseable From header", { from: payload.from });
    return NextResponse.json({ error: "bad_sender" }, { status: 422 });
  }

  // Per-sender rate limit. Fail-closed in prod.
  const rate = await checkInboundScanRateLimit(sender.email);
  if (!rate.allowed) {
    // We could still send a "rate limited" reply, but for now treat as
    // a quiet drop so a flood doesn't amplify into a flood of Resend
    // outbound. The next forward an hour later will land normally.
    logger.info("inbound-scan: rate limited", {
      sender: sender.email,
      reset: rate.resetAt?.toISOString(),
    });
    return new NextResponse(null, { status: 204 });
  }

  // Combine subject + body into a single text blob for the scam engine.
  // Subject often carries the scam pitch ("Your parcel could not be
  // delivered") so it must be analysed alongside the body.
  const blob = [`Subject: ${payload.subject}`, "", payload.body_md].join("\n");

  let verdict: Verdict;
  let confidence: number;
  let reasoning: string;
  let nextSteps: string[];
  let redFlags: string[];
  try {
    const result = await analyzeForBot(blob, "AU");
    verdict = result.verdict;
    confidence = result.confidence ?? 0;
    reasoning =
      result.summary ||
      result.redFlags?.[0] ||
      "We couldn't extract a clear signal.";
    nextSteps = result.nextSteps ?? [];
    redFlags = result.redFlags ?? [];
  } catch (err) {
    logger.error("inbound-scan: analyzeForBot failed", {
      error: err instanceof Error ? err.message : String(err),
      sender: sender.email,
      external_id: payload.external_id,
    });
    return NextResponse.json({ error: "analysis_failed" }, { status: 500 });
  }

  // Reply via Resend. Skip if the Resend env isn't configured — useful
  // for preview environments where we don't want to send mail.
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    logger.warn("inbound-scan: RESEND_API_KEY missing — skipping reply", {
      sender: sender.email,
      verdict,
    });
    return NextResponse.json({ ok: true, replySent: false });
  }

  const fromEmail = process.env.RESEND_FROM_EMAIL || "Ask Arthur <brendan@askarthur.au>";
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://askarthur.au";
  const feedbackUp = buildFeedbackUrl({
    baseUrl,
    externalId: payload.external_id,
    verdict,
    vote: "up",
  });
  const feedbackDown = buildFeedbackUrl({
    baseUrl,
    externalId: payload.external_id,
    verdict,
    vote: "down",
  });
  const headline = headlineFor(verdict);
  const html = await render(
    InboundScanResult({
      verdict,
      confidence,
      summary: reasoning,
      redFlags,
      nextSteps,
      forwardedSubject: payload.subject,
      displayName: sender.displayName,
      feedbackUpUrl: feedbackUp.url,
      feedbackDownUrl: feedbackDown.url,
    }),
  );
  const text = buildPlainText({
    verdict,
    confidence,
    summary: reasoning,
    redFlags,
    nextSteps,
    forwardedSubject: payload.subject,
    displayName: sender.displayName,
    feedbackUpUrl: feedbackUp.url,
    feedbackDownUrl: feedbackDown.url,
  });

  try {
    const resend = new Resend(resendKey);
    const sendResult = await resend.emails.send({
      from: fromEmail,
      to: sender.email,
      subject: `Ask Arthur scan result: ${headline}`,
      html,
      text,
      // Tag for Resend analytics so we can split scan-reply volume from
      // other transactional categories.
      tags: [{ name: "category", value: "inbound_scan_reply" }],
    });
    if (sendResult.error) {
      logger.error("inbound-scan: Resend rejected", {
        error: sendResult.error.message,
        sender: sender.email,
      });
    }
  } catch (err) {
    logger.error("inbound-scan: Resend threw", {
      error: err instanceof Error ? err.message : String(err),
      sender: sender.email,
    });
    // Don't 500 — we already analysed, and the Worker has nothing useful
    // to retry. Operator sees the log line and can resend manually if
    // needed.
  }

  // Cost telemetry — one row per successful scan. Claude Haiku spend is
  // already logged by `analyzeForBot` via the existing cost-telemetry
  // path; this row tracks the inbound_scan CHANNEL rollup so the
  // dashboard can show per-channel volume + outbound Resend spend
  // without double-counting Claude.
  logCost({
    feature: "inbound_scan",
    provider: "channel",
    operation: "email_forward",
    units: 1,
    // No marginal cost here — Claude is counted by analyzeForBot;
    // Resend is in plan. Row exists purely for volume rollup.
    estimatedCostUsd: 0,
    metadata: {
      verdict,
      confidence,
      sender_domain: sender.email.split("@")[1] ?? "",
      external_id: payload.external_id,
    },
  });

  return NextResponse.json({ ok: true, replySent: true, verdict });
}
