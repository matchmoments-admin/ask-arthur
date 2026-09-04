/**
 * Arthur's Take — write-time validator and suppression rules.
 *
 * Every string this passes is rendered on a public, indexable page beside a
 * link to someone's Reddit post. Two failure modes matter more than the model
 * being wrong about the scam type:
 *
 *   1. Identifying detail leaking through. The classifier's existing prompt
 *      permits amounts ("Only reference numbers explicitly stated in the
 *      post") and the sampled output uses them — "requires a model to pay $95
 *      upfront". In a private intel row that is useful; on a public page next
 *      to a permalink it narrows the poster down.
 *   2. Reading as an accusation. The subject is a pattern, never the person
 *      who posted. "You were scammed" is the wrong register for someone who
 *      just lost money, and it is a claim about a real person we cannot make.
 *
 * This module is the enforcement point, deliberately separate from the prompt:
 * a prompt instruction is a request, and the thing standing between a bad
 * generation and a published page has to be code. It is pure and synchronous
 * so the rules are unit-testable without a model call.
 */

/** The 15-value taxonomy — see migration-v82-reddit-intel-base.sql:41-47. */
export type IntentLabel =
  | "phishing"
  | "romance_scam"
  | "investment_fraud"
  | "tech_support"
  | "impersonation"
  | "shopping_scam"
  | "phone_scam"
  | "email_scam"
  | "sms_scam"
  | "employment_scam"
  | "advance_fee"
  | "rental_scam"
  | "sextortion"
  | "informational"
  | "other";

export interface TakeCandidate {
  tells: string[];
  where: string | null;
  auLine: string | null;
  isScamReport: boolean;
}

export interface TakeContext {
  intentLabel: IntentLabel;
  /** Classifier confidence, 0-1. */
  confidence: number;
  /** Length of the source excerpt, used for the too-thin-to-analyse rule. */
  sourceLength: number;
}

export type SuppressionReason =
  | "contains_amount"
  | "contains_email"
  | "contains_phone"
  | "contains_handle"
  | "second_person_accusation"
  | "low_confidence"
  | "vague_low_confidence"
  | "source_too_short"
  | "not_a_scam_report_uncertain"
  | "empty_take";

export type TakeValidation =
  | { status: "ready"; reason: null }
  | { status: "suppressed"; reason: SuppressionReason };

/**
 * Below this the classifier's own label is a guess, so a confident-sounding
 * paragraph built on it is worse than showing nothing. Matches the threshold
 * the brief proposed and sits above the 138 prod rows under 0.5.
 */
const MIN_CONFIDENCE = 0.5;

/**
 * `other` is the model's shrug. Combined with mediocre confidence it produces
 * takes that restate the post without adding a pattern, which is the "AI slop"
 * risk the brief flags (R10).
 */
const MIN_CONFIDENCE_FOR_VAGUE_LABEL = 0.7;

/**
 * A post shorter than this is usually a title plus a link. There is no
 * narrative to find a pattern in.
 */
const MIN_SOURCE_LENGTH = 200;

/**
 * Saying "this does not look like a scam report" is a claim, so it needs the
 * same evidential bar as saying it is one.
 */
const MIN_CONFIDENCE_FOR_NOT_A_SCAM = 0.7;

// ── Content patterns ──────────────────────────────────────────────────────

/**
 * Currency amounts. Deliberately broad: a bare "$95" and a written "95 USD"
 * are equally identifying. Ordinary numbers (a year, "2 weeks") are NOT
 * matched — over-suppressing costs a take, but stripping every digit would
 * make the tells useless.
 */
const AMOUNT_RE =
  /(?:[$£€¥₹]\s?\d|(?:\b|\d)(?:AUD|USD|GBP|EUR|NZD|CAD|BTC|ETH|USDT)\b|\b\d[\d,]*(?:\.\d+)?\s?(?:dollars?|pounds?|euros?|k\b))/i;

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;

/**
 * Phone-ish runs of digits. Requires 7+ digits with optional separators so a
 * year or a small count does not trip it.
 */
const PHONE_RE = /(?:\+?\d[\d\s().-]{6,}\d)/;

/** Reddit and social handles. */
const HANDLE_RE = /(?:^|[\s(])(?:\/?u\/|@)[A-Za-z0-9_-]{2,}/;

/**
 * Second-person constructions that address the reader as the victim. The take
 * describes a pattern to a bystander; "you" turns it into a verdict on the
 * person whose post is linked directly beside it.
 */
const ACCUSATION_RE =
  /\byou(?:'ve| have| were| was| got|r)?\s+(?:been\s+)?(?:scammed|conned|defrauded|duped|tricked|fell|fallen|lost|paid|sent)\b|\byou\s+should\s+have\b|\byour\s+mistake\b/i;

interface Rule {
  reason: SuppressionReason;
  test: (text: string) => boolean;
}

const CONTENT_RULES: Rule[] = [
  { reason: "contains_email", test: (t) => EMAIL_RE.test(t) },
  { reason: "contains_handle", test: (t) => HANDLE_RE.test(t) },
  { reason: "contains_amount", test: (t) => AMOUNT_RE.test(t) },
  { reason: "contains_phone", test: (t) => PHONE_RE.test(t) },
  { reason: "second_person_accusation", test: (t) => ACCUSATION_RE.test(t) },
];

/**
 * Which content rule, if any, a single string breaks. Exported so the admin
 * review queue can explain a suppression rather than just reporting one.
 */
export function findContentViolation(text: string): SuppressionReason | null {
  for (const rule of CONTENT_RULES) {
    if (rule.test(text)) return rule.reason;
  }
  return null;
}

/**
 * Decide whether a generated take may be shown.
 *
 * Order matters: content violations are checked before the confidence rules so
 * that a leak is always reported as a leak. A take suppressed for low
 * confidence that ALSO contained a phone number would otherwise look like a
 * calibration problem in the review queue, and the validator's real miss rate
 * — the number the PII gate at Gate 3 turns on — would read as zero.
 */
export function validateTake(
  candidate: TakeCandidate,
  ctx: TakeContext,
): TakeValidation {
  const strings = [
    ...candidate.tells,
    candidate.where ?? "",
    candidate.auLine ?? "",
  ].filter((s) => s.trim().length > 0);

  for (const text of strings) {
    const violation = findContentViolation(text);
    if (violation) return { status: "suppressed", reason: violation };
  }

  if (candidate.tells.length === 0 && !candidate.where) {
    return { status: "suppressed", reason: "empty_take" };
  }

  if (ctx.sourceLength < MIN_SOURCE_LENGTH) {
    return { status: "suppressed", reason: "source_too_short" };
  }

  if (ctx.confidence < MIN_CONFIDENCE) {
    return { status: "suppressed", reason: "low_confidence" };
  }

  if (
    ctx.intentLabel === "other" &&
    ctx.confidence < MIN_CONFIDENCE_FOR_VAGUE_LABEL
  ) {
    return { status: "suppressed", reason: "vague_low_confidence" };
  }

  if (
    !candidate.isScamReport &&
    ctx.confidence < MIN_CONFIDENCE_FOR_NOT_A_SCAM
  ) {
    return { status: "suppressed", reason: "not_a_scam_report_uncertain" };
  }

  return { status: "ready", reason: null };
}

/** Reader-facing explanation of a suppression, for the admin queue. */
export const SUPPRESSION_LABELS: Record<SuppressionReason, string> = {
  contains_amount: "Take referenced a monetary amount from the post",
  contains_email: "Take contained an email address",
  contains_phone: "Take contained a phone-like number",
  contains_handle: "Take contained a username or handle",
  second_person_accusation: "Take addressed the reader as the victim",
  low_confidence: "Classifier confidence below the display threshold",
  vague_low_confidence: "Label was 'other' without confidence to back it",
  source_too_short: "Source post too short to carry a pattern",
  not_a_scam_report_uncertain:
    "Model read this as not-a-scam but was not confident enough to say so",
  empty_take: "Model returned no usable tells",
};
