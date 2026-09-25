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

/**
 * The ONE list of hostnames that are never fetched, whatever they resolve to.
 * `safebrowsing.isPrivateURL` and this module used to keep two lists that had
 * drifted apart (one blocked `instance-data`, the other `metadata.goog` and
 * `[::1]`); both now read this set. IP ranges are NOT listed here — they live in
 * `./private-ip`.
 */
export const BLOCKED_HOSTS: ReadonlySet<string> = new Set([
  "localhost",
  "metadata.google.internal", // GCP metadata
  "metadata.goog", // GCP metadata (alternate)
  "instance-data", // AWS metadata alias
  "169.254.169.254", // AWS/GCP/Azure metadata (also covered by private-ip)
  "[::1]",
]);

export type OutboundUrlCheck =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

/**
 * The syntactic outbound-URL check every guard shares: http(s) only, not a
 * blocked hostname, not a private/reserved IP literal, not an integer/hex/octal
 * IP spelling. Resolution-time checks (a NAME that resolves to a private IP,
 * DNS rebinding) are the `ssrfSafeDispatcher`'s job — `safeFetch` applies both.
 */
export function checkOutboundUrl(rawUrl: string): OutboundUrlCheck {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "Invalid URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: `Blocked scheme: ${parsed.protocol}` };
  }
  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(hostname)) {
    return { ok: false, reason: `Blocked host: ${hostname}` };
  }
  // IP-literal URLs in private / loopback / metadata ranges. Handles bracketed
  // IPv6 and IPv4-mapped IPv6 — see the header note.
  if (isPrivateIP(hostname)) {
    return { ok: false, reason: `Blocked IP range: ${hostname}` };
  }
  // Alternative IP spellings the URL parser may leave alone (decimal, hex, octal).
  if (/^\d+$/.test(hostname)) return { ok: false, reason: "Blocked: numeric IP notation" };
  if (/^0x[0-9a-f]+$/i.test(hostname)) return { ok: false, reason: "Blocked: hex IP notation" };
  if (/^0[0-7]+$/.test(hostname)) return { ok: false, reason: "Blocked: octal IP notation" };
  return { ok: true, url: parsed };
}

/**
 * Validates a URL is safe for outbound fetch.
 * Throws if the URL targets private infrastructure or uses blocked schemes.
 */
export function assertSafeURL(rawUrl: string): void {
  const check = checkOutboundUrl(rawUrl);
  if (!check.ok) throw new Error(check.reason);
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
