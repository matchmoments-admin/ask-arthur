// Phone-number detection for the extension's right-click flow.
//
// Mirrors packages/scam-engine/src/phone-normalize.ts patterns but lives
// here standalone to keep the extension bundle small (no engine dep).
// Inputs come from arbitrary user-selected text so we tolerate spaces,
// dots, dashes, parens, and the common AU prefixes.
//
// Scope: AU-first. International E.164 supported as a fallback. Short
// codes (13/1300/1800) are deliberately excluded — they don't have an
// E.164 form and Phone Footprint can't lookup them.

const PATTERNS: RegExp[] = [
  /\+\d{10,15}/, // International E.164
  /\b0[45]\d{2}[\s.-]?\d{3}[\s.-]?\d{3}\b/, // AU mobile: 04xx/05xx
  /\b\(?0[2378]\)?[\s.-]?\d{4}[\s.-]?\d{4}\b/, // AU landline: 02/03/07/08
];

/**
 * Try to extract a single AU/E.164 phone number from a selection.
 * Returns the normalized E.164 form, or null if none found.
 *
 * "Single" — for selections containing multiple numbers we take the
 * first match. The user can re-select if they meant a different one.
 */
export function detectPhoneInSelection(text: string): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return null;

  for (const pattern of PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      return normalizeAuOrE164(match[0]);
    }
  }
  return null;
}

function normalizeAuOrE164(raw: string): string | null {
  const hasPlus = raw.trimStart().startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8) return null;

  if (hasPlus && digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  if (/^0[45]\d{8}$/.test(digits)) return `+61${digits.slice(1)}`;
  if (/^0[2378]\d{8}$/.test(digits)) return `+61${digits.slice(1)}`;
  if (/^61[2-578]\d{8}$/.test(digits)) return `+${digits}`;
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  return null;
}
