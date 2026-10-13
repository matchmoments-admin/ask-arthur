import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { FETCH_DEFAULT_MAX_REDIRECTS, safeFetch } from "@askarthur/scam-engine/safe-fetch";
import { buildBrandResolver, type BrandEntry } from "@askarthur/shopfront-glue";
import { getActiveWatchlistDetailed } from "@askarthur/scam-engine/active-watchlist";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";
import { deriveBrandKey } from "@/app/api/inngest/functions/report-brand-stewardship";
import { html, joinHtml } from "@askarthur/utils/html";
import { loadAliasRecord } from "@/lib/brand-aliases";
import { canonicalBrandKeyResolver } from "@/lib/clone-watch/canonical-brand-key";

/**
 * Known-brands security-contact discovery (RFC 9116 security.txt).
 *
 * For each WATCHED brand with no known_brands row yet, this fetches the brand's
 * own /.well-known/security.txt and, if it publishes a Contact, records a
 * VERIFIED contact (a security.txt on the brand's own apex domain is
 * authoritative). A miss records a contact_type='none' row so the brand is not
 * re-probed every run.
 *
 * WHAT "WATCHED" MEANS (#1304, v348). The roster is the ACTIVE WATCHLIST —
 * the static AU_BRAND_WATCHLIST seed plus the monitored_brands overlay (Brand
 * Subscribers and house-org promotions), read through the one Seam
 * getActiveWatchlistDetailed(). Before #1304 this fn read the static array
 * only, so a paying brand never got a known_brands row: no category for the
 * weaponisation-risk score, no security contact. Coverage is matched on the
 * Canonical Brand (ADR-0020: brand_normalize of the alias-resolved name) OR
 * the brand's domain — not on deriveBrandKey, which is a display slug.
 *
 * SEEDED ROWS. A Brand Subscriber joins the overlay only once verified, so
 * activation does not wait for it: lib/clone-watch/known-brand-seed.ts writes
 * its known_brands row (operator category, no contact, probed_at NULL) and
 * sends this fn's event. An unprobed seeded row is at the HEAD of the worklist.
 *
 * ROTATION. record_known_brand_probe (v348) stamps probed_at on every probe,
 * hit or miss, and a row with probed_at set (or with a contact) covers its
 * brand — so every probed candidate leaves the worklist. Coverage is still
 * one-shot: a brand that publishes security.txt after its probe is not
 * re-discovered (a re-probe window on probed_at is now possible; not built).
 *
 * Reality check: only ~15% of brands publish security.txt, so this is a slow
 * trickle. The bulk of the contacts are manual curation (the v179 seed).
 *
 * PARKED (#1230): event-only, no cron. Capped at 15 probes/run (single fetch
 * per brand, 8s timeout).
 */

const DISCOVER_RUN_CAP = 15;
const FETCH_TIMEOUT_MS = 8000;

/**
 * Parse the `Contact:` fields out of a security.txt body. Pure + unit-tested.
 * Emails (mailto: or bare) are preferred; https/http contacts are kept as a
 * webform URL fallback.
 */
export function parseSecurityTxtContacts(body: string): {
  emails: string[];
  urls: string[];
} {
  const emails: string[] = [];
  const urls: string[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("#") || !/^contact:/i.test(line)) continue;
    const val = line.replace(/^contact:/i, "").trim();
    if (/^mailto:/i.test(val)) {
      const e = val.replace(/^mailto:/i, "").trim();
      if (e.includes("@")) emails.push(e.toLowerCase());
    } else if (/^https?:\/\//i.test(val)) {
      urls.push(val);
    } else if (val.includes("@") && !val.includes(" ")) {
      emails.push(val.toLowerCase());
    }
  }
  return { emails, urls };
}

async function fetchSecurityTxt(domain: string): Promise<string | null> {
  // safeFetch: guard + SSRF-safe dispatcher, and every redirect hop checked
  // before it is followed (a plain redirect:"follow" skipped the per-hop check).
  const res = await safeFetch(`https://${domain}/.well-known/security.txt`, {
    timeoutMs: FETCH_TIMEOUT_MS,
    maxBytes: 64 * 1024,
    truncate: true,
    redirect: "follow-checked",
    // Was a plain redirect: "follow" — keep fetch's hop limit.
    maxRedirects: FETCH_DEFAULT_MAX_REDIRECTS,
    headers: { "user-agent": "AskArthur security-contact discovery (askarthur.au)" },
    as: "text",
  });
  if (!res.ok) return null;
  return /contact:/i.test(res.body) ? res.body.slice(0, 20_000) : null;
}

/** A known_brands row as the discover worklist reads it. */
export interface KnownBrandCoverageRow {
  id: number;
  brand_name: string | null;
  brand_domain: string | null;
  contact_type: string | null;
  probed_at: string | null;
}

export interface DiscoverCandidate {
  brand: string;
  domain: string;
  /** "seed": an unprobed row seeded on Brand Subscriber activation.
   *  "roster": a watched brand with no covering known_brands row. */
  source: "seed" | "roster";
}

function domainKey(raw: string | null | undefined): string | null {
  const d = (raw ?? "").trim().toLowerCase().replace(/^www\./, "");
  return d.length > 0 ? d : null;
}

/** An unprobed seeded row: contact-less and never probed (v348). */
function isUnprobedSeed(r: KnownBrandCoverageRow): boolean {
  return (r.contact_type ?? "none") === "none" && !r.probed_at;
}

/**
 * THE discover worklist. Pure.
 *
 *   1. Unprobed seeded rows first (a paying brand asked for them), by id.
 *   2. Then roster brands that no covering row describes — by Canonical Brand
 *      or by any of their legitimate domains — in roster order.
 *
 * A row COVERS its brand when it has a contact or has been probed. The probe
 * write stamps probed_at, so a probed candidate is not selected again: change
 * this predicate and the probe RPC together (knownBrandsRosterSql.test.ts
 * holds them to each other with a multi-run rotation).
 */
export function selectDiscoverCandidates(
  roster: readonly BrandEntry[],
  rows: readonly KnownBrandCoverageRow[],
  canonicalKey: (raw: string | null | undefined) => string | null,
  cap: number = DISCOVER_RUN_CAP,
): DiscoverCandidate[] {
  const coveredKeys = new Set<string>();
  const coveredDomains = new Set<string>();
  const out: DiscoverCandidate[] = [];

  const seeds = rows
    .filter((r) => isUnprobedSeed(r) && r.brand_name && domainKey(r.brand_domain))
    .sort((a, b) => a.id - b.id);

  for (const r of rows) {
    // A seed claims its brand too: the roster pass must not probe it twice.
    const k = canonicalKey(r.brand_name);
    const d = domainKey(r.brand_domain);
    if (k) coveredKeys.add(k);
    if (d) coveredDomains.add(d);
  }
  for (const r of seeds) {
    out.push({ brand: r.brand_name as string, domain: domainKey(r.brand_domain) as string, source: "seed" });
  }

  for (const b of roster) {
    if (out.length >= cap) break;
    const domains = (b.legitimate_domains ?? [])
      .map((x) => domainKey(x))
      .filter((x): x is string => Boolean(x));
    if (domains.length === 0) continue;
    const k = canonicalKey(b.brand);
    if (k && coveredKeys.has(k)) continue;
    if (domains.some((d) => coveredDomains.has(d))) continue;
    out.push({ brand: b.brand, domain: domains[0], source: "roster" });
    if (k) coveredKeys.add(k);
    for (const d of domains) coveredDomains.add(d);
  }

  return out.slice(0, cap);
}

const CONTACT_OUTCOMES = new Set(["inserted_contact", "seed_probed_contact"]);

export const KNOWN_BRANDS_DISCOVER_EVENT = "known-brands/discover.manual-trigger.v1";

// inngest-finish-budget: 17 boundaries — 2 static (load-existing, telegram)
// + 1 per-candidate probe step x DISCOVER_RUN_CAP (15).

export const knownBrandsDiscover = inngest.createFunction(
  {
    id: "known-brands-discover",
    name: "Known Brands: security.txt contact discovery",
    timeouts: { finish: "10m" },
    retries: 1,
    concurrency: { limit: 1 },
  },
  [
    // PARKED (#1230, 2026-09-26): the daily 06:00 run found every known brand
    // already probed (100% `all_probed`) — one wasted run a day. Event only:
    // an operator, or Brand Subscriber activation (known-brand-seed.ts, #1304),
    // sends it. Restore `{ cron: "0 6 * * *" }` when new brands arrive faster
    // than activation + an operator trigger them.
    { event: KNOWN_BRANDS_DISCOVER_EVENT },
  ],
  withAxiomLogging({ fnId: "known-brands-discover" }, async ({ step }) => {
    // One step for the three reads (a step boundary each would push the
    // finish floor past 10m): known_brands, the roster, the alias layer.
    const { rows, roster, aliasRecord } = await step.run("load-existing", async () => {
      const sb = createServiceClient();
      if (!sb) throw new Error("known-brands-discover: no service client");
      const { data, error } = await sb
        .from("known_brands")
        .select("id, brand_name, brand_domain, contact_type, probed_at");
      // Throw, don't default to []: an unread table makes every watched brand
      // look uncovered, and the run would re-probe 15 known brands.
      if (error) throw new Error(`known_brands read failed: ${error.message}`);
      // The one roster: static seed + monitored_brands overlay. Fails safe to
      // the static list (never empty) — see @askarthur/scam-engine/active-watchlist.
      const w = await getActiveWatchlistDetailed();
      return {
        rows: (data ?? []) as KnownBrandCoverageRow[],
        roster: { entries: w.entries, dynamicCount: w.dynamicCount },
        aliasRecord: await loadAliasRecord(sb, "known-brands-discover"),
      };
    });
    const canonicalKey = canonicalBrandKeyResolver(buildBrandResolver(aliasRecord));

    const candidates = selectDiscoverCandidates(roster.entries, rows, canonicalKey);
    const seeds = candidates.filter((c) => c.source === "seed").length;

    if (candidates.length === 0) {
      return {
        ok: true,
        probed: 0,
        discovered: 0,
        roster: roster.entries.length,
        rosterDynamic: roster.dynamicCount,
        reason: "all_probed",
      };
    }

    let probed = 0;
    let discovered = 0;
    let failed = 0;
    const discoveredBrands: string[] = [];
    for (const c of candidates) {
      const outcome = await step.run(`probe-${deriveBrandKey(c.brand)}`, async () => {
        const body = await fetchSecurityTxt(c.domain);
        const found = body ? parseSecurityTxtContacts(body) : { emails: [], urls: [] };

        const sb = createServiceClient();
        if (!sb) return { ok: false, hasContact: false };
        // security.txt on the brand's own apex domain is authoritative → the
        // RPC marks it VERIFIED. Every call stamps probed_at (rotation).
        const { data, error } = await sb.rpc("record_known_brand_probe", {
          p_brand_name: c.brand,
          p_brand_domain: c.domain,
          p_brand_key: deriveBrandKey(c.brand),
          p_email: found.emails[0] ?? null,
          p_url: found.urls[0] ?? null,
        });
        if (error) {
          logger.warn("known-brands-discover: probe record failed", {
            brand: c.brand,
            error: error.message,
          });
          return { ok: false, hasContact: false };
        }
        const row = (data as Array<{ outcome: string }> | null)?.[0];
        return { ok: true, hasContact: CONTACT_OUTCOMES.has(row?.outcome ?? "") };
      });
      probed++;
      if (!outcome.ok) failed++;
      if (outcome.hasContact) {
        discovered++;
        discoveredBrands.push(c.brand);
      }
    }

    // Notify only when something NEW was found. A "0 discovered" run is the
    // steady state (most brands publish no security.txt) and was the bulk of
    // the daily noise — log it, don't page.
    if (discovered > 0) {
      await step.run("telegram", async () => {
        const sent = await sendAdminTelegramMessage(
          joinHtml([
            html`<b>Known-brands discovery</b>`,
            html`Discovered <b>${discovered}</b> new security.txt contact(s) from ${probed} probed:`,
            ...discoveredBrands.map((name) => html`• ${name}`),
          ], "\n"),
        );
        if (!sent.ok) {
          logger.warn("known-brands-discover: admin notification not delivered", {
            reason: sent.reason,
            error: sent.error,
          });
        }
      });
    }

    // warn, not info: a low-frequency fn is invisible at INFO's 10% sampling.
    logger.warn("known-brands-discover.summary", { probed, discovered, failed, seeds });
    return { ok: true, probed, discovered, failed, seeds, roster: roster.entries.length };
  }),
);
