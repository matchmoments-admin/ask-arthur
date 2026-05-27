import crypto from "crypto";

import { readStringEnv } from "@askarthur/utils/env";
import type { AnalysisResult } from "@askarthur/types";

// Vote token shape. Encoded as URL query params + a short HMAC tag — same
// pattern as lib/unsubscribe.ts. Verdict + externalId + vote + expiry are
// all bound to the signature so a copy/paste between two emails can't
// land a vote on the wrong analysis.

export type FeedbackVote = "up" | "down";

const VOTES = new Set<FeedbackVote>(["up", "down"]);

// 7 days. Long enough that users finishing their inbox over the weekend
// still land their vote, short enough that a leaked token can't sit in a
// log forever.
const EXPIRY_SECONDS = 7 * 24 * 60 * 60;

function getSecret(): string {
  // Trimmed reads via readStringEnv defeat trailing-whitespace HMAC drift —
  // see packages/utils/src/env.ts.
  const secret =
    readStringEnv("INBOUND_SCAN_FEEDBACK_SECRET") ||
    readStringEnv("UNSUBSCRIBE_SECRET") ||
    readStringEnv("ADMIN_SECRET");
  if (!secret) {
    throw new Error(
      "INBOUND_SCAN_FEEDBACK_SECRET / UNSUBSCRIBE_SECRET / ADMIN_SECRET not configured",
    );
  }
  return secret;
}

function payloadString(
  externalId: string,
  verdict: AnalysisResult["verdict"],
  vote: FeedbackVote,
  exp: number,
): string {
  return `${externalId}|${verdict}|${vote}|${exp}`;
}

function sign(payload: string): string {
  return crypto
    .createHmac("sha256", getSecret())
    .update(payload)
    .digest("hex")
    .slice(0, 32);
}

export interface SignedFeedbackUrl {
  url: string;
  exp: number;
}

export function buildFeedbackUrl(opts: {
  baseUrl: string;
  externalId: string;
  verdict: AnalysisResult["verdict"];
  vote: FeedbackVote;
  expSeconds?: number;
}): SignedFeedbackUrl {
  const exp =
    Math.floor(Date.now() / 1000) + (opts.expSeconds ?? EXPIRY_SECONDS);
  const sig = sign(payloadString(opts.externalId, opts.verdict, opts.vote, exp));
  const params = new URLSearchParams({
    id: opts.externalId,
    v: opts.verdict,
    vote: opts.vote,
    exp: String(exp),
    sig,
  });
  const base = opts.baseUrl.replace(/\/$/, "");
  return { url: `${base}/feedback?${params.toString()}`, exp };
}

export interface VerifiedFeedback {
  externalId: string;
  verdict: AnalysisResult["verdict"];
  vote: FeedbackVote;
}

const VERDICTS = new Set<AnalysisResult["verdict"]>([
  "SAFE",
  "SUSPICIOUS",
  "HIGH_RISK",
  "UNCERTAIN",
]);

export function verifyFeedbackToken(
  searchParams: URLSearchParams,
): VerifiedFeedback | null {
  const externalId = searchParams.get("id") ?? "";
  const verdict = (searchParams.get("v") ?? "") as AnalysisResult["verdict"];
  const vote = (searchParams.get("vote") ?? "") as FeedbackVote;
  const expRaw = searchParams.get("exp") ?? "";
  const sig = searchParams.get("sig") ?? "";

  if (!externalId || externalId.length > 128) return null;
  if (!VERDICTS.has(verdict)) return null;
  if (!VOTES.has(vote)) return null;
  if (!/^[0-9]{10}$/.test(expRaw)) return null;
  if (!/^[a-f0-9]{32}$/.test(sig)) return null;

  const exp = Number.parseInt(expRaw, 10);
  if (!Number.isFinite(exp)) return null;
  if (Math.floor(Date.now() / 1000) > exp) return null;

  const expected = sign(payloadString(externalId, verdict, vote, exp));
  let match = false;
  try {
    match = crypto.timingSafeEqual(
      Buffer.from(sig, "hex"),
      Buffer.from(expected, "hex"),
    );
  } catch {
    return null;
  }
  if (!match) return null;

  return { externalId, verdict, vote };
}

/**
 * Map (verdictGiven, vote) → verdict_feedback.user_says.
 *
 * The web `ResultFeedback` component uses the same logic: thumbs-up
 * always means the verdict was correct; thumbs-down means the verdict
 * was wrong in whichever direction the verdict was pointed.
 *
 *   SAFE       + down → false_negative (we missed a scam)
 *   non-SAFE   + down → false_positive (we flagged something benign)
 */
export function deriveUserSays(
  verdict: AnalysisResult["verdict"],
  vote: FeedbackVote,
): "correct" | "false_positive" | "false_negative" {
  if (vote === "up") return "correct";
  return verdict === "SAFE" ? "false_negative" : "false_positive";
}
