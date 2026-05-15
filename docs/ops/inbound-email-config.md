# Inbound-email ingestion — operational setup

**Last updated:** 2026-05-15 (PR-A3 of the threat-intel ingestion plan)

The inbound-email pipeline turns any email subscription (GovDelivery, Substack, ad-hoc gov newsletter) into a row in `feed_items` that the existing `feed-items-embed` Inngest job picks up automatically. It is the foundation for the Wave-2/4 sources that have **no RSS** (Scamwatch, IDCARE Insights, FTC Consumer Alerts, AusCERT Week-in-Review, AUSTRAC subscription, OAIC newsletter, AFP media-release subscription).

## Architecture

```
Inbound email
   │
   ▼
Cloudflare Email Routing  ──── catch-all on intel.askarthur.au ────▶
   │
   ▼
Cloudflare Worker (apps/cloudflare-email-worker)
   │  • postal-mime parses MIME
   │  • resolves GovDelivery / Mailgun wrapper redirects (first link)
   │  • derives source slug from To: tag (acsc+ingest@ → inbound_acsc)
   │  • hashes Message-ID → external_id (idempotency)
   │  • POSTs JSON to Supabase Edge Function with X-Webhook-Secret
   ▼
Supabase Edge Function (supabase/functions/intel-inbound-email)
   │  • shared-secret auth (constant-time)
   │  • Zod validation
   │  • upsert into feed_items ON CONFLICT (source, external_id) DO NOTHING
   ▼
feed_items   ──── existing feed-items-embed Inngest, every 30 min ──▶ Voyage embed
```

No per-email Claude call. The Wave-3 weekly regulator clustering job processes inbound items the same way it processes RSS-sourced items.

## Address-tagging convention

Subscribe each upstream newsletter to its own tagged address:

| Subscription          | Subscribe address                     | Source slug in `feed_items` |
| --------------------- | ------------------------------------- | --------------------------- |
| Scamwatch GovDelivery | `scamwatch+ingest@intel.askarthur.au` | `inbound_scamwatch`         |
| ACSC Alert Service    | `acsc+ingest@intel.askarthur.au`      | `inbound_acsc`              |
| AUSTRAC               | `austrac+ingest@intel.askarthur.au`   | `inbound_austrac`           |
| OAIC newsletter       | `oaic+ingest@intel.askarthur.au`      | `inbound_oaic`              |
| AFP media-release     | `afp+ingest@intel.askarthur.au`       | `inbound_afp`               |
| ACMA                  | `acma+ingest@intel.askarthur.au`      | `inbound_acma`              |
| IDCARE Insights       | `idcare+ingest@intel.askarthur.au`    | `inbound_idcare`            |
| AusCERT digest        | `auscert+ingest@intel.askarthur.au`   | `inbound_auscert`           |
| FTC Consumer Alerts   | `ftc+ingest@intel.askarthur.au`       | `inbound_ftc`               |
| Risky Biz (backup)    | `riskybiz+ingest@intel.askarthur.au`  | `inbound_riskybiz`          |
| Krebs (backup)        | `krebs+ingest@intel.askarthur.au`     | `inbound_krebs`             |
| Anything else         | any tag not in the list above         | `inbound_generic`           |

Allowlist enforced by migration v128 (`feed_items_source_check` constraint + `get_unembedded_narrative_feed_items()` RPC). Add a new tag → add a slug to both, in a new migration.

## One-time setup

### 1. Cloudflare Email Routing

1. Add `intel.askarthur.au` to Cloudflare (subdomain of `askarthur.au`).
2. Cloudflare dashboard → Email → Email Routing → enable on the zone.
3. Add a **catch-all** rule: action **"Send to a Worker"**, worker `askarthur-intel-inbound-email` (deployed in step 2).

### 2. Deploy the Worker

```bash
cd apps/cloudflare-email-worker
pnpm install
pnpm wrangler secret put INBOUND_EMAIL_WEBHOOK_SECRET    # paste a 64-char random string
pnpm wrangler secret put SUPABASE_EDGE_FUNCTION_URL      # https://rquomhcgnodxzkhokwni.functions.supabase.co/intel-inbound-email
pnpm wrangler deploy
```

### 3. Deploy the Supabase Edge Function

```bash
# From repo root, with supabase CLI logged in
supabase functions deploy intel-inbound-email --project-ref rquomhcgnodxzkhokwni
supabase secrets set --project-ref rquomhcgnodxzkhokwni \
  INBOUND_EMAIL_WEBHOOK_SECRET=<same value as Worker>
supabase secrets set --project-ref rquomhcgnodxzkhokwni \
  ENABLE_INTEL_INBOUND_EMAIL=false   # default off; flip to true after end-to-end smoke
```

### 4. End-to-end smoke

1. Set `ENABLE_INTEL_INBOUND_EMAIL=true` via `supabase secrets set`.
2. Send a test email to `acsc+ingest@intel.askarthur.au` from any account.
3. Within ~10s, expect a row in `public.feed_items WHERE source='inbound_acsc'`.
4. Within 30 min (next `feed-items-embed` Inngest tick), expect `embedding IS NOT NULL`.

### 5. Subscribe to the actual feeds

Repeat per row in the table above. Each subscription page typically asks for confirmation — Cloudflare Email Routing will deliver the confirmation through the same Worker; click the link from the resulting `feed_items.body_md`.

## Kill switch

```bash
supabase secrets set --project-ref rquomhcgnodxzkhokwni \
  ENABLE_INTEL_INBOUND_EMAIL=false
```

Worker keeps receiving + parsing emails, but the Edge Function 204s them — no `feed_items` writes. Subscriptions stay live.

## Cost model

| Component                | Cost                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Cloudflare Email Routing | $0 (free tier)                                                                                                       |
| Cloudflare Worker        | $0 (100k req/day free tier; we're at <500/day)                                                                       |
| Supabase Edge Function   | $0 (within existing free tier, 500k invocations/mo)                                                                  |
| Claude per email         | **$0** — Worker writes raw text directly to `feed_items`; downstream Wave-3 clustering does any Claude work in batch |
| **Total**                | **A$0/mo**                                                                                                           |

A `feature_brakes.intel_inbound_email` row is **not** required at MVP because no Claude is in the per-email path. Add one (A$1/day cap) only if a future change adds per-email Claude (e.g. structured normalisation in the Edge Function).

## Failure modes

| Symptom                           | Cause                                                                                      | Recovery                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Edge Function 401                 | Worker secret diverged from Edge Function secret                                           | `supabase secrets set` + `wrangler secret put` with same value                                        |
| Edge Function 422                 | Cloudflare changed wrapper-redirect host & we no longer resolve to a valid URL             | Add new host to `TRACKING_HOSTS` in Worker `src/index.ts`                                             |
| Worker `postal-mime parse failed` | Malformed MIME from an upstream                                                            | `QUARANTINE_FORWARDER` route forwards raw message to `ops@askarthur.au`; not strictly required at MVP |
| `feed_items` constraint violation | A new `+ingest` tag was added without an `inbound_<tag>` slug in `feed_items_source_check` | Ship a follow-up migration extending the allowlist (mirror v128)                                      |

## Related

- Migration `v128_inbound_email_sources` — allowlist + RPC update.
- `pipeline/scrapers/scamwatch_alerts.py` — existing HTML scrape; the email path becomes the canonical Scamwatch source once subscribed (HTML scrape can be retired or kept as backfill).
- `docs/system-map/background-workers.md` — full background-worker inventory.
