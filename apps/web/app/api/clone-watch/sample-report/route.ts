import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { render } from "@react-email/components";
import { Resend } from "resend";
import { checkFormRateLimit } from "@askarthur/utils/rate-limit";
import { readStringEnv } from "@askarthur/utils/env";
import { logger } from "@askarthur/utils/logger";
import { logCost, PRICING } from "@/lib/cost-telemetry";
import { verifyTurnstileToken } from "@/app/api/extension/_lib/turnstile";
import CloneWatchBrandAlert, {
  type CloneWatchCandidate,
} from "@/emails/CloneWatchBrandAlert";

// Public "email me a sample clone-watch report" endpoint. Lets a prospective
// brand / partner see exactly what an Ask Arthur clone-watch alert looks like
// and the evidence it carries, without any account.
//
// Cost: $0 beyond existing infra — reuses Resend (already the transactional
// provider) + Upstash form rate-limit. One sample email is ~$0.0004 (logged to
// cost_telemetry as `clone_watch_sample_report`), and the per-IP form limiter
// (5/hour) bounds volume. It only ever emails the address the caller typed,
// and the content is clearly marked [SAMPLE] for a fictional brand, so it is
// not a useful spam/phishing vector. (Turnstile would be a future hardening
// step but isn't wired in the app today.)

export const runtime = "nodejs";

const BodySchema = z.object({
  email: z.string().email().max(320),
  turnstileToken: z.string().min(1).max(4096),
});

// Representative, clearly-fictional sample data — exercises every field the
// real CloneWatchBrandAlert renders (signal, AI score, evidence, urlscan link).
const SAMPLE_BRAND = "Coastline Bank";
const SAMPLE_LEGIT_DOMAIN = "coastlinebank.com.au";
const SAMPLE_CANDIDATES: CloneWatchCandidate[] = [
  {
    candidateDomain: "coastlinebank-secure.com",
    candidateUrl: "https://coastlinebank-secure.com/login",
    signalType: "levenshtein",
    score: 0.92,
    firstSeenAt: "2026-06-27T08:31:00.000Z",
    evidenceSummary:
      "Login page mirrors the Coastline Bank sign-in form; hosted on a bulletproof VPS in RU. Registered 2 days ago via a privacy-proxy registrar.",
    netcraftSubmissionId: "SAMPLE-NC-4821",
    urlscanResultUrl: "https://urlscan.io/",
  },
  {
    candidateDomain: "coast1inebank.com.au",
    candidateUrl: "https://coast1inebank.com.au/",
    signalType: "confusable",
    score: 0.88,
    firstSeenAt: "2026-06-26T22:14:00.000Z",
    evidenceSummary:
      "Digit-for-letter look-alike ('1' for 'l'). Parked for now; flagged for re-scan on the daily sweep.",
    urlscanResultUrl: "https://urlscan.io/",
  },
];

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);

  // Abuse guard: per-IP form rate limit (5/hour) on existing Upstash.
  const rl = await checkFormRateLimit(ip);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: rl.message },
      { status: 429 },
    );
  }

  let email: string;
  let turnstileToken: string;
  try {
    const body = BodySchema.parse(await req.json());
    email = body.email;
    turnstileToken = body.turnstileToken;
  } catch {
    return NextResponse.json(
      { error: "invalid_email", message: "Enter a valid email address." },
      { status: 400 },
    );
  }

  // Bot guard: Cloudflare Turnstile (free, already provisioned).
  const turnstile = await verifyTurnstileToken(turnstileToken, ip);
  if (!turnstile.success) {
    return NextResponse.json(
      { error: "turnstile_failed", message: "Verification failed — please retry." },
      { status: 403 },
    );
  }

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = readStringEnv("RESEND_FROM_EMAIL");
  if (!apiKey || !fromEmail) {
    logger.error("clone-watch sample-report: RESEND env unset", {
      hasKey: Boolean(apiKey),
      hasFrom: Boolean(fromEmail),
    });
    return NextResponse.json(
      { error: "email_unavailable", message: "Sample email is temporarily unavailable." },
      { status: 503 },
    );
  }

  const html = await render(
    CloneWatchBrandAlert({
      brandName: `${SAMPLE_BRAND} (sample)`,
      legitimateDomain: SAMPLE_LEGIT_DOMAIN,
      candidates: SAMPLE_CANDIDATES,
      reportRef: "SAMPLE",
    }),
  );

  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from: fromEmail,
      to: [email],
      subject: "[SAMPLE] How an Ask Arthur clone-watch alert looks",
      html,
    });
    if (result.error) {
      logger.error("clone-watch sample-report: Resend rejected", {
        error: result.error.message ?? String(result.error),
      });
      return NextResponse.json(
        { error: "send_failed", message: "Couldn't send right now — try again shortly." },
        { status: 502 },
      );
    }
  } catch (err) {
    logger.error("clone-watch sample-report: send threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "send_failed", message: "Couldn't send right now — try again shortly." },
      { status: 502 },
    );
  }

  logCost({
    feature: "clone_watch_sample_report",
    provider: "resend",
    operation: "sample_email",
    units: 1,
    unitCostUsd: PRICING.RESEND_USD_PER_EMAIL,
    metadata: { surface: "public" },
  });

  return NextResponse.json({ ok: true });
}
