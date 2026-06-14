// PII scrubbing — a pre-processing / sanitisation step, not storage logic.
//
// Lives in its own module (not pipeline.ts, the persistence layer) because it
// runs on input BEFORE Claude analysis (claude.ts), on cache writes
// (analysis-cache.ts), on report persistence (report-store.ts, pipeline.ts),
// and on cross-package surfaces (persona-check, mediaAnalysis, blogGenerator).
// Co-locating it with the storage writes obscured that it's an input filter and
// made it impossible to unit-test in isolation. See arch review #588 (finding 4).
//
// Defense in depth — Claude is also instructed not to echo PII.

// ORDER MATTERS: More specific patterns (card, Medicare, TFN) must run BEFORE the
// generic phone pattern, which is greedy and would otherwise consume their digits.
const PII_PATTERNS: [RegExp, string][] = [
  // Email with display name: "John Smith <john@example.com>" or "johnsmith <john@example.com>"
  [/[a-zA-Z0-9_.+-]+\s*<[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}>/g, "[EMAIL]"],
  // Name or username before [EMAIL] placeholder (left by prior scrub or partial replacement)
  [/[a-zA-Z0-9_.+-]+\s*<\[EMAIL\]>/g, "[EMAIL]"],
  // Standalone email addresses
  [/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[EMAIL]"],
  // Credit card numbers (must run before generic phone)
  [/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, "[CARD]"],
  // Australian Medicare number (XXXX XXXXX X) (must run before generic phone)
  [/\b\d{4}\s?\d{5}\s?\d\b/g, "[MEDICARE]"],
  // Australian Tax File Number (TFN: XXX XXX XXX) (must run before generic phone)
  [/\b\d{3}\s?\d{3}\s?\d{3}\b/g, "[TFN]"],
  // SSN (must run before generic phone)
  [/\b\d{3}-?\d{2}-?\d{4}\b/g, "[SSN]"],
  // Australian phone numbers (04xx xxx xxx, +614xx xxx xxx) (must run before generic phone)
  [/(\+?61\s?)?0?4\d{2}[\s.-]?\d{3}[\s.-]?\d{3}/g, "[AU_PHONE]"],
  // Australian landline (0x xxxx xxxx) (must run before generic phone)
  [/0[2-9]\s?\d{4}\s?\d{4}/g, "[AU_PHONE]"],
  // Partial card references ("card ending 8279", "account last four 5678")
  [/\b(card|account)\s+(ending|ending in|last four|last 4)\s+\d{4}\b/gi, "[CARD_REF]"],
  // Phone numbers — generic catch-all (runs last among digit patterns)
  [/(\+?1?\s?)?(\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{4}/g, "[PHONE]"],
  // IP addresses
  [/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "[IP]"],
  // Australian BSB (XXX-XXX)
  [/\b\d{3}-\d{3}\b/g, "[BSB]"],
  // Street addresses (basic, AU and US)
  [/\b\d{1,5}\s+[A-Za-z]+\s+(Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Crescent|Cres|Parade|Pde|Terrace|Tce|Highway|Hwy)\b/gi, "[ADDRESS]"],
  // Names after common prefixes (handles all-caps like "Hi ANA", title-case, mixed)
  [/\b(Dear|Hi|Hello|Mr\.?|Mrs\.?|Ms\.?|Dr\.?)\s+[A-Z][a-zA-Z]+(\s+[A-Z][a-zA-Z]+)?\b/g, "[NAME]"],
];

export function scrubPII(text: string): string {
  let scrubbed = text;
  for (const [pattern, replacement] of PII_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, replacement);
  }
  // Post-scrub cleanup: catch any name/username still attached to [EMAIL] placeholders
  // Handles "jacobovers [EMAIL]", "jacobovers<[EMAIL]>", "Spam jacobovers [EMAIL]" etc.
  scrubbed = scrubbed.replace(/\b[a-zA-Z][a-zA-Z0-9_.+-]*\s*(?:<)?\[EMAIL\](?:>)?/g, "[EMAIL]");
  return scrubbed;
}

// Only store last 3 digits + length indicator for privacy.
export function scrubPhoneForStorage(phone: string): string {
  if (phone.length < 4) return "***";
  return "*".repeat(phone.length - 3) + phone.slice(-3);
}
