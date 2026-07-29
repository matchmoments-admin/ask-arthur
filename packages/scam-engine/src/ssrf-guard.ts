// SSRF protection — validates URLs before any outbound fetch.
// Blocks private IP ranges, cloud metadata endpoints, and non-HTTP schemes.
//
// IP classification is delegated to `./private-ip`, the single source of truth
// shared with `ssrf-dispatcher` and `safebrowsing.isPrivateURL`.
//
// SECURITY (2026-07-29): this module previously carried its OWN copy of the
// range list, and that copy was dead for every IPv6 form. `URL.hostname`
// returns IPv6 literals *bracketed* (`[::1]`, `[::ffff:169.254.169.254]`), so
// the unbracketed `/^::1$/` and `/^fe80:/` patterns could never match, and the
// IPv4-mapped metadata address passed straight through. `isPrivateIP` strips
// the brackets and decodes IPv4-mapped forms, so delegating to it both fixes
// the bypass and removes the drift risk that caused it.

import { isPrivateIP } from "./private-ip";

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

  // Block IP-literal URLs in private / loopback / metadata ranges. Handles
  // bracketed IPv6 and IPv4-mapped IPv6 — see the header note.
  if (isPrivateIP(hostname)) {
    throw new Error(`Blocked IP range: ${hostname}`);
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
