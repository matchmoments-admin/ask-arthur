// Pure private / loopback / metadata IP classifier — the single source of
// truth shared by both SSRF defences:
//   - ssrf-dispatcher.ts  (IP layer: validates DNS-resolved addresses)
//   - safebrowsing.isPrivateURL (syntactic layer: validates URL hostnames)
//
// Extracted so the two near-duplicate blocklists can't drift apart (the
// /ultracode SSRF finding). Deliberately has NO undici / node:net imports, so
// it's safe to pull into any module — unlike ssrf-dispatcher, which
// instantiates an undici Agent at import time.

const IPV4_PRIVATE_PATTERNS: RegExp[] = [
  /^127\./, //                                   loopback
  /^10\./, //                                    RFC1918 class A
  /^172\.(1[6-9]|2\d|3[01])\./, //               RFC1918 class B
  /^192\.168\./, //                              RFC1918 class C
  /^169\.254\./, //                              link-local (incl AWS / GCP metadata)
  /^0\./, //                                     current network
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // shared / CGNAT
  /^198\.1[89]\./, //                            benchmarking
  /^192\.0\.0\./, //                             IETF protocol assignments
  /^(22[4-9]|23\d)\./, //                        multicast 224/4
  /^(24\d|25[0-5])\./, //                        reserved 240/4 + broadcast
];

// Only ever tested against strings containing ":" (see isPrivateIP), so a
// HOSTNAME passed in by isPrivateURL — "fdic.gov", "ffmpeg.org" — never matches.
const IPV6_PRIVATE_PATTERNS: RegExp[] = [
  /^::1$/i, //                                   loopback
  /^::$/, //                                     unspecified
  /^fc/i, //                                     unique local (fc00::/7)
  /^fd/i, //                                     unique local (fd00::/8)
  /^fe[89ab]/i, //                               link-local (fe80::/10)
  /^ff/i, //                                     multicast (ff00::/8)
];

export const PRIVATE_IP_PATTERNS: RegExp[] = [
  ...IPV4_PRIVATE_PATTERNS,
  ...IPV6_PRIVATE_PATTERNS,
];

/**
 * True when `address` is a private / loopback / metadata IPv4 or IPv6 literal.
 * Accepts bracketed IPv6 (`[::1]`) and IPv4-mapped IPv6 (`::ffff:a.b.c.d` and
 * the hex form `::ffff:aabb:ccdd`), decoding the embedded IPv4 and re-checking.
 */
export function isPrivateIP(address: string): boolean {
  const addr = address
    .trim()
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "");

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

  // Forms that embed an IPv4 address: NAT64 (64:ff9b::/96), 6to4
  // (2002:AABB:CCDD::/48) and deprecated IPv4-compatible (::a.b.c.d /
  // ::aabb:ccdd). Decode and re-check the embedded IPv4.
  const embedded = embeddedIPv4(addr);
  if (embedded) return isPrivateIP(embedded);

  const patterns = addr.includes(":") ? IPV6_PRIVATE_PATTERNS : IPV4_PRIVATE_PATTERNS;
  return patterns.some((re) => re.test(addr));
}

function hexPairToDotted(h1: string, h2: string): string {
  const a = parseInt(h1, 16);
  const b = parseInt(h2, 16);
  return `${(a >> 8) & 255}.${a & 255}.${(b >> 8) & 255}.${b & 255}`;
}

function embeddedIPv4(addr: string): string | null {
  let m = addr.match(/^64:ff9b::(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (m) return m[1]!;
  m = addr.match(/^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (m) return hexPairToDotted(m[1]!, m[2]!);
  m = addr.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})(?::|$)/i);
  if (m) return hexPairToDotted(m[1]!, m[2]!);
  m = addr.match(/^::(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (m) return m[1]!;
  m = addr.match(/^::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (m) return hexPairToDotted(m[1]!, m[2]!);
  return null;
}
