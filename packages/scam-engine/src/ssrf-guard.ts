// SSRF protection — validates URLs before any outbound fetch.
// Blocks private IP ranges, cloud metadata endpoints, and non-HTTP schemes.

const BLOCKED_RANGES = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./, // AWS/GCP metadata
  /^100\.64\./,  // CGNAT
  /^0\./,        // Current network
  /^::1$/,       // IPv6 loopback
  /^fc00:/i,     // IPv6 private
  /^fe80:/i,     // IPv6 link-local
  /^fd/i,        // IPv6 unique local
];

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
  "169.254.169.254",
  "[::1]",
]);

/**
 * Validates a URL is safe for outbound fetch.
 * Throws if the URL targets private infrastructure or uses blocked schemes.
 */
export function assertSafeURL(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }

  // Block non-http(s) schemes
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Blocked scheme: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block known bad hostnames
  if (BLOCKED_HOSTS.has(hostname)) {
    throw new Error(`Blocked host: ${hostname}`);
  }

  // Block IP-based URLs that resolve to private ranges
  for (const re of BLOCKED_RANGES) {
    if (re.test(hostname)) {
      throw new Error(`Blocked IP range: ${hostname}`);
    }
  }

  // Block alternative IP notations (decimal, hex, octal)
  // e.g., http://2130706433 (= 127.0.0.1 in decimal)
  if (/^\d+$/.test(hostname)) {
    throw new Error("Blocked: numeric IP notation");
  }
  if (/^0x[0-9a-f]+$/i.test(hostname)) {
    throw new Error("Blocked: hex IP notation");
  }
}

/**
 * Filter a list of URLs, silently dropping unsafe ones.
 * Safe for use before passing URLs to Safe Browsing, Twilio, etc.
 */
export function filterSafeURLs(urls: string[]): string[] {
  return urls.filter((url) => {
    try {
      assertSafeURL(url);
      return true;
    } catch {
      return false;
    }
  });
}
