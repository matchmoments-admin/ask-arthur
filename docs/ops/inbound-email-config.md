# Inbound-email ingestion — operational setup

**Last updated:** 2026-05-15 (PR-A3 shipped + deployed)

The inbound-email pipeline turns any email subscription (GovDelivery, Substack, ad-hoc gov newsletter) into a row in `feed_items` that the existing `feed-items-embed` Inngest job picks up automatically. It is the foundation for the Wave-2/4 sources that have **no RSS** (Scamwatch, IDCARE Insights, FTC Consumer Alerts, AusCERT Week-in-Review, AUSTRAC subscription, OAIC newsletter, AFP media-release subscription).

## Deployed state (2026-05-15)

| Component              | URL / value                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| Inbound domain         | `askarthur-inbound.com` (Cloudflare Registrar, A$16/year)                                                  |
| Cloudflare Worker      | `askarthur-intel-inbound-email` — Email-Workers binding only; no public HTTP route                         |
| Supabase Edge Function | `https://rquomhcgnodxzkhokwni.functions.supabase.co/intel-inbound-email` (deployed with `--no-verify-jwt`) |
| Kill switch            | `ENABLE_INTEL_INBOUND_EMAIL=true` (Supabase secret)                                                        |
| Shared secret          | `INBOUND_EMAIL_WEBHOOK_SECRET` — 64-char hex, present on both sides                                        |
| Local secret backup    | `~/.askarthur-inbound-email-secret.txt` (mode 600) — keep for future rotations                             |

Verified end-to-end via curl on deploy day: bad secret → 401, kill-switch OFF → 204, kill-switch ON + valid secret + bad payload → 422.

**Operational follow-up: PR-A4 is deferred** — adds per-tag sender-domain allowlist in the Worker (e.g. `inbound_acsc` only accepts `cyber.gov.au` / `govdelivery.com` senders) plus `cost_telemetry` volume rows for spike alerts. Build trigger: first observed abuse or first volume-spike alert from real subscriptions.

## Architecture

```
Inbound email
   │
   ▼
Cloudflare Email Routing  ──── per-address rules on askarthur-inbound.com ──▶
   │  (subaddressing ON; rule for "acsc" matches both acsc@ and acsc+ingest@)
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
             ──── existing regulator-alert-push Inngest, every 30 min ──▶ HIGH-confidence pushes
             ──── (planned) Wave-3 weekly regulator-intel-cluster ──▶ themes for blog/digest
```

No per-email Claude call. The Wave-3 weekly regulator clustering job (PR-C1, not yet shipped) processes inbound items the same way it processes RSS-sourced items.

## Address-tagging convention

Subscribe each upstream newsletter to its own tagged address:

| Subscription          | Subscribe address                        | Source slug in `feed_items` |
| --------------------- | ---------------------------------------- | --------------------------- |
| Scamwatch GovDelivery | `scamwatch+ingest@askarthur-inbound.com` | `inbound_scamwatch`         |
| ACSC Alert Service    | `acsc+ingest@askarthur-inbound.com`      | `inbound_acsc`              |
| AUSTRAC               | `austrac+ingest@askarthur-inbound.com`   | `inbound_austrac`           |
| OAIC newsletter       | `oaic+ingest@askarthur-inbound.com`      | `inbound_oaic`              |
| AFP media-release     | `afp+ingest@askarthur-inbound.com`       | `inbound_afp`               |
| ACMA                  | `acma+ingest@askarthur-inbound.com`      | `inbound_acma`              |
| IDCARE Insights       | `idcare+ingest@askarthur-inbound.com`    | `inbound_idcare`            |
| AusCERT digest        | `auscert+ingest@askarthur-inbound.com`   | `inbound_auscert`           |
| FTC Consumer Alerts   | `ftc+ingest@askarthur-inbound.com`       | `inbound_ftc`               |
| Risky Biz (backup)    | `riskybiz+ingest@askarthur-inbound.com`  | `inbound_riskybiz`          |
| Krebs (backup)        | `krebs+ingest@askarthur-inbound.com`     | `inbound_krebs`             |
| Anything else         | any tag not in the list above            | `inbound_generic`           |

Allowlist enforced by migration v128 (`feed_items_source_check` constraint + `get_unembedded_narrative_feed_items()` RPC). Add a new tag → add a slug to both, in a new migration.

## One-time setup (reference — already complete for askarthur-inbound.com)

### 1. Register the domain + enable Email Routing

1. Cloudflare Registrar → register `askarthur-inbound.com` (`https://dash.cloudflare.com/?to=/:account/domains/register`).
2. Once active, click into the zone → **Email** → **Email Routing** → click **"Enable Email Routing"** → accept the MX + SPF + DKIM records (auto-added on a Cloudflare-managed zone).
3. **Settings** tab → toggle **"Enable subaddressing"** ON. This lets a rule for `acsc` match both `acsc@` and `acsc+ingest@`.

### 2. Deploy the Worker

```bash
cd apps/cloudflare-email-worker
pnpm install
pnpm wrangler login                                  # one-time; opens browser
echo "<64-char hex>" | pnpm wrangler secret put INBOUND_EMAIL_WEBHOOK_SECRET
echo "https://rquomhcgnodxzkhokwni.functions.supabase.co/intel-inbound-email" \
  | pnpm wrangler secret put SUPABASE_EDGE_FUNCTION_URL
pnpm wrangler deploy
```

### 3. Deploy the Supabase Edge Function

```bash
supabase login --token <sbp_personal_access_token>   # generate at supabase.com/dashboard/account/tokens
supabase link --project-ref rquomhcgnodxzkhokwni

# IMPORTANT: --no-verify-jwt — the function is a public webhook receiver
# and uses X-Webhook-Secret for auth instead of a Supabase JWT.
supabase functions deploy intel-inbound-email --project-ref rquomhcgnodxzkhokwni --no-verify-jwt

# Secrets: same shared secret as the Worker, plus kill switch
SECRET=$(cat ~/.askarthur-inbound-email-secret.txt)
supabase secrets set --project-ref rquomhcgnodxzkhokwni \
  INBOUND_EMAIL_WEBHOOK_SECRET="$SECRET" \
  ENABLE_INTEL_INBOUND_EMAIL=true
```

### 4. Add per-address routing rules (one per source)

In the Cloudflare dashboard → `askarthur-inbound.com` → **Email** → **Email Routing** → **Routing rules** → **"Create address"** for each row. All rules use **Action: Send to a Worker → `askarthur-intel-inbound-email`**:

| Custom address | Resulting source slug |
| -------------- | --------------------- |
| `acsc`         | `inbound_acsc`        |
| `scamwatch`    | `inbound_scamwatch`   |
| `austrac`      | `inbound_austrac`     |
| `oaic`         | `inbound_oaic`        |
| `afp`          | `inbound_afp`         |
| `acma`         | `inbound_acma`        |
| `idcare`       | `inbound_idcare`      |
| `auscert`      | `inbound_auscert`     |
| `ftc`          | `inbound_ftc`         |
| `riskybiz`     | `inbound_riskybiz`    |
| `krebs`        | `inbound_krebs`       |

**Do not enable the catch-all.** Per-address rules give clean attribution; catch-all would route random scanner / typo traffic into `feed_items` as `inbound_generic`.

### 5. End-to-end smoke

1. Send a test email from any account → `acsc+ingest@askarthur-inbound.com`, subject `Pipeline smoke test`.
2. Within ~10s, expect a row in `public.feed_items WHERE source='inbound_acsc'` (see Monitoring queries below).
3. Within 30 min (next `feed-items-embed` tick), expect `embedding IS NOT NULL`.

### 6. Subscribe to the actual feeds

Repeat per row in the address-tagging table above. Each subscription page asks for confirmation — Cloudflare delivers the confirmation through the same Worker; click the link out of `feed_items.body_md` to confirm.

## Monitoring queries

Paste into the Supabase SQL editor (https://supabase.com/dashboard/project/rquomhcgnodxzkhokwni/sql/new):

```sql
-- A. Right after a test email — did it land?
SELECT id, source, title, substring(body_md, 1, 100) AS body, created_at
FROM public.feed_items
WHERE source LIKE 'inbound_%'
ORDER BY created_at DESC
LIMIT 10;

-- B. After ≤30 min — did Voyage embed it?
SELECT id, source, embedding IS NOT NULL AS embedded, created_at
FROM public.feed_items
WHERE source LIKE 'inbound_%'
ORDER BY created_at DESC
LIMIT 10;

-- C. Per-source volume in last 24h — sanity-check subscriptions.
SELECT source, count(*) AS items_24h, max(created_at) AS most_recent
FROM public.feed_items
WHERE source LIKE 'inbound_%'
  AND created_at >= now() - interval '24 hours'
GROUP BY source
ORDER BY items_24h DESC;

-- D. Backfill check — anything stuck unembedded after >30 min?
SELECT source, count(*) AS stale_unembedded
FROM public.feed_items
WHERE source LIKE 'inbound_%'
  AND embedding IS NULL
  AND created_at < now() - interval '30 minutes'
GROUP BY source;
```

## Kill switch

```bash
supabase secrets set --project-ref rquomhcgnodxzkhokwni \
  ENABLE_INTEL_INBOUND_EMAIL=false
```

Worker keeps receiving + parsing emails, but the Edge Function 204s them — no `feed_items` writes. Subscriptions stay live.

## Secret rotation

```bash
# Generate a new secret
openssl rand -hex 32 > ~/.askarthur-inbound-email-secret.txt
chmod 600 ~/.askarthur-inbound-email-secret.txt
SECRET=$(cat ~/.askarthur-inbound-email-secret.txt)

# Push to both sides — order matters: update Worker first so it doesn't
# briefly send the old secret to a function that's already rejecting it.
echo "$SECRET" | (cd apps/cloudflare-email-worker && pnpm wrangler secret put INBOUND_EMAIL_WEBHOOK_SECRET)
supabase secrets set --project-ref rquomhcgnodxzkhokwni INBOUND_EMAIL_WEBHOOK_SECRET="$SECRET"
```

Briefly during the swap (~30s) the Edge Function may 401 the Worker's POSTs. Inbound emails arriving in that window will fail the forward — Cloudflare doesn't retry, so they're lost. Schedule rotations during a quiet window if this matters.

## Cost model

| Component                                  | Cost                                                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Cloudflare Registrar (annual)              | A$16/year                                                                                            |
| Cloudflare Email Routing                   | A$0 (free tier)                                                                                      |
| Cloudflare Worker                          | A$0 (100k req/day free tier; we're at <500/day)                                                      |
| Supabase Edge Function                     | A$0 (within existing free tier, 500k invocations/mo)                                                 |
| Voyage 3 embedding (per email, downstream) | ~A$0.00006                                                                                           |
| Claude per email                           | **A$0** — Worker writes raw text directly to `feed_items`; Wave-3 clustering batches any Claude work |
| **Total recurring**                        | **A$0/mo** (plus A$16/year for the domain)                                                           |

A `feature_brakes.intel_inbound_email` row is **not** required at MVP because no Claude is in the per-email path. PR-A4 (deferred) would add it as defense-in-depth once we observe baseline volume.

## Failure modes

| Symptom                                                                                 | Cause                                                                                                     | Recovery                                                                                          |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Edge Function 401 from Worker                                                           | Worker secret diverged from Edge Function secret                                                          | Re-run secret rotation above; both sides must match                                               |
| Edge Function 422                                                                       | Cloudflare changed wrapper-redirect host & we no longer resolve to a valid URL → Zod fails on `url` field | Add new host to `TRACKING_HOSTS` in `apps/cloudflare-email-worker/src/index.ts`                   |
| Edge Function 204 with kill switch ON                                                   | `ENABLE_INTEL_INBOUND_EMAIL` flag drifted                                                                 | `supabase secrets list --project-ref rquomhcgnodxzkhokwni`; re-set to `true`                      |
| Edge Function deploy fails with "Could not find version of '@zod/zod' that matches '3'" | JSR's @zod/zod is v4-only                                                                                 | Already fixed: import is `npm:zod@3.23.8`                                                         |
| Edge Function returns "Missing authorization header"                                    | Forgot `--no-verify-jwt` flag on `supabase functions deploy`                                              | Re-deploy with `--no-verify-jwt`                                                                  |
| Worker `postal-mime parse failed`                                                       | Malformed MIME from an upstream                                                                           | `QUARANTINE_FORWARDER` route forwards raw message to `ops@askarthur.au`; not yet wired up at MVP  |
| `feed_items` constraint violation                                                       | A new `+ingest` tag was added without an `inbound_<tag>` slug in `feed_items_source_check`                | Ship a follow-up migration extending the allowlist (mirror v128)                                  |
| Routing rule shows but no email arrives                                                 | Subaddressing is OFF, or the rule was created with the literal `+ingest` suffix instead of just the tag   | Settings → "Enable subaddressing" ON; recreate rule with custom address = tag only (no `+ingest`) |

## Related

- Migration `v128_inbound_email_sources` — allowlist + RPC update.
- `pipeline/scrapers/scamwatch_alerts.py` — existing HTML scrape; the email path becomes the canonical Scamwatch source once subscribed (HTML scrape can be retired or kept as backfill).
- `docs/system-map/background-workers.md` — full background-worker inventory.
- `apps/cloudflare-email-worker/src/index.ts` — Worker source (TS).
- `supabase/functions/intel-inbound-email/index.ts` — Edge Function source (Deno TS).
