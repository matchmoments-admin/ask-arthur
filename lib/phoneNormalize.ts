// Lightweight E.164 phone normalization and email normalization.
// Reuses Australian phone patterns from twilioLookup.ts without
// adding a libphonenumber-js dependency.

/**
 * Normalize a raw phone number to E.164 format.
 * Supports Australian numbers (mobile, landline) and international E.164.
 * Returns null if the number can't be normalized.
 */
export function normalizePhoneE164(raw: string): string | null {
  // Strip whitespace, dots, dashes, parens
  const cleaned = raw.replace(/[\s.\-()]/g, "");

  // Already valid E.164 (international)
  if (/^\+\d{10,15}$/.test(cleaned)) return cleaned;

  // AU mobile: 04xx or 05xx (10 digits)
  if (/^0[45]\d{8}$/.test(cleaned)) return `+61${cleaned.slice(1)}`;

  // AU landline: 02, 03, 07, 08 (10 digits)
  if (/^0[2378]\d{8}$/.test(cleaned)) return `+61${cleaned.slice(1)}`;

  // AU with country code but no +
  if (/^61[2-578]\d{8}$/.test(cleaned)) return `+${cleaned}`;

  // 13/1300/1800 — short codes, not E.164 compatible
  if (/^1[38]\d{4,8}$/.test(cleaned)) return null;

  return null;
}

/**
 * Normalize an email address: lowercase, trim whitespace.
 * Returns the normalized email.
 */
export function normalizeEmail(raw: string): string {
  return raw.toLowerCase().trim();
}

/**
 * Extract the domain from a normalized email address.
 */
export function extractEmailDomain(email: string): string | null {
  const atIndex = email.indexOf("@");
  if (atIndex === -1) return null;
  return email.slice(atIndex + 1);
}

/**
 * Basic format validation for phone numbers.
 * Checks that it looks like a plausible phone number after normalization.
 */
export function isValidPhoneFormat(raw: string): boolean {
  return normalizePhoneE164(raw) !== null;
}

/**
 * Basic format validation for email addresses.
 */
export function isValidEmailFormat(raw: string): boolean {
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(raw.trim());
}
