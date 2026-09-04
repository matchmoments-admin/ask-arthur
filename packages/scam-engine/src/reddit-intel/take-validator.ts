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
 *
 * WHAT THIS CANNOT DO — do not describe it as a PII guarantee anywhere.
 *
 * It is a net with a known mesh size, measured by adversarial tests in
 * take-validator.test.ts. Two classes get through by construction:
 *
 *   1. Personal names. "The scammer went by Sarah Mitchell" is indistinguishable
 *      from ordinary prose to a regular expression. Nothing here will ever
 *      catch it.
 *   2. Bare handles with no sigil. "the handle deals_direct" reads exactly like
 *      a compound noun; matching it would suppress legitimate tells constantly.
 *      Only `@name` and `u/name` forms are caught.
 *
 * The compensating controls for those two are the prompt (which forbids both
 * explicitly) and the admin review queue's `pii` verdict, which flips a live
 * take to suppressed on one click. If a reviewer is ever asked "does the
 * validator guarantee no names?", the answer is no — and Gate 3's PII
 * criterion should be read as "no LEAKS THE VALIDATOR CAN SEE", with the
 * review queue as the instrument for the rest.
 */

export type { IntentLabel } from "@askarthur/types";
import type { IntentLabel } from "@askarthur/types";

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
 * Currency amounts, in four shapes. Adversarial testing of the first version
 * (symbol-or-currency-word only) found it missed the two most likely ways a
 * model actually writes an amount in prose:
 *
 *     "The seller asked for 1500 up front"      — bare number, money context
 *     "They asked for two hundred dollars"      — spelled out
 *
 * Both are as identifying as "$1500", so all four shapes are matched. Ordinary
 * numbers stay legal: "within 24 hours", "roughly 2 weeks", "created in 2026"
 * are the tells' bread and butter and are verified to pass.
 */
const AMOUNT_RE = new RegExp(
  [
    // $95 · £ 250 · ¥50000
    String.raw`[$£€¥₹]\s?\d`,
    // 1,200 USD · AU$2,000 · 0.05 BTC
    String.raw`(?:\b|\d)(?:AUD|USD|GBP|EUR|NZD|CAD|BTC|ETH|USDT)\b`,
    // 500 dollars · 300 euro. A bare "20k" is NOT matched here: "4K TVs",
    // "24k gold", "10k followers" and "401k" are ordinary shopping and
    // investment vocabulary, and suppressing them cost real tells. An amount
    // written as "20k" still gets caught by the money-context branch below
    // ("asked for 20k", "paid 20k").
    String.raw`\b\d[\d,]*(?:\.\d+)?\s?(?:dollars?|pounds?|euros?)`,
    // two hundred dollars · fifty pounds
    String.raw`\b(?:one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)[\w\s-]{0,20}?(?:dollars?|pounds?|euros?)\b`,
    // a bare number in an unambiguous money context, either side of it
    String.raw`\b(?:paid|pay|pays|paying|fee|fees|cost|costs|price|priced|deposit|transfers?|transferred|transferring|sends?|sent|sending|wires?|wired|refunds?|charge[ds]?|worth|owes?|owed|demands?|demanded|requests?|requested|asked\s+for|asks\s+for)\b[^.!?]{0,24}?\b\d[\d,]*(?:\.\d+)?(?:k|m)?\b`,
    String.raw`\b\d[\d,]*(?:\.\d+)?\b[^.!?]{0,16}?\b(?:up\s?front|in\s+advance|upfront|deposit|per\s+month|a\s+month)\b`,
  ].join("|"),
  "i",
);

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;

/**
 * Obfuscated addresses ("billing at fakeshop dot com"). Unlikely from the
 * model, but the source posts are full of them and cheap to refuse.
 */
const OBFUSCATED_EMAIL_RE =
  /\b[\w.+-]+\s+(?:at|\(at\)|\[at\])\s+[\w.-]+\s+(?:dot|\(dot\)|\[dot\])\s+\w{2,}/i;

/**
 * Phone-ish runs of digits.
 *
 * `.` is deliberately NOT a separator here. Including it matched decimal
 * ranges ("1.5 - 2.5 - 3.5 per cent daily returns"), opening hours
 * ("9.00 - 17.00") and dates ("12.03.2026") — all legitimate tell content. The
 * formats that matter (+61 400 123 456, 0400123456, +1 (555) 019-2837) use
 * spaces, brackets and hyphens.
 *
 * The character class alone is not enough either: it counts CHARACTERS, so a
 * short number padded with spaces would pass while a real one might not.
 * `looksLikePhone` therefore also counts digits.
 */
const PHONE_CANDIDATE_RE = /\+?\d[\d\s()-]{5,}\d/;
const MIN_PHONE_DIGITS = 7;

function looksLikePhone(text: string): boolean {
  const m = text.match(PHONE_CANDIDATE_RE);
  if (!m) return false;
  return (m[0].match(/\d/g) ?? []).length >= MIN_PHONE_DIGITS;
}

/**
 * Reddit and social handles. The name must START WITH A LETTER — `@70` in
 * "advertised @70 per cent below retail" is a price, not a handle, and the
 * earlier `[A-Za-z0-9_-]` first character suppressed it.
 *
 * The prefix class accepts a curly quote and a colon as well as whitespace and
 * a bracket: `DMs come from “@cryptoking99”` and `Contact:@deals_direct` both
 * got through the whitespace-only version. `i` is set so `U/Name` is caught.
 */
const HANDLE_RE = /(?:^|[\s(:"'\u2018\u2019\u201c\u201d])(?:\/?u\/|@)[A-Za-z][A-Za-z0-9_-]{1,}/i;

/**
 * Second-person constructions that address the reader as the victim. The take
 * describes a pattern to a bystander; "you" turns it into a verdict on the
 * person whose post is linked directly beside it.
 */
const ACCUSATION_RE = new RegExp(
  [
    // "you were scammed", "you\u2019ve been defrauded", "you may have been
    // conned", "you are being tricked". The apostrophe class matters more than
    // it looks: a model emits U+2019, not ASCII, so the ASCII-only version
    // missed the single most likely phrasing of the rule's whole purpose.
    String.raw`\byou(?:['\u2019]ve|['\u2019]re| have| were| was| got| are| may| might| probably)?\b[^.!?]{0,24}?\b(?:scammed|conned|defrauded|duped|tricked|targeted|fell for|fallen for)\b`,
    String.raw`\byou\s+should\s+have\b`,
    String.raw`\byour\s+mistake\b`,
    String.raw`\byou\s+were\s+the\s+(?:target|victim)\b`,
  ].join("|"),
  "i",
);

interface Rule {
  reason: SuppressionReason;
  test: (text: string) => boolean;
}

const CONTENT_RULES: Rule[] = [
  {
    reason: "contains_email",
    test: (t) => EMAIL_RE.test(t) || OBFUSCATED_EMAIL_RE.test(t),
  },
  { reason: "contains_handle", test: (t) => HANDLE_RE.test(t) },
  { reason: "contains_amount", test: (t) => AMOUNT_RE.test(t) },
  { reason: "contains_phone", test: looksLikePhone },
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

  // Trim before counting: `tells: ["   "]` with a null `where` is not
  // length-zero, and whitespace-only strings are dropped from the content pass
  // above, so the take would have rendered as a heading with nothing under it.
  const renderableTells = candidate.tells.filter((t) => t.trim().length > 0);
  if (renderableTells.length === 0 && !candidate.where?.trim()) {
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
