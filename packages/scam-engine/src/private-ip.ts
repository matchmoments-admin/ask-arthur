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

// IPv6 is classified numerically in isPrivateIPv6 (expanded groups, so every
// compressed spelling is covered); these prefixes remain part of the exported
// PRIVATE_IP_PATTERNS list for callers that match literal strings.
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

  // IPv4 ranges apply ONLY to a real dotted-quad. isPrivateURL passes
  // HOSTNAMES through here, and a name such as "10.example.com" or "250.co"
  // must not read as a private address.
  if (IPV4_RE.test(addr)) {
    return IPV4_PRIVATE_PATTERNS.some((re) => re.test(addr));
  }
  // Not an IP literal at all (a hostname) — nothing to classify.
  if (!addr.includes(":")) return false;

  const g = expandIPv6(addr);
  if (!g) return true; // unparseable IPv6-looking string → block defensively
  return isPrivateIPv6(g);
}

const OCTET = "(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const IPV4_RE = new RegExp(`^${OCTET}(\\.${OCTET}){3}$`);

/** Expand an IPv6 literal (incl. "::" and a trailing dotted IPv4) into its
 *  eight 16-bit groups, or null when it is not a valid IPv6 literal. */
function expandIPv6(addr: string): number[] | null {
  let s = addr.split("%")[0]!; // drop a zone id
  const dotted = s.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    if (!IPV4_RE.test(dotted[2]!)) return null;
    const [a, b, c, d] = dotted[2]!.split(".").map(Number) as [number, number, number, number];
    s = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":"));
  const head = parse(halves[0]!);
  const tail = halves.length === 2 ? parse(halves[1]!) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  const out: number[] = [];
  for (const h of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(h)) return null;
    out.push(parseInt(h, 16));
  }
  return out;
}

const v4 = (hi: number, lo: number) =>
  `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;

function isPrivateIPv6(g: number[]): boolean {
  const zero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);

  if (zero(0, 8)) return true; //                           :: unspecified
  if (zero(0, 7) && g[7] === 1) return true; //              ::1 loopback
  // ::ffff:0:0/96 IPv4-mapped
  if (zero(0, 5) && g[5] === 0xffff) return isPrivateIP(v4(g[6]!, g[7]!));
  // ::/96 IPv4-compatible (deprecated)
  if (zero(0, 6)) return isPrivateIP(v4(g[6]!, g[7]!));
  // 64:ff9b::/96 NAT64 well-known prefix
  if (g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6)) return isPrivateIP(v4(g[6]!, g[7]!));
  // 64:ff9b:1::/48 NAT64 local-use — the embedded IPv4 position is
  // operator-defined, so it cannot be decoded reliably: block.
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return true;
  // 2002::/16 6to4 — IPv4 in groups 1-2
  if (g[0] === 0x2002) return isPrivateIP(v4(g[1]!, g[2]!));
  // 2001:0::/32 Teredo — server IPv4 in groups 2-3, client IPv4 (bit-inverted)
  // in groups 6-7; private if either is.
  if (g[0] === 0x2001 && g[1] === 0) {
    return (
      isPrivateIP(v4(g[2]!, g[3]!)) ||
      isPrivateIP(v4(g[6]! ^ 0xffff, g[7]! ^ 0xffff))
    );
  }
  const first = g[0]!;
  if ((first & 0xfe00) === 0xfc00) return true; //          fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; //          fe80::/10 link-local
  if ((first & 0xffc0) === 0xfec0) return true; //          fec0::/10 site-local (deprecated)
  if ((first & 0xff00) === 0xff00) return true; //          ff00::/8 multicast
  return false;
}
