import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { assertSafeURL } from "@askarthur/scam-engine";
import { AU_BRAND_WATCHLIST } from "@askarthur/shopfront-glue";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";
import { deriveBrandKey } from "@/app/api/inngest/functions/report-brand-stewardship";

/**
 * Known-brands security-contact discovery (RFC 9116 security.txt).
 *
 * Closes the long tail of the brand-contact coverage gap: the clone matcher
 * watches ~212 AU brands but known_brands only has contacts for a fraction.
 * For each watched brand with NO known_brands row yet, this fetches the brand's
 * own /.well-known/security.txt and, if it publishes a Contact, upserts a
 * VERIFIED contact (a security.txt on the brand's own apex domain is
 * authoritative). Brands with no security.txt get a contact_type='none' row so
 * they aren't re-probed every run.
 *
 * Reality check: only ~15% of these brands publish security.txt, so this is a
 * slow, ongoing trickle — but it's free, fully automatic, and picks up brands
 * that add one later (re-probe of 'none' rows after 90d) + any new watchlist
 * entry. The bulk of the gap is still manual curation (the v179 seed).
 *
 * Daily, capped to stay well under the 5-min Inngest budget (single fetch per
 * brand, 8s timeout, 15 brands/run).
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
  const url = `https://${domain}/.well-known/security.txt`;
  try {
    assertSafeURL(url); // SSRF hygiene (domains are trusted, but cheap)
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
      headers: { "user-agent": "AskArthur security-contact discovery (askarthur.au)" },
    });
    if (!res.ok) return null;
    const body = await res.text();
    return /contact:/i.test(body) ? body.slice(0, 20_000) : null;
  } catch {
    return null;
  }
}

export const knownBrandsDiscover = inngest.createFunction(
  {
    id: "known-brands-discover",
    name: "Known Brands: security.txt contact discovery",
    timeouts: { finish: "5m" },
    retries: 1,
    concurrency: { limit: 1 },
  },
  [
    { cron: "0 6 * * *" }, // daily 06:00 UTC
    { event: "known-brands/discover.manual-trigger.v1" },
  ],
  withAxiomLogging({ fnId: "known-brands-discover" }, async ({ step }) => {
    const existingKeys = await step.run("load-existing", async () => {
      const sb = createServiceClient();
      if (!sb) return [] as string[];
      const { data } = await sb.from("known_brands").select("brand_name");
      return (data ?? [])
        .map((r) => deriveBrandKey((r.brand_name as string | null) ?? ""))
        .filter((k): k is string => Boolean(k));
    });
    const covered = new Set(existingKeys);

    // Watched brands with no known_brands row yet, keyed on brand_key (which
    // matches the upsert's ON CONFLICT(brand_name) arbiter — brand_key is
    // derived from brand_name on both sides). Previously this keyed on
    // brand_domain while the upsert keyed on brand_name with
    // ignoreDuplicates: true, so any brand whose name already existed under a
    // different domain was never written, stayed "uncovered", and got
    // re-probed + re-counted as discovered on EVERY run — the perpetual
    // "Probed 1 → discovered 1" digest. A probe domain is still required.
    const candidates = AU_BRAND_WATCHLIST.filter((b) => {
      const d = b.legitimate_domains?.[0]?.toLowerCase();
      return Boolean(d) && !covered.has(deriveBrandKey(b.brand));
    }).slice(0, DISCOVER_RUN_CAP);

    if (candidates.length === 0) {
      return { ok: true, probed: 0, discovered: 0, reason: "all_probed" };
    }

    let probed = 0;
    let discovered = 0;
    const discoveredBrands: string[] = [];
    for (const b of candidates) {
      const outcome = await step.run(`probe-${deriveBrandKey(b.brand)}`, async () => {
        const domain = b.legitimate_domains[0];
        const body = await fetchSecurityTxt(domain);
        const found = body ? parseSecurityTxtContacts(body) : { emails: [], urls: [] };
        const email = found.emails[0] ?? null;
        const url = found.urls[0] ?? null;
        const hasContact = Boolean(email || url);

        const sb = createServiceClient();
        if (!sb) return { hasContact: false };
        // security.txt on the brand's own apex domain is authoritative → mark
        // VERIFIED. A miss writes a contact_type='none' ledger row so we don't
        // re-probe it next run.
        const { error } = await sb.from("known_brands").upsert(
          {
            brand_name: b.brand,
            brand_domain: domain,
            brand_key: deriveBrandKey(b.brand),
            contact_type: email ? "email" : url ? "webform" : "none",
            security_contact_email: email,
            security_contact_url: url,
            is_active: hasContact,
            last_verified_at: hasContact ? new Date().toISOString() : null,
            verified_by: hasContact ? "security_txt_discovery" : null,
            source_url: hasContact ? `https://${domain}/.well-known/security.txt` : null,
            notes: hasContact
              ? "Auto-discovered from RFC 9116 security.txt."
              : "Probed — no security.txt contact found.",
          },
          { onConflict: "brand_name", ignoreDuplicates: true },
        );
        if (error) {
          logger.warn("known-brands-discover: upsert failed", {
            brand: b.brand,
            error: error.message,
          });
          return { hasContact: false };
        }
        return { hasContact };
      });
      probed++;
      if (outcome.hasContact) {
        discovered++;
        discoveredBrands.push(b.brand);
      }
    }

    // Notify only when something NEW was found. A "0 discovered" run is the
    // steady state (most brands publish no security.txt) and was the bulk of
    // the daily noise — log it, don't page.
    if (discovered > 0) {
      await step.run("telegram", async () => {
        await sendAdminTelegramMessage(
          [
            `<b>Known-brands discovery</b>`,
            `Discovered <b>${discovered}</b> new security.txt contact(s) from ${probed} probed:`,
            ...discoveredBrands.map((name) => `• ${name}`),
          ].join("\n"),
        );
      });
    }

    logger.info("known-brands-discover: complete", { probed, discovered });
    return { ok: true, probed, discovered };
  }),
);
