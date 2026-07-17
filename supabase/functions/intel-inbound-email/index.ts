// Supabase Edge Function: intel-inbound-email
//
// Receives parsed-email payloads from the Cloudflare Email Routing Worker
// (apps/cloudflare-email-worker) and writes them into feed_items so the
// existing feed-items-embed Inngest job picks them up like any narrative
// scraper row.
//
// Auth: shared-secret HMAC in X-Webhook-Secret header (set
// INBOUND_EMAIL_WEBHOOK_SECRET on both sides). The function itself uses
// the Supabase service-role key from its Edge Function env to write.
//
// Kill switch: ENABLE_INTEL_INBOUND_EMAIL=false → returns 204 (Worker
// treats this as "drop quietly").
//
// Idempotency: (source, external_id) is partial-unique on feed_items
// (idx_feed_items_external) — ON CONFLICT DO NOTHING short-circuits
// re-deliveries from Cloudflare retries.
//
// Deploy:
//   supabase functions deploy intel-inbound-email --project-ref rquomhcgnodxzkhokwni
//   supabase secrets set INBOUND_EMAIL_WEBHOOK_SECRET=...
//   supabase secrets set ENABLE_INTEL_INBOUND_EMAIL=true
//
// Local test:
//   supabase functions serve intel-inbound-email --env-file .env.local
//
// Runtime: Deno (Supabase Edge runtime). Imports use jsr: + npm: specifiers.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";

// ── Payload schema ──────────────────────────────────────────────────────

const InboundEmailPayload = z.object({
  // Pre-resolved source slug from the Worker. Must match the
  // feed_items_source_check allowlist (v128).
  source: z.enum([
    // v128:
    "inbound_scamwatch",
    "inbound_acsc",
    "inbound_austrac",
    "inbound_oaic",
    "inbound_afp",
    "inbound_acma",
    "inbound_idcare",
    "inbound_auscert",
    "inbound_ftc",
    "inbound_riskybiz",
    "inbound_krebs",
    "inbound_generic",
    // v129 (high-signal additions):
    "inbound_ato",
    "inbound_sans",
    "inbound_tldr_infosec",
    "inbound_thn",
    "inbound_securityweek",
    // v209 competitor-intel consumer scam newsletters (ingest-but-never-publish,
    // ADR-0021). Bypass the tier_3 drop below and are stamped
    // category='competitor_intel' at insert.
    "inbound_which_scams",
    "inbound_aarp_fraud",
    "inbound_mse",
    "inbound_frankonfraud",
    // v213 source expansion — competitor_intel (choice_au, nts_scams,
    // cyber_safe_center, fraud_hq, get_safe_online) + AU regulator
    // (wa_scamnet — ingest-only since #807, WA Crown-copyright constraint).
    "inbound_choice_au",
    "inbound_nts_scams",
    "inbound_cyber_safe_center",
    "inbound_fraud_hq",
    "inbound_get_safe_online",
    "inbound_wa_scamnet",
  ]),
  // Message-id hash from the Worker. Drives ON CONFLICT idempotency.
  external_id: z.string().min(8).max(128),
  subject: z.string().min(1).max(2000),
  // Plain-text body (HTML stripped, GovDelivery redirects resolved by
  // the Worker). 50 KB cap matches feed_items_body_md_size check.
  body_md: z.string().min(1).max(50_000),
  // Primary article URL if extracted by the Worker (first non-tracking
  // link in body). Optional — many newsletters have no canonical link.
  url: z.string().url().optional(),
  from: z.string().min(3).max(320),
  to: z.string().min(3).max(320),
  received_at: z.string().datetime(),
  // Optional source-supplied tags (RSS categories the Worker may have
  // pulled from the email headers).
  tags: z.array(z.string().max(64)).max(20).optional(),
});

type InboundEmailPayload = z.infer<typeof InboundEmailPayload>;

// Competitor consumer scam-newsletter sources (v209, ADR-0021). These are a
// distinct class: on-mission enough to keep (unlike the tier_3 security press
// dropped below), but third-party editorial content we must NEVER republish.
// They flow through the tier_3 drop gate and are stamped
// category='competitor_intel' so the admin promote action refuses them and they
// stay published=false forever — intelligence for the weekly cohort, never feed
// content. See docs/adr/0021-competitor-intel-source-class.md.
const COMPETITOR_INTEL_SOURCES: ReadonlySet<string> = new Set([
  "inbound_which_scams",
  "inbound_aarp_fraud",
  "inbound_mse",
  "inbound_frankonfraud",
  // v213 — CHOICE, NTS, Cyber Safe Center, Fraud HQ, Get Safe Online.
  "inbound_choice_au",
  "inbound_nts_scams",
  "inbound_cyber_safe_center",
  "inbound_fraud_hq",
  "inbound_get_safe_online",
  // #807 (2026-07-18) — wa_scamnet moved here from publishable. WA ScamNet's
  // copyright expressly bars commercial reproduction without written
  // permission (scamnet.wa.gov.au/scamnet/Copyright.htm) — no CC licence,
  // unlike Scamwatch/ACSC. Ingest-only until Consumer Protection WA grants
  // written permission; then remove from this set to restore publishing.
  // Provenance tier stays tier_1_regulator (it IS a regulator — the quarantine
  // is a licensing constraint, not a trust judgement).
  "inbound_wa_scamnet",
]);
const COMPETITOR_INTEL_CATEGORY = "competitor_intel";

// Trim stored body to this many chars (cost: hot-table size + hourly Voyage
// embed re-reads). The Worker caps the wire payload at 50 KB; this is the
// at-rest store limit. Enough for the lede + a useful embedding window.
const BODY_STORE_LIMIT = 4000;

// Competitor newsletters (v212, Arthur's Watch Phase 2) are multi-scam digests
// — the Phase 2 extraction must see the WHOLE newsletter, not just the lede, or
// it silently drops every scam after the first ~4 KB. Store the full body for
// these (capped just under the feed_items_body_md_size check of 50000 chars).
// Volume is ~a handful of newsletters/week, so the extra ballast is negligible.
const COMPETITOR_BODY_STORE_LIMIT = 45000;

// ── Helpers ─────────────────────────────────────────────────────────────

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Source → ISO-3166-1 alpha-2 country for the flag chip on the public feed.
// Returns null for global / multi-country sources so the chip just hides
// instead of flying a wrong flag (the previous hardcode of "AU" tagged
// Krebs/SANS/TLDR/THN/SecurityWeek as Australian).
function countryCodeFor(source: string): string | null {
  switch (source) {
    case "inbound_scamwatch":
    case "inbound_acsc":
    case "inbound_austrac":
    case "inbound_oaic":
    case "inbound_afp":
    case "inbound_acma":
    case "inbound_idcare":
    case "inbound_auscert":
    case "inbound_ato":
    case "inbound_choice_au": // v213 — AU independent consumer
    case "inbound_wa_scamnet": // v213 — AU state regulator
      return "AU";
    case "inbound_ftc":
    case "inbound_aarp_fraud": // v209 — US consumer fraud alerts
    case "inbound_frankonfraud": // v209 — US fraud intel
      return "US";
    case "inbound_which_scams": // v209 — UK consumer scam newsletter
    case "inbound_mse": // v209 — UK money newsletter
    case "inbound_nts_scams": // v213 — UK trading standards
    case "inbound_get_safe_online": // v213 — UK online-safety charity
      return "GB";
    // Global publishers — leave null so the UI suppresses the flag chip.
    case "inbound_riskybiz":
    case "inbound_krebs":
    case "inbound_sans":
    case "inbound_tldr_infosec":
    case "inbound_thn":
    case "inbound_securityweek":
    case "inbound_cyber_safe_center": // v213 — global consumer
    case "inbound_fraud_hq": // v213 — global consumer
    case "inbound_generic":
    default:
      return null;
  }
}

// Source → provenance_tier_t (enum on public.feed_items).
//   tier_1_regulator: government regulators (ASD/ACSC, ACCC/Scamwatch, ACMA,
//                     AUSTRAC, OAIC, AFP, FTC)
//   tier_2_industry:  industry CERTs and victim-support services (AusCERT, IDCARE)
//   tier_3_curated:   editorial / journalist commentary (Risky Biz, Krebs)
//   tier_4_osint:     fallback for inbound_generic (unknown sender, unverified)
function provenanceTierFor(source: string): string {
  switch (source) {
    // Government regulators
    case "inbound_acsc":
    case "inbound_scamwatch":
    case "inbound_austrac":
    case "inbound_oaic":
    case "inbound_afp":
    case "inbound_acma":
    case "inbound_ftc":
    case "inbound_ato": // v129: AU Tax Office scam alerts — regulator
    case "inbound_wa_scamnet": // v213: Consumer Protection WA — regulator; ingest-only since #807 (copyright)
      return "tier_1_regulator";
    // Industry / CERTs / victim support
    case "inbound_auscert":
    case "inbound_idcare":
    case "inbound_sans": // v129: SANS NewsBites — expert-curated, industry standard
      return "tier_2_industry";
    // Curated journalism / editorial
    case "inbound_riskybiz":
    case "inbound_krebs":
    case "inbound_tldr_infosec": // v129
    case "inbound_thn":          // v129
    case "inbound_securityweek": // v129
    // v209 competitor consumer scam newsletters — editorial provenance is
    // honestly tier_3, but COMPETITOR_INTEL_SOURCES exempts them from the
    // tier_3 drop gate (ADR-0021). They are never published regardless.
    case "inbound_which_scams":
    case "inbound_aarp_fraud":
    case "inbound_mse":
    case "inbound_frankonfraud":
    // v213 competitor_intel additions:
    case "inbound_choice_au":
    case "inbound_nts_scams":
    case "inbound_cyber_safe_center":
    case "inbound_fraud_hq":
    case "inbound_get_safe_online":
      return "tier_3_curated";
    default:
      return "tier_4_osint";
  }
}

// ── Handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Method check — Cloudflare Worker POSTs JSON.
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  // Kill switch. Worker treats 204 as "drop quietly", no retry.
  const enabled = Deno.env.get("ENABLE_INTEL_INBOUND_EMAIL");
  if (enabled !== "true") {
    return new Response(null, { status: 204 });
  }

  // Shared-secret auth. Reject early to keep the public endpoint cheap
  // under random scanner traffic.
  const expected = Deno.env.get("INBOUND_EMAIL_WEBHOOK_SECRET");
  const provided = req.headers.get("x-webhook-secret") ?? "";
  if (!expected || !timingSafeEqual(provided, expected)) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  // Body parse + validate.
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const parsed = InboundEmailPayload.safeParse(raw);
  if (!parsed.success) {
    return jsonResponse(
      { error: "validation_failed", issues: parsed.error.issues },
      422,
    );
  }
  const payload: InboundEmailPayload = parsed.data;

  // Regulator-only inbound (2026-06-29): drop the curated security-press tier
  // at ingest. These multi-story industry digests (SecurityWeek, The Hacker
  // News, TLDR Infosec, Krebs, Risky Biz) are off-mission for the AU
  // consumer-facing /scam-feed and were the bulk of the 152-row quarantine
  // backlog (content that's wrong, not just unprocessed). 204 tells the
  // Worker "drop quietly, no retry". tier_1_regulator / tier_2_industry
  // (AU CERTs + victim support) + the generic fallback still flow through.
  // Competitor consumer scam newsletters (v209, ADR-0021) are tier_3_curated by
  // provenance but are DELIBERATELY exempted from the drop — they're on-mission
  // intelligence. They land quarantined (category='competitor_intel',
  // published=false) and the admin promote action refuses them, so they never
  // reach the public feed. Every other tier_3_curated source is still dropped.
  const tier = provenanceTierFor(payload.source);
  const isCompetitorIntel = COMPETITOR_INTEL_SOURCES.has(payload.source);
  if (tier === "tier_3_curated" && !isCompetitorIntel) {
    return new Response(null, { status: 204 });
  }

  // Write to feed_items. Service-role client; service-role env vars are
  // injected by Supabase Edge runtime.
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseServiceKey) {
    return jsonResponse({ error: "server_misconfigured" }, 500);
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  // Plain insert. The unique index on (source, external_id) is partial
  // (WHERE external_id IS NOT NULL), and PostgREST .upsert() with
  // onConflict can't target a partial index reliably. Instead we INSERT
  // and treat 23505 (unique_violation) as "duplicate, skip" — same
  // idempotency semantics, just at the SQL-error layer.
  const { data, error } = await supabase
    .from("feed_items")
    .insert({
      source: payload.source,
      external_id: payload.external_id,
      title: payload.subject,
      description: null,
      // Store a trimmed body. The full 50 KB is never read per-row on the
      // public feed; it's only ballast on a hot table that the hourly Voyage
      // embed job re-reads. ~4 KB keeps the lede + enough for embedding while
      // cutting storage + embed cost. (Worker still sends up to 50 KB; we
      // truncate at the store boundary.)
      body_md: payload.body_md.slice(
        0,
        isCompetitorIntel ? COMPETITOR_BODY_STORE_LIMIT : BODY_STORE_LIMIT,
      ),
      url: payload.url ?? null,
      source_url: payload.url ?? null,
      tags: payload.tags ?? null,
      published_at: payload.received_at,
      source_created_at: payload.received_at,
      country_code: countryCodeFor(payload.source),
      provenance_tier: tier,
      // Competitor newsletters get a marker category so the admin promote
      // action can refuse them (ADR-0021). Other inbound rows keep category
      // NULL, unchanged from prior behaviour.
      category: isCompetitorIntel ? COMPETITOR_INTEL_CATEGORY : null,
      // Quarantine inbound emails by default. The newsletter classifier
      // (P3 of the feed-quality recovery plan, 2026-05-16) promotes real
      // newsletter content to published=true via the per-source
      // auto_publish gate; subscription-confirmation / welcome emails
      // stay false forever. Without this, every subscribe-confirm email
      // surfaces on the public /scam-feed within seconds of arrival.
      published: false,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    // 23505 = unique_violation — same (source, external_id) already exists.
    // Cloudflare retries / duplicate Message-IDs land here; idempotent skip.
    if (error.code === "23505") {
      return jsonResponse({ status: "duplicate", source: payload.source }, 200);
    }
    return jsonResponse({ error: "db_write_failed", detail: error.message }, 500);
  }

  return jsonResponse({ status: "stored", id: data?.id, source: payload.source }, 200);
});
