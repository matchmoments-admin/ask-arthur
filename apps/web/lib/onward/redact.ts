/**
 * PII redaction for outbound onward-reporting email bodies. Conservative —
 * we'd rather over-redact a brand abuse email than send a customer's email
 * address or BSB to a third party who didn't ask for it.
 *
 * Patterns are deliberately broad. False positives (replacing a tracking
 * code that looks like a phone number) cost us nothing; false negatives
 * cost us the brand relationship.
 */

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const AU_PHONE_RE = /(?:\+?61\s?|0)[2-478](?:[\s-]?\d){8}/g;
const BSB_RE = /\b\d{3}[\s-]?\d{3}\b/g;
// Match 6-12 digit account numbers (BSB + acct combos), but only when they
// appear in obvious banking context. We don't want to redact phone numbers
// that lack '+' / '0' prefixes (already covered by AU_PHONE_RE) or random
// reference strings.
const ACCOUNT_NEAR_KEYWORD_RE =
  /(?<=\b(?:account|acct|a\/c|ref(?:erence)?|tfn|mygov|medicare)[^\d]{0,12})\d{6,12}\b/gi;
const NAME_PREFIX_RE = /\b(?:Mr|Mrs|Ms|Mx|Dr|Prof)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/g;

const REDACTED = "[redacted]";

export function redactPII(content: string | null | undefined): string {
  if (!content) return "";
  return content
    .replace(EMAIL_RE, REDACTED)
    .replace(AU_PHONE_RE, REDACTED)
    .replace(ACCOUNT_NEAR_KEYWORD_RE, REDACTED)
    .replace(BSB_RE, REDACTED)
    .replace(NAME_PREFIX_RE, REDACTED);
}
