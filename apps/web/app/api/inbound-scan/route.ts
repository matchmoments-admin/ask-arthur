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
import type { AnalysisResult, Verdict } from "@askarthur/types";

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

// ── Retry wrapper for analyzeForBot ─────────────────────────────────────
//
// Anthropic Claude returns 529 (overloaded_error) during peak hours — a
// transient capacity error that always resolves within seconds. The SDK
// defaults to retrying 5xx, but our per-call 15s timeout in claude.ts
// caps the SDK's retry budget too tightly, so 529s leak out to callers
// here. Without this wrapper a 529 turned into a silent dropped email
// (incident 2026-05-18 — see jacobovers@gmail.com x2).
//
// We retry transient failures (5xx, 408, 429, "overloaded", connection
// resets, fetch failures) with exponential backoff (1s, 3s). The total
// worst-case wall time is ~4s of sleep + 3 × 15s per-attempt timeout =
// ~50s, which is why /api/inbound-scan needs maxDuration: 60 in
// vercel.json. Anything non-transient (validation errors, our own bugs)
// throws on the first attempt — retrying would just delay the failure.
async function analyzeWithRetries(
  blob: string,
  region: string,
  maxAttempts = 3,
): Promise<AnalysisResult> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await analyzeForBot(blob, region);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient =
        /\b(408|429|5\d\d)\b|overloaded|rate.?limit|timeout|ECONNRESET|ETIMEDOUT|fetch failed|network/i.test(
          msg,
        );
      if (!isTransient || attempt === maxAttempts) throw err;
      const delayMs = 1000 * Math.pow(3, attempt - 1); // 1s, 3s
      logger.warn("inbound-scan: analyzeForBot retrying", {
        attempt,
        of: maxAttempts,
        delay_ms: delayMs,
        error: msg.slice(0, 200),
      });
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr; // unreachable — loop either returns or rethrows
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
  const startedAt = Date.now();

  // Always log a "received" line BEFORE auth — this is what lets an
  // operator confirm the worker is reaching the route at all when
  // downstream auth/zod/analyzeForBot is silently failing. Without this,
  // the only signal we had during the 2026-05-17 investigation was the
  // absence of cost_telemetry rows, which conflates "worker didn't run"
  // with "worker ran but the route rejected it".
  const ip = req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for") ?? "unknown";
  const ua = req.headers.get("user-agent") ?? "unknown";
  const contentLen = req.headers.get("content-length") ?? "0";
  logger.info("inbound-scan: received", {
    ip,
    ua: ua.slice(0, 80),
    content_length: contentLen,
    has_secret: Boolean(req.headers.get("x-webhook-secret")),
  });

  // Kill switch — defaults to true so this ships safely with the F1 PR;
  // setting ENABLE_USER_SCAN_INBOUND=false in env disables the endpoint
  // without redeploying the Worker.
  const enabled = process.env.ENABLE_USER_SCAN_INBOUND;
  if (enabled === "false") {
    // logger.warn (not info) so the admin /costs dashboard surfaces this —
    // a stuck kill-switch is a silent drop, and silent drops kill trust.
    logger.warn("inbound-scan: kill-switch active — request dropped", { ip });
    return new NextResponse(null, { status: 204 });
  }

  // Auth — same shared secret as intel-inbound-email.
  const expected = process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
  const provided = req.headers.get("x-webhook-secret") ?? "";
  if (!expected || !timingSafeEqual(provided, expected)) {
    logger.warn("inbound-scan: unauthorized", {
      ip,
      ua: ua.slice(0, 80),
      has_expected: Boolean(expected),
      provided_len: provided.length,
    });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    logger.warn("inbound-scan: invalid JSON body", { ip });
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = InboundScanPayload.safeParse(raw);
  if (!parsed.success) {
    // Should never happen in steady state — the Worker constructs this
    // payload. If it does, it's a Worker bug or a malicious POST, and
    // an operator needs to see the diff between what arrived and the
    // schema. Don't bury it at debug.
    logger.warn("inbound-scan: payload validation failed", {
      ip,
      issues: parsed.error.issues.slice(0, 5),
    });
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

  // Per-sender rate limit.
  //
  // Pass failMode: "open" — inbound-scan is cheap (A$0.001/email Claude
  // Haiku + in-plan Resend send) and the cost of silently dropping a
  // legitimate user's email during a Redis blip dwarfs the cost of a
  // brief uncapped window. The fail-open path is loud (logger.error in
  // storeUnavailable → admin /costs dashboard + Telegram digest) so an
  // operator notices and a daily feature_brake is still the hard ceiling.
  //
  // Branch on `reason`:
  //   - exceeded         → user genuinely hit 3/day. Send polite reply.
  //                        Do NOT silent-drop — they're a real user.
  //   - store_unavailable → Upstash blip. Already logged at error level
  //                        by storeUnavailable(); process the email
  //                        anyway. allowed will be true under fail-open.
  //   - ok               → continue.
  const rate = await checkInboundScanRateLimit(sender.email, "open");
  if (rate.reason === "exceeded") {
    // Polite reply — quota hit is a UX problem, not an attack.
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      try {
        const resend = new Resend(resendKey);
        const fromEmail =
          process.env.RESEND_FROM_EMAIL ||
          "Ask Arthur <brendan@askarthur.au>";
        await resend.emails.send({
          from: fromEmail,
          to: sender.email,
          subject: "Ask Arthur — daily forward limit reached",
          text: [
            sender.displayName ? `Hi ${sender.displayName.split(" ")[0]},` : "Hi,",
            "",
            "You've hit today's free-forward limit (3 emails per day).",
            "",
            "Need to check something now? Paste it at https://askarthur.au — no daily cap on the web scanner.",
            "",
            "Your forward quota will reset in 24 hours.",
            "",
            "Ask Arthur · askarthur.au",
          ].join("\n"),
          tags: [{ name: "category", value: "inbound_scan_quota" }],
        });
      } catch (err) {
        logger.error("inbound-scan: quota reply failed", {
          error: err instanceof Error ? err.message : String(err),
          sender: sender.email,
        });
      }
    }
    logger.info("inbound-scan: quota exceeded", {
      sender: sender.email,
      reset: rate.resetAt?.toISOString(),
    });
    // 200 not 204 — the worker should see "we handled it" so it doesn't
    // try to quarantine. The user got a reply explaining the limit.
    return NextResponse.json({ ok: true, replySent: true, reason: "quota_exceeded" });
  }
  if (rate.reason === "store_unavailable") {
    // Already logged at error level by storeUnavailable. Keep going —
    // the email will still get scanned and the user will still get a
    // reply. Cost ceiling is the feature_brakes daily cap, not the
    // per-sender rate limit.
    logger.error("inbound-scan: rate limit store unavailable — processing anyway", {
      sender: sender.email,
    });
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
    const result = await analyzeWithRetries(blob, "AU");
    verdict = result.verdict;
    confidence = result.confidence ?? 0;
    reasoning =
      result.summary ||
      result.redFlags?.[0] ||
      "We couldn't extract a clear signal.";
    nextSteps = result.nextSteps ?? [];
    redFlags = result.redFlags ?? [];
  } catch (err) {
    // Retries are exhausted. Don't silently 500 — that loses the user's
    // request forever. Send an honest "we're overloaded right now"
    // apology reply so the user knows we received them and what to do
    // next, then return 200 to the Worker so it doesn't quarantine.
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error("inbound-scan: analyzeForBot failed after retries", {
      error: errMsg,
      sender: sender.email,
      external_id: payload.external_id,
    });
    const resendKey = process.env.RESEND_API_KEY;
    let apologySent = false;
    if (resendKey) {
      try {
        const resend = new Resend(resendKey);
        const fromEmail =
          process.env.RESEND_FROM_EMAIL ||
          "Ask Arthur <brendan@askarthur.au>";
        const sendResult = await resend.emails.send({
          from: fromEmail,
          to: sender.email,
          subject: "Ask Arthur — temporarily overloaded, please retry",
          text: [
            sender.displayName ? `Hi ${sender.displayName.split(" ")[0]},` : "Hi,",
            "",
            "We received the email you forwarded, but our scam-detection AI is temporarily overloaded and couldn't analyse it just now.",
            "",
            "Two ways to get a verdict right now:",
            "  1. Forward the same email again in a few minutes — these blips usually clear in 1–2 minutes.",
            "  2. Paste it directly at https://askarthur.au — same AI, different queue, often clearer when the email path is busy.",
            "",
            "Apologies for the inconvenience. We treat every forward as a real request — there's no risk you'll fall through the cracks.",
            "",
            "Ask Arthur · askarthur.au",
          ].join("\n"),
          tags: [{ name: "category", value: "inbound_scan_apology" }],
        });
        if (!sendResult.error) apologySent = true;
        else {
          logger.error("inbound-scan: apology reply Resend rejected", {
            error: sendResult.error.message,
            sender: sender.email,
          });
        }
      } catch (apologyErr) {
        logger.error("inbound-scan: apology reply threw", {
          error:
            apologyErr instanceof Error
              ? apologyErr.message
              : String(apologyErr),
          sender: sender.email,
        });
      }
    }
    // Record the analysis failure in cost_telemetry so the admin /costs
    // dashboard surfaces the spike — operators get an early signal
    // before customers complain.
    logCost({
      feature: "inbound_scan",
      provider: "channel",
      operation: "email_forward_failed",
      units: 1,
      estimatedCostUsd: 0,
      metadata: {
        verdict: "ERROR",
        sender_domain: sender.email.split("@")[1] ?? "",
        external_id: payload.external_id,
        apology_sent: apologySent,
        error: errMsg.slice(0, 200),
      },
    });
    // 200 so the Worker doesn't retry / quarantine. The user already
    // received the apology and we have a telemetry breadcrumb.
    return NextResponse.json({
      ok: true,
      replySent: apologySent,
      reason: "analysis_failed_apology",
    });
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

  let replySent = false;
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
      // Resend's error shape is documented but the body sometimes
      // carries extra context (e.g. domain unverified, IP suppressed).
      // Capture everything we can so the operator doesn't have to log
      // into Resend's dashboard to diagnose.
      logger.error("inbound-scan: Resend rejected", {
        error: sendResult.error.message,
        name: sendResult.error.name,
        sender_domain: sender.email.split("@")[1] ?? "",
        from: fromEmail,
      });
    } else {
      replySent = true;
      logger.info("inbound-scan: Resend accepted", {
        message_id: sendResult.data?.id ?? "(no-id)",
        sender_domain: sender.email.split("@")[1] ?? "",
      });
    }
  } catch (err) {
    logger.error("inbound-scan: Resend threw", {
      error: err instanceof Error ? err.message : String(err),
      sender_domain: sender.email.split("@")[1] ?? "",
      from: fromEmail,
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

  logger.info("inbound-scan: outcome", {
    verdict,
    reply_sent: replySent,
    sender_domain: sender.email.split("@")[1] ?? "",
    external_id: payload.external_id,
    duration_ms: Date.now() - startedAt,
  });

  return NextResponse.json({ ok: true, replySent, verdict });
}
