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

/**
 * Extract phone numbers and email addresses from raw text.
 * Used to populate scammerContacts from the original (unscrubbed) text,
 * since PII scrubbing runs before Claude sees the message.
 */
export function extractContactsFromText(text: string): {
  phoneNumbers: Array<{ value: string; context: string }>;
  emailAddresses: Array<{ value: string; context: string }>;
} {
  const phoneNumbers: Array<{ value: string; context: string }> = [];
  const emailAddresses: Array<{ value: string; context: string }> = [];
  const seenPhones = new Set<string>();
  const seenEmails = new Set<string>();

  // Extract phone numbers (AU patterns + international)
  const phonePatterns = [
    /\+\d{10,15}/g,
    /\b0[45]\d{2}[\s.-]?\d{3}[\s.-]?\d{3}\b/g,
    /\b\(?0[2378]\)?[\s.-]?\d{4}[\s.-]?\d{4}\b/g,
  ];

  for (const pattern of phonePatterns) {
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(text)) !== null) {
      const normalized = normalizePhoneE164(match[0]);
      if (normalized && !seenPhones.has(normalized)) {
        seenPhones.add(normalized);
        phoneNumbers.push({ value: match[0].trim(), context: "extracted from message" });
      }
    }
  }

  // Extract email addresses
  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  let emailMatch;
  while ((emailMatch = emailPattern.exec(text)) !== null) {
    const email = emailMatch[0].toLowerCase();
    if (!seenEmails.has(email)) {
      seenEmails.add(email);
      emailAddresses.push({ value: emailMatch[0], context: "extracted from message" });
    }
  }

  return {
    phoneNumbers: phoneNumbers.slice(0, 5),
    emailAddresses: emailAddresses.slice(0, 5),
  };
}
