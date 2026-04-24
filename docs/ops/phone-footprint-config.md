# Phone Footprint — Operational Config Checklist

**Purpose.** Single source of truth for every env var, feature flag, Stripe
SKU, third-party account, UI integration point, and compliance artefact
that Phone Footprint depends on. If the UI needs a new toggle, a flag
needs flipping, or a vendor key needs provisioning — it goes here.

Referenced from [CLAUDE.md](../../CLAUDE.md) Quick Reference. Keep updated
each sprint.

**Status legend**

| Marker | Meaning                                                         |
| ------ | --------------------------------------------------------------- |
| ✅     | Live / configured / shipped                                     |
| ⏳     | In progress this sprint                                         |
| ❌     | Not started                                                     |
| 🔒     | Blocked — waiting on external dep (DPA, vendor approval, legal) |

---

## 1. Feature flags

All Phone Footprint flags default **OFF** in production. They gate orthogonal
subsystems so they can be rolled out independently as each one passes
end-to-end validation.

| Flag (env var)                            | Default | Gates                                                                                                           | Flip when                                                                                                                                            |
| ----------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_FF_PHONE_FOOTPRINT_CONSUMER` | `false` | The consumer UI surface (report page, free-tier CTA, /api/phone-footprint/[msisdn] returns 503 when off)        | Sprint 2 dogfood complete, UI review signed off                                                                                                      |
| `FF_VONAGE_ENABLED`                       | `false` | Vonage Number Insight v2 + CAMARA SIM/Device Swap provider calls. Server-only — the API key is a server secret. | Vonage account active + NI fraud_score tested in staging. CAMARA can go live later; provider gracefully degrades pillar 4 if CAMARA not provisioned. |
| `FF_LEAKCHECK_ENABLED`                    | `false` | LeakCheck phone-breach lookup (pillar 2). Server-only.                                                          | LeakCheck DPA (APP 8 overseas disclosure) signed.                                                                                                    |
| `FF_TWILIO_VERIFY_ENABLED`                | `false` | `/api/phone-footprint/verify/{start,check}` endpoints and any downstream "full" tier access.                    | `TWILIO_VERIFY_SERVICE_SID` provisioned + one end-to-end OTP test successful.                                                                        |

**Rollout order (recommended):**

1. `FF_TWILIO_VERIFY_ENABLED` (foundation — APP 3.5 spine)
2. `FF_VONAGE_ENABLED` (adds pillars 3 + 4)
3. `FF_LEAKCHECK_ENABLED` (adds pillar 2)
4. `NEXT_PUBLIC_FF_PHONE_FOOTPRINT_CONSUMER` (user-facing — flip last)

Flipping the consumer flag without the other three doesn't brick the
product — the orchestrator's graceful-degradation rule redistributes pillar
weights and surfaces `coverage: "disabled"` per missing provider. But the
value-to-user is diminished, so it's worth waiting until at least Vonage is
live before the consumer flip.

---

## 2. Environment variables

### Already present in the repo (reused)

| Env var                                      | Status | Used by                                                    |
| -------------------------------------------- | ------ | ---------------------------------------------------------- |
| `TWILIO_ACCOUNT_SID`                         | ✅     | Twilio Lookup v2 (phone provider pillar 5) + Twilio Verify |
| `TWILIO_AUTH_TOKEN`                          | ✅     | Same                                                       |
| `IPQUALITYSCORE_API_KEY`                     | ✅     | IPQS phone provider (pillar 3 fallback)                    |
| `HIBP_API_KEY`                               | ✅     | Email-breach leg of pillar 2 (HIBP dropped phone)          |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN`          | ✅     | Rate limits, provider caches, ownership-proof session      |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | ✅     | Schema writes, RPC calls                                   |
| `TURNSTILE_SECRET_KEY`                       | ✅     | Anon-tier Turnstile challenge                              |

### New for Phone Footprint

| Env var                     | Status | What                                                                                                                                                                                         | Sprint 1/2 blocker?                                  |
| --------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `PHONE_FOOTPRINT_PEPPER`    | ❌     | HMAC pepper for `hashMsisdn()`. Generate once (`openssl rand -hex 32`), store in Supabase Vault + Vercel env. Must be set in prod — `hashMsisdn` throws if missing in `NODE_ENV=production`. | **Yes** — lookup route can't run in prod without it. |
| `TWILIO_VERIFY_SERVICE_SID` | ❌     | Twilio console → Verify → Services → Create Service → copy SID (starts `VA...`).                                                                                                             | Blocks `FF_TWILIO_VERIFY_ENABLED` flip               |
| `VONAGE_API_KEY`            | ❌     | Vonage Dashboard → API settings. Basic auth for Number Insight v2 + `fraud_score`.                                                                                                           | Blocks `FF_VONAGE_ENABLED` flip                      |
| `VONAGE_API_SECRET`         | ❌     | Same page as API_KEY.                                                                                                                                                                        | Same                                                 |
| `VONAGE_APPLICATION_ID`     | 🔒     | Vonage Dashboard → Applications → new Application with SIM Swap + Device Swap capabilities enabled. Only needed for pillar 4 (CAMARA); pillar 3 works without it.                            | Pillar 4 coverage reports `pending` when absent.     |
| `VONAGE_PRIVATE_KEY`        | 🔒     | Downloaded once at Application creation. Multi-line PEM — use `\n` literal in Vercel env.                                                                                                    | Same as VONAGE_APPLICATION_ID                        |
| `LEAKCHECK_API_KEY`         | 🔒     | leakcheck.io account. Gated by DPA.                                                                                                                                                          | Blocks `FF_LEAKCHECK_ENABLED` flip                   |

### Stripe Price IDs

All new products need to be created in the Stripe Dashboard first, then
the Price IDs pasted into Vercel env. Pricing per
[`docs/plans/phone-footprint-v2.md`](../plans/phone-footprint-v2.md) §8.

| Env var                                   | Status | Stripe product     | Price                                       |
| ----------------------------------------- | ------ | ------------------ | ------------------------------------------- |
| `STRIPE_PRICE_FOOTPRINT_PERSONAL_MONTHLY` | ❌     | Footprint Personal | AUD $7.99/mo                                |
| `STRIPE_PRICE_FOOTPRINT_PERSONAL_ANNUAL`  | ❌     | Footprint Personal | AUD $79/yr                                  |
| `STRIPE_PRICE_FOOTPRINT_FAMILY_MONTHLY`   | ❌     | Footprint Family   | AUD $12.99/mo                               |
| `STRIPE_PRICE_FOOTPRINT_FAMILY_ANNUAL`    | ❌     | Footprint Family   | AUD $129/yr                                 |
| `STRIPE_PRICE_FLEET_STARTER_MONTHLY`      | ❌     | Fleet Starter      | AUD $999/mo                                 |
| `STRIPE_PRICE_FLEET_STARTER_ANNUAL`       | ❌     | Fleet Starter      | AUD $9,990/yr                               |
| `STRIPE_PRICE_FLEET_ENTERPRISE`           | ❌     | Fleet Enterprise   | quote — manual invoicing, from AUD $60k ACV |

Existing Pro / Business prices (`STRIPE_PRICE_PRO_MONTHLY` etc.) are
unchanged. Sprint 3 wires the Stripe webhook to call
`sync_phone_footprint_entitlements` on the new price IDs — not before.

---

## 3. Third-party vendor setup

Each row is a self-contained checklist. Anything ticked ✅ is done; ❌
still needs doing.

### Vendor onboarding — top-level checklist

Quick reference. Detail steps for each item live in the subsections below.

- [ ] **PHONE_FOOTPRINT_PEPPER** env set in Vercel (Production + Preview) → see "Pepper generation" below.
- [ ] **Vonage_Key → VONAGE_API_KEY** rename in Vercel; pair `VONAGE_API_SECRET` → see "Vercel env hygiene" below.
- [ ] **Twilio Verify Service SID** provisioned → see "Twilio Verify" below.
- [ ] **LeakCheck DPA + API key** → see "LeakCheck" below.
- [ ] **7 Stripe Products + Prices** created and pasted into env → see "Stripe" below.
- [ ] **Resend `RESEND_FROM_EMAIL`** configured → see "Resend" below.
- [ ] **PADDLE\_\* envs deleted** from Vercel → see "Vercel env hygiene" below.

### Pepper generation (PHONE_FOOTPRINT_PEPPER)

`hashMsisdn()` uses HMAC-SHA256 with this pepper. Without it the lookup
route throws on every call in production.

```bash
# 1. Generate a 256-bit pepper (one-time, never regenerate without
#    coordinating a re-hash window — every existing msisdn_hash row
#    becomes meaningless if the pepper changes).
openssl rand -hex 32
# → e.g. a1b2c3d4...64-char hex

# 2. Store in Supabase Vault (canonical home; vault values are
#    encrypted at rest and audit-logged).
#    Supabase Studio → Project Settings → Vault → New secret
#    Name: phone_footprint_pepper
#    Value: <paste>

# 3. Mirror to Vercel env so the application server can read it without
#    a Vault round-trip on every request:
#    Vercel → Project Settings → Environment Variables → Add
#    Name: PHONE_FOOTPRINT_PEPPER
#    Value: <same paste>
#    Environments: Production + Preview (skip Development — local dev
#                  uses the deterministic dev fallback in normalize.ts)
```

**Rotation policy.** Don't rotate without a planned re-hash. If you must
(suspected pepper leak): generate the new pepper, deploy code that
reads BOTH old and new for a window, re-hash all msisdn_hash columns
via a backfill script, then swap to new-only. Single-shot rotation
will break every existing monitor's cross-IP detection key and every
ownership-proof Upstash session. Plan an hour-long maintenance window.

### Vercel env hygiene

**Delete orphaned Paddle envs** (v59 dropped Paddle from the codebase):

```
Vercel → Project Settings → Environment Variables
Search "PADDLE" → delete:
  - PADDLE_API_KEY
  - PADDLE_WEBHOOK_SECRET
  - PADDLE_PRO_PRICE_ID
  - PADDLE_ENTERPRISE_PRICE_ID
```

These were warned about in PR #18's Vercel build logs as "set in
project but missing from turbo.json". They're orphaned — no code
reads them. Leaving them around is harmless but pollutes the env
surface and the turbo.json warning list.

**Rename misnamed Vonage env**:

```
Vercel → Project Settings → Environment Variables
Find "Vonage_Key" → rename → VONAGE_API_KEY

If a paired secret exists under similarly-misnamed casing (e.g.,
"Vonage_Secret"), rename → VONAGE_API_SECRET.
```

The codebase reads `process.env.VONAGE_API_KEY` (uppercase, underscore-
separated) per the convention used everywhere else. Until renamed, the
Vonage provider returns `available: false` and the composite scorer
falls back to IPQS for pillar 3.

### Twilio Verify (consumer OTP)

- [ ] In Twilio console, navigate to **Verify → Services → Create Service**.
- [ ] Name: `askarthur-phone-footprint`. Friendly Name shown in SMS: `Ask Arthur`.
- [ ] Locale: `en`. Code length: 6 digits. Default.
- [ ] Copy the Service SID (starts `VA...`) → Vercel env `TWILIO_VERIFY_SERVICE_SID` in prod + preview.
- [ ] One end-to-end smoke test from a dev account (see §6 below).
- [ ] Flip `FF_TWILIO_VERIFY_ENABLED=true` in staging first, confirm, then prod.

**Cost:** ~AUD $0.10 per SMS in Australia. Hard cap: `pf_verify_otp_phone`
bucket (3/day/phone) × estimated Verify users × 30 days. Day-one budget
alert: see §4 below.

### Vonage (pillars 3 + 4)

**NI v2 (pillar 3) — minimum viable:**

- [ ] Vonage Dashboard → Settings → API Settings → copy **API key** + **API secret**.
- [ ] Verify account has Number Insight v2 entitlement (standard on paid accounts).
- [ ] Set `VONAGE_API_KEY` + `VONAGE_API_SECRET` in Vercel env.
- [ ] Smoke-test: `curl -u $VONAGE_API_KEY:$VONAGE_API_SECRET -X POST https://api.nexmo.com/v2/ni -d '{"type":"phone","phone":"+61412345678","insights":["fraud_score"]}' -H 'Content-Type: application/json'`.

**CAMARA SIM Swap + Device Swap (pillar 4) — optional add-on, can come later:**

- [ ] Request access from Vonage Sales to **SIM Swap API** and **Device Swap API** (Aduna / AU carrier coverage).
- [ ] On approval, Dashboard → **Applications → Create new application**. Enable "SIM Swap" + "Device Swap" capabilities.
- [ ] Download the generated private key (PEM). **Save securely** — Vonage does not retain a copy.
- [ ] Set `VONAGE_APPLICATION_ID` (UUID) + `VONAGE_PRIVATE_KEY` (PEM, use `\n` literal for newlines in Vercel env).
- [ ] Without these two, the provider returns `pillar 4: available=false`, `coverage.vonage="pending"`. Product still works — scorer redistributes weight across pillars 1, 2, 3, 5.

**Cost:** ~USD $0.04 NI + $0.04 SIM Swap + $0.04 Device Swap per
lookup = ~USD $0.12 per paid-tier footprint. Amortised ~AUD $0.18.

### LeakCheck (pillar 2)

- [ ] 🔒 **DPA required first** — Lithuanian-jurisdiction provider. APP 8
      overseas-disclosure language needs review from AU privacy counsel.
      Model DPA: leakcheck.io/dpa.
- [ ] After DPA signed: leakcheck.io → Account → API keys → generate one.
- [ ] Set `LEAKCHECK_API_KEY` in Vercel env.
- [ ] Flip `FF_LEAKCHECK_ENABLED=true`. Without it, the provider returns
      `pillar 2: available=false`; scorer redistributes weight.

**Cost:** flat-rate plan (~USD $179/quarter for enterprise). Per-call
cost at scale is amortised ~AUD $0.003.

### Stripe (billing)

**One-time product creation.** Stripe Dashboard → Products → New
Product. Repeat 7 times per the table below. **Always set `Tax behavior:
Inclusive`** (AU GST inclusive) and **Currency: AUD**.

| Product name       | Recurring           | Price              | Suggested ID slug          | Env var                                   |
| ------------------ | ------------------- | ------------------ | -------------------------- | ----------------------------------------- |
| Footprint Personal | Monthly             | AUD $7.99          | `pf_personal_monthly`      | `STRIPE_PRICE_FOOTPRINT_PERSONAL_MONTHLY` |
| Footprint Personal | Yearly              | AUD $79            | `pf_personal_annual`       | `STRIPE_PRICE_FOOTPRINT_PERSONAL_ANNUAL`  |
| Footprint Family   | Monthly             | AUD $12.99         | `pf_family_monthly`        | `STRIPE_PRICE_FOOTPRINT_FAMILY_MONTHLY`   |
| Footprint Family   | Yearly              | AUD $129           | `pf_family_annual`         | `STRIPE_PRICE_FOOTPRINT_FAMILY_ANNUAL`    |
| Fleet Starter      | Monthly             | AUD $999           | `pf_fleet_starter_monthly` | `STRIPE_PRICE_FLEET_STARTER_MONTHLY`      |
| Fleet Starter      | Yearly              | AUD $9,990         | `pf_fleet_starter_annual`  | `STRIPE_PRICE_FLEET_STARTER_ANNUAL`       |
| Fleet Enterprise   | One-off / per quote | (manual invoicing) | `pf_fleet_enterprise`      | `STRIPE_PRICE_FLEET_ENTERPRISE`           |

For each created Price:

```
1. Stripe Dashboard → Products → click the product → click the price row
2. Copy the price ID (starts `price_...`)
3. Vercel → Project Settings → Environment Variables → Add
   Name: <env var from table>
   Value: price_xxx
   Environments: Production + Preview
```

**Metadata required on subscription creation** (caller responsibility —
the checkout endpoint sets these). Without them the webhook logs a
warn and skips:

| SKU type | Required metadata         | Why                                   |
| -------- | ------------------------- | ------------------------------------- |
| Consumer | `metadata.user_id` (UUID) | links entitlement to user_profiles.id |
| Fleet    | `metadata.org_id` (UUID)  | links entitlement to organizations.id |

Webhook code: `apps/web/app/api/stripe/webhook/route.ts` →
`upsertPhoneFootprintSubscription`. SKU registry + entitlement
templates: `apps/web/lib/phoneFootprintSkus.ts`. Safe to ship before
envs are set — with no price IDs present, every webhook runs the
B2B path unchanged.

### Resend (email delivery)

Already configured for `RESEND_API_KEY`. The PDF email and alert
dispatch paths additionally need a verified `from` address.

```
1. Resend Dashboard → Domains → Add domain
   Domain: askarthur.au (or a subdomain like notify.askarthur.au)

2. Add the published DKIM/SPF/DMARC DNS records to Cloudflare
   (or wherever DNS lives). Wait for the green checkmark in Resend.

3. Vercel → Project Settings → Environment Variables → Add
   Name: RESEND_FROM_EMAIL
   Value: alerts@askarthur.au   (or whichever verified address)
   Environments: Production + Preview

4. Smoke test:
   curl -X POST https://api.resend.com/emails \
     -H "Authorization: Bearer $RESEND_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"from":"alerts@askarthur.au","to":"you@example.com",
          "subject":"Resend smoke","html":"<p>OK</p>"}'
```

Without `RESEND_FROM_EMAIL`, the alert dispatch and PDF email Inngest
functions silently no-op (logged as warn). The rest of the product
keeps working — alerts just don't reach the user's inbox.

**Cost:** Pro $20/month for 50,000 emails. PAYG above $0.001/email.
For phone-footprint alerts, expect ≤ 1 email per monitor per refresh
(monthly cadence default), so a Personal user is ~5 emails/month, a
Family user ~25, a Fleet Starter org ~5,000 — well within Pro.

---

## 4. Cost / budget alerts

Set these BEFORE flipping `NEXT_PUBLIC_FF_PHONE_FOOTPRINT_CONSUMER`:

- [ ] Upstash Ratelimit analytics dashboard: enable alerts for 80% of the
      daily cap on `askarthur:pf:otp:phone`, `askarthur:pf:otp:ip`.
- [ ] Supabase admin → cost_telemetry view → daily digest email with
      `WHERE feature='phone_footprint'`. Alert if daily total > AUD $30.
- [ ] Vonage Dashboard → Spending alert at USD $50/day.
- [ ] Twilio → Usage trigger for Verify at AUD $100/day.

---

## 5. UI integration points

Places in `apps/web` where Phone Footprint shows up. All are currently
behind `NEXT_PUBLIC_FF_PHONE_FOOTPRINT_CONSUMER=false`, so they're
invisible to users until the flag flips.

| Where                                                                   | What                                                                            | Status      |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------- |
| `apps/web/app/api/phone-footprint/[msisdn]/route.ts`                    | Primary lookup endpoint                                                         | ✅ Sprint 1 |
| `apps/web/app/api/phone-footprint/verify/{start,check}/route.ts`        | OTP endpoints                                                                   | ✅ Sprint 1 |
| `apps/web/app/api/phone-footprint/[id]/pdf/route.ts`                    | PDF export (enqueues Inngest render)                                            | ✅ Sprint 3 |
| `apps/web/app/api/inngest/functions/phone-footprint-pdf.ts`             | Inngest function — render + R2 upload + email                                   | ✅ Sprint 3 |
| `apps/web/app/api/inngest/functions/phone-footprint-refresh.ts`         | Inngest cron + per-monitor refresh worker                                       | ✅ Sprint 4 |
| `apps/web/app/api/inngest/functions/phone-footprint-vonage-backfill.ts` | Vonage CAMARA-landed pager + per-monitor backfill                               | ✅ Sprint 5 |
| `apps/web/lib/region.ts`                                                | Caller-country detection + Vonage CAMARA country set + regional coverage helper | ✅ Sprint 6 |
| `packages/scam-engine/src/phone-footprint/providers/carrier-drift.ts`   | Pillar 4 fallback — Twilio Lookup carrier-string + line-type delta              | ✅ Sprint 6 |
| `apps/extension/src/lib/phone-detect.ts`                                | Extension-side phone-in-selection detector                                      | ✅ Sprint 5 |
| `apps/extension/src/entrypoints/background.ts` (PF branch)              | Right-click "Check with Ask Arthur" → web app for phone numbers                 | ✅ Sprint 5 |
| `apps/web/app/phone-footprint/LookupForm.tsx` (auto-submit)             | Reads ?msisdn=&src=ext, auto-fires lookup on mount                              | ✅ Sprint 5 |
| `apps/web/app/manifest.ts` (shortcuts)                                  | PWA shortcut to /app/phone-footprint/monitors                                   | ✅ Sprint 5 |
| `apps/web/lib/phone-footprint/alert-dispatch.ts`                        | Email + HMAC-signed webhook delivery                                            | ✅ Sprint 4 |
| `apps/web/app/api/phone-footprint/monitors/route.ts`                    | Monitors list + create (OTP-gated, entitlement-checked)                         | ✅ Sprint 4 |
| `apps/web/app/api/phone-footprint/monitors/[id]/route.ts`               | Monitor read / patch / soft-delete                                              | ✅ Sprint 4 |
| `apps/web/app/api/phone-footprint/monitors/[id]/alerts/route.ts`        | Per-monitor alerts history (paginated)                                          | ✅ Sprint 4 |
| `apps/web/app/api/stripe/webhook/route.ts`                              | PF SKU branch (entitlements upsert + cancel)                                    | ✅ Sprint 3 |
| `apps/web/lib/phoneFootprintSkus.ts`                                    | SKU registry + entitlement templates                                            | ✅ Sprint 3 |
| `apps/web/app/phone-footprint/[id]/page.tsx`                            | Consumer report page                                                            | ⏳ Sprint 2 |
| `apps/web/app/phone-footprint/page.tsx`                                 | Landing / lookup form                                                           | ✅ Sprint 2 |
| `apps/web/app/admin/phone-footprint/page.tsx`                           | Admin metrics panel                                                             | ⏳ Sprint 2 |
| `apps/web/app/app/phone-footprint/monitors/page.tsx`                    | Saved-numbers dashboard (list + add/remove flow)                                | ✅ Sprint 4 |
| `apps/web/app/app/phone-footprint/monitors/[id]/page.tsx`               | Per-monitor detail                                                              | ❌ Sprint 5 |
| `apps/web/app/pricing/page.tsx`                                         | Add Footprint tiers to pricing                                                  | ❌ Sprint 3 |
| `apps/web/components/FootprintBandBadge.tsx`                            | Reusable `safe/caution/high/critical` chip                                      | ⏳ Sprint 2 |
| `apps/web/components/CoverageChips.tsx`                                 | Per-provider coverage badges (live/pending/degraded/disabled)                   | ⏳ Sprint 2 |
| Chrome extension                                                        | Right-click lookup (defer)                                                      | ❌ Sprint 5 |
| Mobile app (Expo)                                                       | Phone Footprint tab + SIM Swap Heartbeat push                                   | ❌ Sprint 5 |

**When adding a new UI entry point**: verify `featureFlags.phoneFootprintConsumer`
first, match the pattern in `apps/web/app/api/phone-footprint/[msisdn]/route.ts`.

---

## 6. End-to-end validation checklist (before each flag flip)

### Before `FF_TWILIO_VERIFY_ENABLED=true` (staging then prod)

- [ ] `TWILIO_VERIFY_SERVICE_SID` set in staging.
- [ ] `POST /api/phone-footprint/verify/start` with body `{"msisdn":"<your phone>"}` returns `{"ok":true,"status":"pending"}`.
- [ ] SMS arrives on your phone within 20s.
- [ ] `POST /api/phone-footprint/verify/check` with the code returns `{"approved":true}`.
- [ ] `user_profiles.phone_verified_at` is stamped for your user.
- [ ] Upstash key `pf:owner:{user_id}:{msisdn_hash}` exists with 30-day TTL.
- [ ] `cost_telemetry` has a row: feature=`phone_footprint`, provider=`twilio_verify`, unit_cost ≈ $0.10.

### Before `FF_VONAGE_ENABLED=true`

- [ ] `VONAGE_API_KEY` + `VONAGE_API_SECRET` set.
- [ ] Direct curl smoke test against NI v2 returns `fraud_score`.
- [ ] (Optional) `VONAGE_APPLICATION_ID` + `VONAGE_PRIVATE_KEY` set if CAMARA enabled.
- [ ] `GET /api/phone-footprint/<your-verified-phone>` returns `pillars.reputation.available: true` + `coverage.vonage: "live"`.
- [ ] `telco_api_usage` has rows for endpoint `v2/ni`.

### Before `FF_LEAKCHECK_ENABLED=true`

- [ ] LeakCheck DPA signed.
- [ ] `LEAKCHECK_API_KEY` set.
- [ ] `GET /api/phone-footprint/<your-verified-phone>` returns `pillars.breach.available: true` + `coverage.leakcheck: "live"`.
- [ ] Privacy policy updated with LeakCheck as an Overseas Recipient (APP 8).

### Before `NEXT_PUBLIC_FF_PHONE_FOOTPRINT_CONSUMER=true`

- [ ] All three server-side flags live (or graceful-degrade validated).
- [ ] `/phone-footprint/[id]` page renders for a sample footprint.
- [ ] Admin `/admin/phone-footprint` panel loads.
- [ ] Privacy policy v2 with APP 1.7 ADM notice + APP 8 Overseas Recipients published.
- [ ] Legal sign-off on marketing copy ("SIM Swap Heartbeat", "phone footprint", etc).
- [ ] `cost_telemetry` daily spend < AUD $30 threshold under test load.

### Before the first Stripe Phone Footprint checkout

Even with `NEXT_PUBLIC_FF_PHONE_FOOTPRINT_CONSUMER=true`, the billing
flow doesn't work until:

- [ ] 7 Stripe Products + Prices created (see §2 Stripe Price IDs)
- [ ] Price IDs pasted into Vercel env
- [ ] Checkout creation sets `metadata.user_id` (consumer) or `metadata.org_id` (fleet)
- [ ] `customer.subscription.created` webhook → `phone_footprint_entitlements` row inserted with correct saved_numbers_limit / monthly_lookup_limit / features JSONB
- [ ] Cancel flow → row status flips to `canceled`
- [ ] Resend from-address configured so the PDF-email Inngest function can send (`RESEND_API_KEY` + `RESEND_FROM_EMAIL`)

---

## 7. Compliance artefacts

| Artefact                                                           | Owner           | Status                                                                               | Due                                                                      |
| ------------------------------------------------------------------ | --------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Privacy policy v2 (APP 1.7 ADM notice + APP 8 Overseas Recipients) | Legal           | ❌                                                                                   | Before consumer flag flip; hard deadline APP 1.7 is **10 December 2026** |
| "How we score your footprint" explainer page                       | Product + Legal | ❌                                                                                   | Same                                                                     |
| LeakCheck DPA                                                      | Legal           | 🔒                                                                                   | Before `FF_LEAKCHECK_ENABLED` flip                                       |
| Vonage DPA                                                         | Legal           | ❌                                                                                   | Before `FF_VONAGE_ENABLED` flip                                          |
| IPQS DPA                                                           | Legal           | Partial — existing usage predates this product; confirm coverage for the new purpose | Before consumer flag flip                                                |
| NDB runbook (`docs/compliance/ndb-runbook.md`)                     | Product         | ❌                                                                                   | Sprint 9                                                                 |
| SPF s58BT gateway intent-to-apply statement                        | Founder         | ❌                                                                                   | Sprint 9                                                                 |

---

## 8. Database state

### Schema

All Sprint 1 migrations applied to prod project `rquomhcgnodxzkhokwni`:

- `v75_phone_footprint_core` ✅
- `v76_vonage_telco` ✅
- `v77_phone_verified_fleet` ✅

Plus the parallel db-hygiene migration: `v75_p0_security_hygiene` ✅.

### Retention crons

Two retention functions ship in v75 but are not yet scheduled:

- `anonymise_expired_footprints()` — call daily, deletes `msisdn_e164`
  from `phone_footprints` rows past `expires_at + 7 days`.
- `sweep_inactive_monitors()` — call daily, flips monitor `status` to
  `consent_lapsed` when `consent_expires_at < NOW()`.

**Needs scheduling in Sprint 4** — Inngest cron `cron("0 3 * * *")` is
the target. Before that, run manually via Supabase SQL editor weekly.

### Key seed data (none required)

All tables ship empty. `phone_footprint_entitlements` populates from
Stripe webhook. `telco_provider_health` populates from the Sprint 10 health
cron. No migration data backfill needed.

---

## 9. Sprint ledger

| Sprint | Shipped                                                                                                                                                             | Status |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1      | v75/v76/v77 migrations, provider package (5 providers incl. real Vonage), Twilio Verify OTP                                                                         | ✅     |
| 2      | Consumer UI (landing + report components), admin ops panel, config doc + CLAUDE.md cross-link                                                                       | ✅     |
| 3      | Claude explanation, Stripe PF webhook → entitlements RPC, PDF export (react-pdf + R2 + Resend)                                                                      | ✅     |
| 4      | Monitors CRUD, Inngest hourly cron + per-monitor refresh worker, email + HMAC-signed webhook alerts, saved-numbers dashboard                                        | ✅     |
| 5      | Extension right-click → web-app footprint, Vonage CAMARA-landed Inngest backfill (pager + per-monitor), PWA shortcuts                                               | ✅     |
| 6      | International launch foundations: caller-country detection, regional coverage in lookup response, carrier-drift fallback for pillar 4, international marketing copy | ✅     |
| 7      | UK soft launch + Fleet Starter foundations: SSO (Clerk/WorkOS), bulk CSV, per-org webhooks                                                                          | ⏳     |
| 8      | Fleet audit trail, Enterprise quote/invoice flow                                                                                                                    | ❌     |
| 9      | Compliance cutover (APP 1.7 ADM notice, NDB runbook, SPF s58BT statement)                                                                                           | ❌     |
| 10     | Admin observability deepening, consumer launch                                                                                                                      | ❌     |

## 10. International launch — coverage matrix

Sprint 6 pivoted the launch geography. AU SIM swap is blocked on
Vonage adding Australia to its Network Registry (Telstra is live on
Aduna as of 21 Nov 2025 but no CPaaS partner has provisioned the
signal to end customers yet — see Sprint 6 commit notes for full
research). Rather than wait, we ship internationally first.

### Per-country signal availability

| Country                      | Pillar 1 (scam reports)     | Pillar 2 (breach) | Pillar 3 (reputation) | Pillar 4 (SIM swap)         | Pillar 5 (identity) | Notes                                                                                                                            |
| ---------------------------- | --------------------------- | ----------------- | --------------------- | --------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **GB** (UK)                  | ✅ low corpus               | ✅                | ✅ Vonage NI          | ✅ Vonage CAMARA            | ✅ Twilio           | **First international launch target.** UK GDPR ≈ AU APP — minimal compliance lift. SIM swap fraud high salience in news.         |
| **US**                       | ✅ low corpus               | ✅                | ✅ Vonage NI          | ✅ Vonage CAMARA            | ✅ Twilio           | Sprint 8 — needs CCPA/CPRA disclosure review.                                                                                    |
| **CA**                       | ✅ low corpus               | ✅                | ✅ Vonage NI          | ✅ Vonage CAMARA            | ✅ Twilio           | Sprint 8 — PIPEDA close to GDPR.                                                                                                 |
| **DE/FR/IT/ES/NL**           | ✅ low corpus               | ✅                | ✅ Vonage NI          | ✅ Vonage CAMARA            | ✅ Twilio           | Sprint 10 — translated UI optional. GDPR standard.                                                                               |
| **BR**                       | ✅ low corpus               | ✅                | ✅ Vonage NI          | ✅ Vonage CAMARA            | ✅ Twilio           | Sprint 10+ — LGPD + Portuguese translation.                                                                                      |
| **AU**                       | ✅ **strong corpus (moat)** | ✅                | ✅ Vonage NI          | ⚠️ carrier-drift proxy only | ✅ Twilio           | Telstra direct + Optus/TPG via Aduna are the path. Pillar 4 currently runs the Twilio-deltas fallback for OTP-verified monitors. |
| **JP/IN/ZA/everywhere else** | ⚠️ no corpus                | ✅                | ✅ Vonage NI          | ⚠️ carrier-drift proxy only | ✅ Twilio           | Lookup works; localised market entry deferred.                                                                                   |

### What Sprint 6 shipped to enable this

- `apps/web/lib/region.ts` — reads Vercel's `x-vercel-ip-country` header,
  exports `VONAGE_CAMARA_COUNTRIES` set, returns a `RegionalCoverage`
  object describing whether the caller's country has carrier-authoritative
  SIM swap or only the carrier-drift proxy.
- `/api/phone-footprint/[msisdn]` adds `regional` to the response payload
  so the UI can render honest per-country copy.
- `packages/scam-engine/src/phone-footprint/providers/carrier-drift.ts`
  — pillar 4 fallback pure function. Runs inside the orchestrator after
  the main fan-out completes IF Vonage CAMARA didn't fire AND a previous
  footprint exists (refresh path). Compares this run's Twilio identity
  pillar to prev's; emits `sim_swap` pillar with score 0–100 and
  confidence 0.5 (vs Vonage's 0.95).
- `apps/web/app/phone-footprint/page.tsx` — landing copy refreshed:
  drops AU-specific framing, leads with universal "what does your
  number know about you?", surfaces a coverage-note callout for users
  in non-CAMARA countries.

### What's NOT yet shipped for international launch

- **Multi-currency Stripe Prices** — still AUD-only. Need GBP/USD/CAD
  variants (Sprint 7).
- **Per-jurisdiction privacy policy disclosures** — UK GDPR /
  CCPA-CPRA / PIPEDA / LGPD paragraphs not yet drafted (Sprint 7-8).
- **DSAR + erasure endpoints** — UK GDPR has 30-day response window;
  needs an export endpoint per user + hard-delete cascade (Sprint 7).
- **Country-aware consent capture at signup** — currently single AU
  consent flow; international users get the same flow which is
  acceptable but not optimal.

### Initial launch cohort — UK, Canada, Brazil

First Vonage Network Registry application targets **United Kingdom,
Canada, and Brazil**. Rationale:

- **UK**: ~95% mobile coverage via Vonage CAMARA (BT/EE, Vodafone UK,
  O2). UK GDPR ≈ AU APP — smallest compliance lift. High SIM-swap
  fraud salience in UK consumer press.
- **Canada**: ~90% coverage (Rogers, Bell, Telus). PIPEDA close to
  GDPR, English-speaking, low competitive density.
- **Brazil**: Strong carrier coverage; big market. LGPD compliance
  achievable. Portuguese translation needed before serious marketing
  spend — flagged as a Sprint 10+ investment.

**US deferred**: Verizon requires operator-level per-customer consent
flows in addition to Aduna approval — not proportional to projected US
revenue at launch. Revisit when US waitlist > 500 customers. Partial
US coverage via AT&T + T-Mobile only (no Verizon paperwork) is possible
as a middle path — ~70% US mobile coverage.

**Germany / France / Italy / Netherlands / Spain deferred**: GDPR
compliance is already standard but non-English UIs would need
translation before meaningful traction. Sprint 10+ if Brazil launch
demonstrates translation ROI.

### Vendor status (per the 2026-04-24 research)

| Provider            | AU SIM swap                                 | UK / US / CA / EU / BR SIM swap |
| ------------------- | ------------------------------------------- | ------------------------------- |
| Vonage CAMARA       | ❌ Not in Network Registry                  | ✅ Production, primary path     |
| Telstra direct      | ⏳ Application in progress                  | n/a                             |
| TeleSign (Proximus) | ⚠️ Public docs unclear; sales call required | ✅                              |
| Sinch via Aduna     | ⚠️ Aduna partner; AU provisioning unclear   | ✅ via Aduna                    |
| Infobip via Aduna   | ⚠️ Aduna partner; AU provisioning unclear   | ✅ via Aduna                    |
| Twilio              | ❌ AU explicitly not in country list        | ✅                              |

## 11. Pointers

- **Full sprint plan:** [`docs/plans/phone-footprint-v2.md`](../plans/phone-footprint-v2.md)
- **Migration SQL:** `supabase/migration-v75-phone-footprint-core.sql`, `-v76-vonage-telco.sql`, `-v77-phone-verified-fleet.sql`
- **Code:** `packages/scam-engine/src/phone-footprint/` (orchestrator, scorer, providers, explain, pdf)
- **API routes:** `apps/web/app/api/phone-footprint/` (lookup, verify, pdf)
- **OTP wrapper:** `apps/web/lib/twilioVerify.ts`
- **Stripe SKU registry:** `apps/web/lib/phoneFootprintSkus.ts`
- **PDF Inngest function:** `apps/web/app/api/inngest/functions/phone-footprint-pdf.ts`
- **R2 upload helpers:** `apps/web/lib/r2.ts` (uploadFootprintPdf, getFootprintPdfUrl)
- **Admin dashboard:** `apps/web/app/admin/phone-footprint/page.tsx`

Keep this doc updated. Any new env var, flag, Stripe price, vendor
integration, or UI entry point gets a row here with its status marker.
