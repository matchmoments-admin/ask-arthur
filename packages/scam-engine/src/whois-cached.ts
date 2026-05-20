// Cache-first domain-age lookup — Deep Shop Check Stage 1.
//
// Domain age is the research's #3 fake-shop signal ("highest-signal feature
// in published ML research"). The raw lookupWhois() in whois.ts hits the
// whoisjson.com free tier — ~1000 calls/month, already near-exhausted — and
// has no cache of its own. The shared cache lives in the scam_urls table
// (whois_created_date + whois_lookup_at, keyed by domain), populated by the
// scam-URL reporting flow.
//
// This module reads that cache first and only calls lookupWhois on a miss,
// then writes the result back onto any existing scam_urls rows (UPDATE only —
// never INSERT a partial row for a domain that was never reported).

import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import type { DomainAgeBand } from "@askarthur/types";
import { lookupWhois } from "./whois";

// A domain's creation date never changes, so a cached lookup stays valid
// indefinitely; 180 days is just a re-verify horizon for transient failures.
const CACHE_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

export interface DomainCreatedDate {
  createdDate: string | null; // ISO date (YYYY-MM-DD) or null
  source: "cache" | "live";
}

/** Days since a domain's registration, or null when the date is unknown. */
export function domainAgeDays(createdDate: string | null): number | null {
  if (!createdDate) return null;
  const d = new Date(createdDate);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

/** Map a domain age in days to a risk band (mirrors the charity-check bands). */
export function domainAgeBand(ageDays: number | null): DomainAgeBand {
  if (ageDays === null) return "unknown";
  if (ageDays < 30) return "fresh";
  if (ageDays < 90) return "recent";
  return "established";
}

/**
 * Resolve a domain's registration date, cache-first. Reads the most recent
 * scam_urls row for the domain; on a miss (or a stale lookup) calls
 * lookupWhois and writes the result back onto existing scam_urls rows.
 * Never throws — a failed lookup yields { createdDate: null }.
 */
export async function getDomainCreatedDate(
  domain: string,
): Promise<DomainCreatedDate> {
  const supabase = createServiceClient();

  if (supabase) {
    try {
      const { data } = await supabase
        .from("scam_urls")
        .select("whois_created_date, whois_lookup_at")
        .eq("domain", domain)
        .not("whois_lookup_at", "is", null)
        .order("whois_lookup_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data?.whois_lookup_at) {
        const fresh =
          Date.now() - new Date(data.whois_lookup_at).getTime() < CACHE_MAX_AGE_MS;
        if (fresh) {
          return { createdDate: data.whois_created_date ?? null, source: "cache" };
        }
      }
    } catch (err) {
      logger.warn("getDomainCreatedDate: cache read failed", {
        domain,
        error: String(err),
      });
    }
  }

  const whois = await lookupWhois(domain);

  if (supabase) {
    // Best-effort write-back onto rows that already exist for this domain.
    // Never INSERT — a domain with no scam_urls row was never reported.
    supabase
      .from("scam_urls")
      .update({
        whois_created_date: whois.createdDate,
        whois_registrar: whois.registrar,
        whois_is_private: whois.isPrivate,
        whois_lookup_at: new Date().toISOString(),
      })
      .eq("domain", domain)
      .then(({ error }) => {
        if (error) {
          logger.warn("getDomainCreatedDate: cache write-back failed", {
            domain,
            error: error.message,
          });
        }
      });
  }

  return { createdDate: whois.createdDate, source: "live" };
}
