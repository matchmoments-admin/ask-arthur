// Pure private / loopback / metadata IP classifier — the single source of
// truth shared by both SSRF defences:
//   - ssrf-dispatcher.ts  (IP layer: validates DNS-resolved addresses)
//   - safebrowsing.isPrivateURL (syntactic layer: validates URL hostnames)
//
// Extracted so the two near-duplicate blocklists can't drift apart (the
// /ultracode SSRF finding). Deliberately has NO undici / node:net imports, so
// it's safe to pull into any module — unlike ssrf-dispatcher, which
// instantiates an undici Agent at import time.

export const PRIVATE_IP_PATTERNS: RegExp[] = [
  // IPv4
  /^127\./, //                                   loopback
  /^10\./, //                                    RFC1918 class A
  /^172\.(1[6-9]|2\d|3[01])\./, //               RFC1918 class B
  /^192\.168\./, //                              RFC1918 class C
  /^169\.254\./, //                              link-local (incl AWS / GCP metadata)
  /^0\./, //                                     current network
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // shared / CGNAT
  /^198\.1[89]\./, //                            benchmarking
  // IPv6
  /^::1$/i, //                                   loopback
  /^::$/, //                                     unspecified
  /^fc/i, //                                     unique local (fc00::/7)
  /^fd/i, //                                     unique local (fd00::/8)
  /^fe[89ab]/i, //                               link-local (fe80::/10)
];

/**
 * True when `address` is a private / loopback / metadata IPv4 or IPv6 literal.
 * Accepts bracketed IPv6 (`[::1]`) and IPv4-mapped IPv6 (`::ffff:a.b.c.d` and
 * the hex form `::ffff:aabb:ccdd`), decoding the embedded IPv4 and re-checking.
 */
export function isPrivateIP(address: string): boolean {
  const addr = address.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");

  // IPv4-mapped IPv6 — decode the embedded IPv4 and re-test against the IPv4
  // ranges (::ffff:169.254.169.254 and ::ffff:a9fe:a9fe both → 169.254.169.254).
  const mapped = addr.match(/^::ffff:(.+)$/i);
  if (mapped) {
    const inner = mapped[1]!;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(inner)) return isPrivateIP(inner);
    const hex = inner.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (hex) {
      const h1 = parseInt(hex[1]!, 16);
      const h2 = parseInt(hex[2]!, 16);
      const dotted = `${(h1 >> 8) & 255}.${h1 & 255}.${(h2 >> 8) & 255}.${h2 & 255}`;
      return isPrivateIP(dotted);
    }
    return true; // unrecognised mapped form → block defensively
  }

  return PRIVATE_IP_PATTERNS.some((re) => re.test(addr));
}
