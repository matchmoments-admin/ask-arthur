// Certificate Transparency log search via crt.sh (free, no auth).
// Looks up SSL certificates issued for a domain to detect age, subdomains, wildcards.
// Graceful degradation: errors → empty result.

import { Redis } from "@upstash/redis";
import { logger } from "@askarthur/utils/logger";

const CACHE_TTL = 43_200; // 12 hours
const CACHE_PREFIX = "askarthur:ct";
const MAX_CERTS = 20; // Limit to 20 most recent (crt.sh can return thousands)

let _redis: Redis | null = null;
function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  if (!_redis) {
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return _redis;
}

export interface CTLookupResult {
  certificateCount: number;
  certificates: {
    issuerName: string;
    notBefore: string;
    notAfter: string;
    commonName: string;
  }[];
  uniqueSubdomains: string[];
  hasWildcard: boolean;
  oldestCertDate: string | null;
  newestCertDate: string | null;
}

const EMPTY_RESULT: CTLookupResult = {
  certificateCount: 0,
  certificates: [],
  uniqueSubdomains: [],
  hasWildcard: false,
  oldestCertDate: null,
  newestCertDate: null,
};

/**
 * Look up Certificate Transparency logs for a domain via crt.sh.
 * Free, no authentication. 5s timeout. 1s polite delay recommended between calls.
 */
export async function lookupCT(domain: string): Promise<CTLookupResult> {
  // Check cache first
  const redis = getRedis();
  if (redis) {
    try {
      const cached = await redis.get<CTLookupResult>(`${CACHE_PREFIX}:${domain}`);
      if (cached) return cached;
    } catch {
      // Cache miss — continue to API
    }
  }

  try {
    const res = await fetch(
      `https://crt.sh/?q=${encodeURIComponent(domain)}&output=json`,
      {
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!res.ok) {
      logger.warn("crt.sh lookup failed", { status: res.status, domain });
      return EMPTY_RESULT;
    }

    const rawCerts = await res.json();
    if (!Array.isArray(rawCerts) || rawCerts.length === 0) {
      const emptyResult = { ...EMPTY_RESULT };
      if (redis) {
        redis.set(`${CACHE_PREFIX}:${domain}`, emptyResult, { ex: CACHE_TTL }).catch(() => {});
      }
      return emptyResult;
    }

    // Deduplicate by serial number and take most recent
    const seenSerials = new Set<string>();
    const uniqueCerts: typeof rawCerts = [];
    for (const cert of rawCerts) {
      const serial = cert.serial_number || cert.id?.toString();
      if (serial && seenSerials.has(serial)) continue;
      if (serial) seenSerials.add(serial);
      uniqueCerts.push(cert);
    }

    // Sort by not_before descending (newest first) and limit
    uniqueCerts.sort((a, b) => {
      const dateA = new Date(a.not_before || 0).getTime();
      const dateB = new Date(b.not_before || 0).getTime();
      return dateB - dateA;
    });
    const limitedCerts = uniqueCerts.slice(0, MAX_CERTS);

    // Extract structured data
    const certificates = limitedCerts.map((cert) => ({
      issuerName: cert.issuer_name || cert.ca_name || "",
      notBefore: cert.not_before || "",
      notAfter: cert.not_after || "",
      commonName: cert.common_name || cert.name_value || "",
    }));

    // Collect unique subdomains
    const subdomains = new Set<string>();
    let hasWildcard = false;
    for (const cert of uniqueCerts) {
      const name = cert.common_name || cert.name_value || "";
      // name_value can contain multiple names separated by newlines
      const names = name.split("\n").map((n: string) => n.trim().toLowerCase());
      for (const n of names) {
        if (n.startsWith("*.")) {
          hasWildcard = true;
          subdomains.add(n);
        } else if (n && n !== domain.toLowerCase()) {
          subdomains.add(n);
        }
      }
    }

    // Date range
    const allDates = uniqueCerts
      .map((c) => new Date(c.not_before || 0).getTime())
      .filter((t) => t > 0);
    const oldestCertDate = allDates.length > 0
      ? new Date(Math.min(...allDates)).toISOString().slice(0, 10)
      : null;
    const newestCertDate = allDates.length > 0
      ? new Date(Math.max(...allDates)).toISOString().slice(0, 10)
      : null;

    const result: CTLookupResult = {
      certificateCount: uniqueCerts.length,
      certificates,
      uniqueSubdomains: [...subdomains].slice(0, 50),
      hasWildcard,
      oldestCertDate,
      newestCertDate,
    };

    // Cache result (fire-and-forget)
    if (redis) {
      redis.set(`${CACHE_PREFIX}:${domain}`, result, { ex: CACHE_TTL }).catch(() => {});
    }

    return result;
  } catch (err) {
    logger.error("crt.sh lookup error", { error: String(err), domain });
    return EMPTY_RESULT;
  }
}
