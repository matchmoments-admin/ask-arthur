/**
 * One vocabulary for "what kind of scam is this", across streams that each
 * invented their own.
 *
 * THE PROBLEM THIS SOLVES. Four columns carry a scam category and no two of
 * them agree, all as free `text` with no shared source of truth:
 *
 *   reddit_post_intel.intent_label   15 values, 4,337 rows   (INTENT_LABELS)
 *   feed_items.category              14 values, 3,308 rows   (its own CHECK)
 *   scam_reports.scam_type            9 values,    75 rows   (a prompt string)
 *   verified_scams.scam_type          9 values,    84 rows   (the same prompt)
 *
 * They agree on phishing, advance_fee, tech_support, impersonation and other.
 * They SILENTLY disagree on three, which is the dangerous part — a union or a
 * join today under-counts each by exactly the other stream's share, with no
 * error and nothing to notice:
 *
 *   romance          vs  romance_scam
 *   investment       vs  investment_fraud
 *   smishing         vs  sms_scam
 *
 * And seven categories exist only on the Reddit side, so a scam type can be
 * the largest thing in the corpus and invisible to every scam-type surface.
 * shopping_scam has 540 rows and employment_scam 442; neither has any home in
 * the analyze vocabulary.
 *
 * Measured consequence: nothing in the codebase groups by either column —
 * there is no GROUP BY scam_type or GROUP BY intent_label in 300+ migrations —
 * so nobody could see that sextortion rose 44% month on month in data we
 * already hold.
 *
 * READ-SIDE ONLY, following ADR-0020. Every stream keeps writing its own raw
 * label; nothing is rewritten and no migration touches history. Each raw value
 * is the model's contemporaneous judgement and stays the record. This resolves
 * them at read time, which keeps the change reversible.
 *
 * ADR-0020 also carries the warning that matters most here: the canonical
 * brand layer shipped with ZERO code callers and sat inert for months, reading
 * as infrastructure while doing nothing. So this lands with its readers in the
 * same change, not ahead of them.
 */

/**
 * The union of every vocabulary, with the three collisions resolved.
 *
 * The `_scam` suffix is dropped throughout: advance_fee, tech_support and
 * sextortion already had no suffix, so keeping it on the other five would make
 * the set inconsistent with itself.
 */
export const CANONICAL_SCAM_TYPES = [
  "phishing",
  "romance",
  "investment",
  "tech_support",
  "impersonation",
  "shopping",
  "phone",
  "email",
  "sms",
  "employment",
  "advance_fee",
  "rental",
  "sextortion",
  "other",
] as const;

export type CanonicalScamType = (typeof CANONICAL_SCAM_TYPES)[number];

/**
 * Raw value -> canonical type.
 *
 * `null` means "this is not a scam type", and it is a real answer rather than
 * a failure:
 *
 *   informational  a Reddit post that is not a scam report at all (251 rows)
 *   none           the analyze verdict for content that is not a scam (7 rows)
 *
 * Counting either as a scam category would inflate every total with posts we
 * have explicitly judged not to be scams. Callers should drop nulls, not
 * bucket them into `other` — `other` means "a scam we could not categorise",
 * which is a different claim.
 */
const RAW_TO_CANONICAL: Record<string, CanonicalScamType | null> = {
  // agreed across both vocabularies
  phishing: "phishing",
  advance_fee: "advance_fee",
  tech_support: "tech_support",
  impersonation: "impersonation",
  other: "other",

  // the three silent disagreements
  romance: "romance",
  romance_scam: "romance",
  investment: "investment",
  investment_fraud: "investment",
  smishing: "sms",
  sms_scam: "sms",

  // Reddit-only categories
  shopping_scam: "shopping",
  phone_scam: "phone",
  email_scam: "email",
  employment_scam: "employment",
  rental_scam: "rental",
  sextortion: "sextortion",

  // Free-text strays. `scam_type` is `parsed.scamType.slice(0, 100)` in
  // claude.ts — never constrained — so the model's own compounds land in the
  // column. This one is an advance fee dressed as a job; the name says so.
  work_from_home_advance_fee: "advance_fee",

  // not a scam type — see the note above
  informational: null,
  none: null,
};

/**
 * Resolve any stream's raw label to the shared vocabulary.
 *
 * Returns `null` for an unmapped value as well as for the deliberate nulls
 * above. That is intentional: silently bucketing an unknown into `other` would
 * hide a new label the moment someone adds one, which is exactly how the three
 * disagreements went unnoticed. `scamTaxonomy.test.ts` fails the build if a
 * value in either vocabulary has no entry here.
 */
export function toCanonicalScamType(
  raw: string | null | undefined,
): CanonicalScamType | null {
  if (!raw) return null;
  return RAW_TO_CANONICAL[raw.trim().toLowerCase()] ?? null;
}

/** Every raw value this knows about. Exported for the drift test. */
export function knownRawScamTypes(): string[] {
  return Object.keys(RAW_TO_CANONICAL);
}

/**
 * Display names. One home, so `romance` and `romance_scam` can no longer
 * render as two different rows — which they would today, since
 * `CATEGORY_LABELS` in apps/web/lib/dashboard.ts only has the Reddit spellings
 * and title-cases anything else through a fallback.
 */
export const CANONICAL_SCAM_TYPE_LABELS: Record<CanonicalScamType, string> = {
  phishing: "Phishing",
  romance: "Romance / Pig Butchering",
  investment: "Investment / Crypto",
  tech_support: "Tech Support",
  impersonation: "Impersonation",
  shopping: "Shopping",
  phone: "Phone",
  email: "Email",
  sms: "SMS",
  employment: "Employment",
  advance_fee: "Advance Fee",
  rental: "Rental",
  sextortion: "Sextortion",
  other: "Other",
};

export function canonicalScamTypeLabel(t: CanonicalScamType): string {
  return CANONICAL_SCAM_TYPE_LABELS[t];
}
