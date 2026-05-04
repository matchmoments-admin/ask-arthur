# Ask Arthur Shopfront — Implementation Plan

> **Source spec:** the long-form "Shopfront Build Plan & Feasibility Analysis" attached at project kickoff (TL;DR + sections A–H + recommendations + caveats). That document is the **detailed reference** for every PR — competitor matrices, regulatory framing, per-lookup unit economics, ASCII data flow, code stubs. This plan is the **delta** between that spec and the codebase as it exists today, plus the sequenced build order. Source spec preserved in PR description history of the first PR (TBD).

---

## 1. Context

**Why.** Ask Arthur today serves consumers (`askarthur.au`, Chrome extension, mobile) and B2B threat-feed clients (`/api/v1/*` inside `apps/web`). The merchant side of ecommerce — the AU SME losing money to chargebacks, friendly fraud, refund-as-a-service rings — is unaddressed. Shopify Protect is US-only, Shop Pay-only, fraud/unrecognised-only — leaving AU merchants on Shopify Payments AU with **zero** automated chargeback protection from the platform itself. That is the wedge.

**Outcome.** A merchant-facing Shopify embedded app ("Shopfront") that publishes pre-transaction trust verdicts via `orderRiskAssessmentCreate`, ships Shopify Flow templates, exposes a Polaris dashboard with cluster-graph citations, and (Stage 2) generates Compelling Evidence 3.0 representment packs. Sits as a thin orchestration shell on the existing entity-risk + phone-footprint + threat-feeds core — ~6–9 eng-weeks of net-new code for Stage 1, with 70%+ library reuse `[Estimate]`.

**Source of truth.** The kickoff spec is the per-feature reference (data models, signals, pricing, code stubs, ASCII architecture). This plan adjusts that spec for codebase reality — actual package layout, migration numbering, existing feature-flag conventions — and locks the sequence.

**Strategic anchor.** Ship Stage 1 to the Shopify App Store by **mid-July 2026** to ride the SPF Act 2025 designation news cycle (1 July 2026 — banks/telcos/digital-platforms designated; ecommerce flagged for future designation). Do **not** market Shopfront as "SPF-compliant for ecommerce" (misleading); position as "SPF-aligned methodology" with reasonable expectation of designation. The B2B API team races the SPF date; Shopfront rides the macro narrative.

---

## 1a. Build status (live)

| PR    | Title                                                              | Stage | Status         | Migration |
| ----- | ------------------------------------------------------------------ | ----- | -------------- | --------- |
| **0** | Pre-flight: Shopify Partner setup, Level 2 PII application, counsel | —     | ⏸ not started | —         |
| 1     | scaffold `apps/shopfront` + `packages/shopify-sdk` + flags         | 1     | ⏸ not started | —         |
| 2     | migration v94 — Shopfront tables (shops, verdicts, billing events) | 1     | ⏸ not started | v94       |
| 3     | OAuth + managed installation + offline token storage (pgsodium)    | 1     | ⏸ not started | —         |
| 4     | webhook ingress + HMAC verifier + GDPR mandatory webhooks          | 1     | ⏸ not started | —         |
| 5     | `packages/buyer-trust` verdict engine (cluster + signals + Claude) | 1     | ⏸ not started | —         |
| 6     | Inngest hot-path (`PENDING`) + cold-path (`LOW/MED/HIGH`) fan-out  | 1     | ⏸ not started | —         |
| 7     | Polaris merchant dashboard — install, settings, order detail card  | 1     | ⏸ not started | —         |
| 8     | Shopify Flow templates (3) + Order Status thank-you trust badge    | 1     | ⏸ not started | —         |
| 9     | Shopify Billing API (managed pricing) — Free + Pro + Business      | 1     | ⏸ not started | —         |
| 10    | App Store listing assets + Built for Shopify p95 perf hardening    | 1     | ⏸ not started | —         |
| 11    | migration v95 — `shopfront_disputes` + `shopfront_ce3_evidence`    | 2     | ⏸ not started | v95       |
| 12    | CE 3.0 evidence-pack generator + manual export UI                  | 2     | ⏸ not started | —         |
| 13    | Stripe + Shopify Payments AU dispute auto-submission               | 2     | ⏸ not started | —         |
| 14    | Verifi RDR + Ethoca Alerts ingestion (Business add-on)             | 2     | ⏸ not started | —         |
| 15    | Reshipper / freight-forwarder AU postcode dataset + detector       | 2     | ⏸ not started | —         |
| 16    | LLM-generated dispute narrative classifier (Haiku 4.5)             | 2     | ⏸ not started | —         |
| 17    | VAMP ratio monitor + alerts + brand-mention scraper                | 2     | ⏸ not started | —         |
| 18    | migration v96 — federated cluster bloom filters + RLS              | 3     | ⏸ not started | v96       |
| 19    | Plus-only Checkout UI extension (`block_progress`, FF-gated)       | 3     | ⏸ not started | —         |
| 20    | Federated SHA-256 hashed cluster join API (read-only)              | 3     | ⏸ not started | —         |
| 21    | Vonage AU SIM-swap live integration (`FF_VONAGE_MOCK_MODE` off)    | 3     | ⏸ not started | —         |
| 22    | Guarantee pilot — actuarial reserves, claims, finance integration  | 3     | ⏸ not started | —         |

**Stage 1 target:** Shopify App Store submission mid-July 2026 (~9 eng-weeks from PR 1).
**Stage 2 target:** Q4 2026 (~8 eng-weeks).
**Stage 3 target:** Q2 2027 (~10–12 eng-weeks; gated on 1,000-merchant + 6-month chargeback distribution threshold for guarantee economics).

---

## 1b. Pre-flight blockers (PR 0 — start this week)

These are calendar-bound, not code-bound. They run in parallel with PR 1's scaffold but must be **submitted on day one** because they sit on the critical path for App Store submission.

1. **Shopify Protected Customer Data Level 2 application.** Without Level 2, `customer.email`, `customer.phone`, billing/shipping address, and line items return `null` from API 2022-10 onwards (and from web pixel payloads since 10 Dec 2025). Approval lead time **3–6 weeks** `[Estimate]`. Build against a development store while waiting (development stores have automatic access). Contingency if rejected: degrade to hash-only clustering on IP + device + order metadata; loses ~25% of signal value.
2. **External privacy counsel opinion** on the federated, SHA-256 hash-matched cross-merchant model. Recommended: Maddocks or Gilbert+Tobin (both publish on SPF). Budget **A$8K–A$15K** `[Estimate]`. Opinion must address: (a) APP 6.2(c) "permitted general situation" applicability to fraud investigation across unrelated merchants; (b) APP 8 cross-border accountability for Anthropic US, Twilio US, Vonage UK processors; (c) whether SHA-256 of normalised-email-plus-pepper remains "personal information" under s 6(1).
3. **`shopfront.askarthur.au` "coming soon" page** on a fresh Vercel project (separate from `askarthur.au`) to anchor the brand subdomain and start collecting design-partner waitlist signups.
4. **Shopify Partner Dashboard app draft** — register the app, generate `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET`, request Level 2 PII access.

---

## 2. Repo reconciliation — paths corrected from the source spec

The kickoff spec's directory layout is tagged `[Assumption]` and uses paths like `apps/shopfront-shopify/`, `packages/entity-risk/`, `packages/twilio-client/`, `packages/vonage-client/`, `packages/inngest-helpers/`, `packages/claude-prompts/`, `packages/threat-feeds/` — none of which exist in this repo. Reconciled mapping:

| Spec path                            | Actual location                                                       |
| ------------------------------------ | --------------------------------------------------------------------- |
| `apps/shopfront-shopify/`            | **`apps/shopfront/`** (matches `apps/web` / `apps/extension` brevity) |
| `packages/buyer-trust-core/`         | **`packages/buyer-trust/`** (matches `packages/charity-check` style)  |
| `packages/shopify-sdk/`              | `packages/shopify-sdk/` (new — keep as-is)                            |
| `packages/representment/`            | `packages/representment/` (new — keep as-is)                          |
| `packages/entity-risk/`              | `packages/scam-engine/src/cluster-builder.ts` (existing)              |
| `packages/threat-feeds/`             | `packages/scam-engine/src/{pipeline,feed-sync,scam-alerts}.ts`        |
| `packages/claude-prompts/`           | `packages/scam-engine/src/{claude,anthropic}.ts`                      |
| `packages/twilio-client/`            | `packages/scam-engine/src/phone-footprint/providers/` (existing)      |
| `packages/vonage-client/`            | `packages/scam-engine/src/phone-footprint/providers/` (existing)      |
| `packages/inngest-helpers/`          | `packages/scam-engine/src/inngest/` (existing — `client.ts`, `events.ts`) |
| `supabase/migrations/2026XXXX_*.sql` | **`supabase/migration-vNN-name.sql`** (flat, sequential — next is v94) |
| `apps/b2b-api/`                      | Lives inside `apps/web/app/api/v1/*` — not a separate app             |

**Net new packages (3):** `@askarthur/shopify-sdk`, `@askarthur/buyer-trust`, `@askarthur/representment`.
**Net new app (1):** `apps/shopfront`.
**Existing packages reused:** `scam-engine`, `utils`, `supabase`, `types`.

---

## 3. PR-by-PR detail (Stage 1)

### PR 1 — scaffold `apps/shopfront` + `packages/shopify-sdk` + flags

- `apps/shopfront/` — Next.js 16 (Turbopack, React 19, App Router) embedded app; Shopify App Bridge 4; Polaris React; matches `apps/web`'s tooling and `tooling/typescript/` config.
- `packages/shopify-sdk/` — typed GraphQL Admin client, `verifyShopifyHmac()`, billing helpers, retry/backoff, `RiskAssessmentResult` types.
- `packages/buyer-trust/` — empty skeleton, exports `BuyerTrustVerdict` type (mirrors existing `AnalysisResult` shape from `@askarthur/types`).
- `packages/representment/` — empty skeleton.
- `turbo.json` — add new app + packages to pipeline; add env vars (see §5).
- `packages/utils/src/feature-flags.ts` — add **server-side** `FF_SHOPFRONT_*` flags (no `NEXT_PUBLIC_` prefix; this is a separate Vercel project). Default OFF:
  - `FF_SHOPFRONT_INSTALL` — gate OAuth route
  - `FF_SHOPFRONT_RISK_API` — gate `orderRiskAssessmentCreate` publishing
  - `FF_SHOPFRONT_FLOW_TEMPLATES`
  - `FF_SHOPFRONT_CE3_AUTOSUBMIT`
  - `FF_SHOPFRONT_CHECKOUT_BLOCK` (Plus only, separate FF)
  - `FF_SHOPFRONT_FEDERATED_CLUSTER`
  - `FF_SHOPFRONT_DISPUTE_NARRATIVE_LLM`
  - `FF_SHOPFRONT_VAMP_MONITOR`
- New Vercel project for `apps/shopfront`, root `apps/shopfront`, build `cd ../.. && pnpm turbo build --filter=@askarthur/shopfront`. Hosts `shopfront.askarthur.au`. (Web app stays on `askarthur.au`.)
- `CLAUDE.md` — add a Shopfront row to the Quick Reference table pointing to this plan; add `docs/ops/shopfront-config.md` placeholder.

**Definition of done:** `pnpm turbo build` green; `shopfront.askarthur.au` serves a "coming soon" page; no Shopify API calls yet.

### PR 2 — migration v94 (Shopfront baseline schema)

`supabase/migration-v94-shopfront.sql` — all tables in the `public` schema with explicit `search_path` + RLS:

```sql
CREATE TABLE IF NOT EXISTS public.shopfront_shops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_domain text UNIQUE NOT NULL,
  access_token_encrypted bytea NOT NULL,            -- pgsodium symmetric
  scopes text[] NOT NULL,
  plan text NOT NULL CHECK (plan IN ('free','pro','business','enterprise')),
  installed_at timestamptz NOT NULL DEFAULT now(),
  uninstalled_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.shopfront_order_verdicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shopfront_shops(id) ON DELETE CASCADE,
  order_gid text NOT NULL,
  buyer_email_hash bytea NOT NULL,
  buyer_phone_hash bytea,
  device_id text,
  ip_address inet,
  cluster_id uuid REFERENCES public.entity_clusters(id),     -- existing v22 table
  shopify_risk_level text NOT NULL CHECK (shopify_risk_level IN ('LOW','MEDIUM','HIGH','PENDING')),
  trust_score smallint NOT NULL CHECK (trust_score BETWEEN 0 AND 100),
  signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  cold_path_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(shop_id, order_gid)
);

CREATE TABLE IF NOT EXISTS public.shopfront_billing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shopfront_shops(id) ON DELETE CASCADE,
  event_type text NOT NULL,                          -- subscribe / cancel / usage / charge_capture
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shopfront_verdicts_shop_created
  ON public.shopfront_order_verdicts (shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shopfront_verdicts_cluster
  ON public.shopfront_order_verdicts (cluster_id) WHERE cluster_id IS NOT NULL;

ALTER TABLE public.shopfront_shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopfront_order_verdicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopfront_billing_events ENABLE ROW LEVEL SECURITY;
-- service_role full access; tenant access via app.current_shop_id setting (see §7).
```

Idempotent with `CREATE TABLE IF NOT EXISTS` + `DROP POLICY IF EXISTS … CREATE POLICY …`. Apply via `mcp__supabase__apply_migration` to project `rquomhcgnodxzkhokwni`. Run `mcp__supabase__get_advisors` post-apply; fix any new ERRORs before merging.

### PR 3 — OAuth + managed installation + offline token storage

- `apps/shopfront/app/api/auth/route.ts` (initiate) and `…/auth/callback/route.ts`.
- Use Shopify managed installation flow (online + offline tokens). Required scopes per `shopify.app.toml`:
  ```
  read_orders,write_orders,read_customers,read_fulfillments,read_locations
  ```
- Offline token persisted in `shopfront_shops.access_token_encrypted` via pgsodium; **never logged**, **never returned in API responses**, **not embedded in Inngest event payloads** (Inngest functions resolve the token from the DB at step time — Disputifier January 2026 lesson).
- Token decryption only from a `tenantContext()` helper that scopes to a single shop_id at a time and clears the secret from memory after use.
- `app/api/auth/uninstalled/route.ts` (webhook) flips `uninstalled_at`, revokes DB access, and triggers a 7-day delayed Inngest job to purge `shopfront_order_verdicts` rows.

### PR 4 — webhook ingress + HMAC verifier + GDPR mandatory webhooks

- `apps/shopfront/app/api/shopify/webhooks/route.ts` — single endpoint for non-compliance topics, dispatches to Inngest by topic name. Hot path **must p95 < 500 ms** (Built for Shopify SLO) — verify HMAC, persist a `shopfront_order_verdicts` row with `shopify_risk_level: 'PENDING'`, `inngest.send()`, return 200.
- `apps/shopfront/app/api/shopify/compliance/route.ts` — `customers/data_request`, `customers/redact`, `shop/redact`. All return HTTP 200 within 30 seconds (Shopify hard requirement). HMAC-validated. Redact path: SHA-256 the email + phone, delete matching rows from `shopfront_order_verdicts`.
- HMAC verifier in `packages/shopify-sdk/src/verify-hmac.ts` using `crypto.timingSafeEqual`. Test coverage in `__tests__/verify-hmac.test.ts`.
- Subscribed topics: `orders/create`, `orders/edited`, `orders/cancelled`, `orders/risk_assessment_changed`, `disputes/create`, `disputes/update`, `refunds/create`, `fulfillments/create`.

### PR 5 — `packages/buyer-trust` verdict engine

- `verdict.ts` — pure function `synthesiseVerdict(inputs) -> BuyerTrustVerdict`, taking cluster, carrier lookup, HIBP presence, SIM-swap result, AOV, freight-forwarder match, RaaS Telegram membership.
- Reuses (does **not** wrap) `packages/scam-engine/src/cluster-builder.ts`, `phone-footprint/orchestrator.ts`, `hibp.ts`, `disposable-domains.ts`. Apply the **deletion test** (per CLAUDE.md): if a wrapper would just pass through, inline-import the scam-engine module instead.
- New Claude prompt: `packages/scam-engine/src/buyer-trust-prompt.ts` (sits alongside existing `claude.ts` rather than as a new package), JSON-schema output `{score, shopifyRiskLevel, signals[], clusterSize}`. Reuses Haiku 4.5 model, ~A$0.001/verdict.
- `logCost({feature: 'shopfront', provider: 'claude-haiku-4-5', …})` per call. Cost brake reads `feature_brakes.shopfront` (default cap A$15/day, env `SHOPFRONT_DAILY_CAP_USD=15`); when triggered, `synthesiseVerdict` early-returns `{shopifyRiskLevel: 'PENDING', signals: [{label: 'cost-brake-active', sentiment: 'NEUTRAL'}]}`.
- Vitest suite covering: unanimous LOW signal set, mixed MEDIUM, cluster-size-driven HIGH, RaaS hit, cost-brake fallback, missing-Level-2 degradation path.

### PR 6 — Inngest hot-path + cold-path fan-out

- `packages/scam-engine/src/inngest/shopfront-orders-create.ts` — fast-lane (~300–800 ms): cluster join + Upstash verdict cache; writes `PENDING` or initial `LOW/MEDIUM/HIGH` to Shopify via `orderRiskAssessmentCreate`.
- `packages/scam-engine/src/inngest/shopfront-orders-enrich.ts` — slow lane (2–15 s): Twilio Lookup carrier, HIBP, conditional Vonage SIM-swap (only when `cluster.riskScore > 60` and `isVonageLive(country)`), conditional FingerprintJS Pro lookup (only on MEDIUM/HIGH). Synthesises final verdict via `buyer-trust` package, upserts to `shopfront_order_verdicts`, publishes via `orderRiskAssessmentCreate` again.
- Both functions registered in `apps/web/app/api/inngest/route.ts` (single registration surface — Shopfront does not run a separate Inngest server).
- Idempotency via dedupe on `orderGid`. Concurrency cap 100.
- `shopfront-vamp-monitor.ts` — daily cron computing per-shop VAMP ratio (disputes / approved orders, 30-day rolling), alerting Telegram admin + merchant Slack/email when ratio approaches 1.5%.

### PR 7 — Polaris merchant dashboard

- `app/page.tsx` — dashboard summary (last 7-day verdict distribution, top flagged buyers, current VAMP ratio, plan + usage).
- `app/orders/[id]/page.tsx` — verdict card (Polaris `Card` + `BlockStack`), cluster timeline showing other Shopify orders linked through the same cluster_id (across the merchant's own store only — cross-merchant comes in PR 20), Approve / Hold / Cancel buttons that call `orderUpdate` mutations.
- `app/settings/page.tsx` — install Flow templates (PR 8), toggle thank-you trust badge, manage plan upgrade.
- App Bridge 4 navigation; Polaris design tokens; respects existing `DESIGN_SYSTEM.md` where it overlaps.

### PR 8 — Shopify Flow templates + Order Status thank-you trust badge

- Three Flow templates wired against the `Order risk analyzed` trigger (fires after `ORDERS_RISK_ASSESSMENT_CHANGED` resolves to non-PENDING):
  1. "Cancel + restock + tag if Ask Arthur HIGH and cluster ≥ 3"
  2. "Hold fulfilment + Slack-notify if Ask Arthur MEDIUM and AOV > A$300"
  3. "Send SMS verify link if Ask Arthur MEDIUM"
- Order Status thank-you UI extension (works on **all plans**, not just Plus): `extensions/thankyou-trust-badge/`. Renders a "Verified Buyer" badge — never the score, never the cluster size (per §H3 risk note: buyers must not perceive merchants as scam-checking them).

### PR 9 — Shopify Billing API (managed pricing)

- `packages/shopify-sdk/src/billing.ts` — managed pricing config:
  - **Free** — 50 verdicts/mo, no Shopify charge.
  - **Pro** — A$49/mo recurring + A$0.06 per verdict over 1,500/mo, capped A$100. 14-day trial.
  - **Business** — A$199/mo + A$0.04/verdict over 10,000/mo, capped A$300. Verifi/Ethoca add-on at A$45/deflected dispute (Stage 2).
  - **Enterprise** — contact-sales floor A$599/mo, off-Shopify-billed where possible.
- `app/api/billing/webhook/route.ts` — capture `app_subscriptions/update` to refresh `shopfront_shops.plan`.
- Per-tier verdict-cap enforcement reads `shopfront_order_verdicts` count for the calendar month, returns `PENDING` (no signals) when over cap.

### PR 10 — App Store listing + Built for Shopify perf hardening

- App Store listing copy, screenshots, demo store. Submission as draft for early reviewer feedback even before Stage 1 code-complete.
- Webhook handler p95 < 500 ms verified via load test (200 RPS) — Built for Shopify SLO.
- Privacy policy + ToS published at `shopfront.askarthur.au/privacy` and `/terms`. Disclose cross-border processors (Anthropic US, Twilio US, Vonage UK) per APP 8.
- Accessibility audit (Polaris is accessible by default; verify our overlays).

---

## 4. PR-by-PR detail (Stages 2 + 3, abridged)

### Stage 2 — Representment + Verifi/Ethoca + AU signals

- **PR 11 — migration v95.** Tables `shopfront_disputes` (label store for model retraining; `outcome IN ('won','lost','withdrawn','pending')`) and `shopfront_ce3_evidence` (matching elements + prior order GIDs).
- **PR 12 — CE 3.0 evidence-pack generator.** `packages/representment/src/ce3.ts` per the source spec: ≥ 2 priors 120–365 days old on same payment credential, ≥ 2 matching elements with at least one being IP or device. Manual export UI (download PDF).
- **PR 13 — Stripe + Shopify Payments AU dispute auto-submission.** Behind `FF_SHOPFRONT_CE3_AUTOSUBMIT`. Reuse Stripe webhook plumbing from existing v57 / v70 migrations.
- **PR 14 — Verifi RDR + Ethoca Alerts ingestion.** Business-tier add-on, A$45/deflected dispute. Vendor contracts negotiated separately.
- **PR 15 — Reshipper detection.** Curated AU/NZ freight-forwarder dataset (parcel-locker chains, named operators, NSW/VIC reshipper postcode hotspots). Static JSON in `packages/buyer-trust/data/`.
- **PR 16 — LLM dispute-narrative classifier.** Haiku 4.5 prompt detecting LLM-generated rebuttals, refund-template phrase matching, sentiment incongruence. Behind `FF_SHOPFRONT_DISPUTE_NARRATIVE_LLM`. Target: 60–75% AUC `[Estimate]`.
- **PR 17 — VAMP ratio monitor + brand-mention scraper.** Daily cron alerts merchants approaching 1.5% VAMP threshold; brand-mention scrape extends existing `packages/scam-engine/src/brand-alerts.ts` to monitor scam stores impersonating the merchant.

### Stage 3 — Plus checkout + federation + guarantee

- **PR 18 — migration v96.** Federated cluster bloom-filter table; cross-shop hash join surface.
- **PR 19 — Plus-only Checkout UI extension.** `extensions/checkout-block/` with `block_progress` capability. Behind `FF_SHOPFRONT_CHECKOUT_BLOCK`. Onboarding flow includes a screenshot-based step instructing the merchant to flip "Allow app to block checkout" in the checkout editor (post-26-Jan-2026 default is non-blocking).
- **PR 20 — Federated SHA-256 hashed cluster join API.** Read-only Stage 3a, read+write Stage 3b. Bloom-filter membership pre-check, full hash lookup behind APP 6.2(c) opinion. **Blocked on PR 0 privacy counsel sign-off.**
- **PR 21 — Vonage AU SIM-swap live.** Flip `FF_VONAGE_MOCK_MODE` off when carrier approval lands. Until then, ship Pro and Business **without** SIM-swap as a guaranteed feature; do not put SIM-swap on the marketing page.
- **PR 22 — Guarantee pilot.** Only proceeds when ≥ 1,000 paying merchants AND ≥ A$50M cumulative GMV processed AND ≥ 6 months of in-network chargeback distribution data. Pricing: ~0.6–0.9% of approved GMV (Signifyd's range minus 10–30%). Below-A$2M-GMV/mo merchants are not guarantee-eligible — variance dominates.

---

## 5. Environment variables + feature flags

Add to `turbo.json` `globalEnv`:

| Variable                              | Purpose                                          | Default      |
| ------------------------------------- | ------------------------------------------------ | ------------ |
| `SHOPIFY_API_KEY`                     | Partner Dashboard app credential                 | —            |
| `SHOPIFY_API_SECRET`                  | Partner Dashboard app secret (HMAC + OAuth)      | —            |
| `SHOPIFY_CLI_AUTH_TOKEN`              | CI: `shopify app deploy`                          | —            |
| `SHOPFRONT_DAILY_CAP_USD`             | Per-day cost brake for Shopfront feature         | `15`         |
| `FINGERPRINT_PRO_API_KEY`             | FingerprintJS Pro (Stage 1, MEDIUM/HIGH only)    | —            |
| `VERIFI_RDR_API_KEY`                  | Stage 2 Business add-on                          | —            |
| `ETHOCA_ALERTS_API_KEY`               | Stage 2 Business add-on                          | —            |
| `FF_SHOPFRONT_INSTALL`                | Gate OAuth route                                  | `false`      |
| `FF_SHOPFRONT_RISK_API`               | Gate `orderRiskAssessmentCreate` publishing      | `false`      |
| `FF_SHOPFRONT_FLOW_TEMPLATES`         | Expose Flow templates in dashboard                | `false`      |
| `FF_SHOPFRONT_CE3_AUTOSUBMIT`         | Stage 2: auto-submit Stripe / SP-AU disputes     | `false`      |
| `FF_SHOPFRONT_CHECKOUT_BLOCK`         | Stage 3: Plus blocking extension                  | `false`      |
| `FF_SHOPFRONT_FEDERATED_CLUSTER`      | Stage 3: cross-merchant hash join                | `false`      |
| `FF_SHOPFRONT_DISPUTE_NARRATIVE_LLM`  | Stage 2: LLM dispute classifier                   | `false`      |
| `FF_SHOPFRONT_VAMP_MONITOR`           | Stage 2: VAMP ratio cron + alerts                | `false`      |

These are **server-side flags only** (no `NEXT_PUBLIC_` prefix) — Shopfront is a separate Vercel project from the consumer web app, and merchant settings UI reads them via embedded RPCs rather than client bundles.

Reuse existing flags: `FF_VONAGE_MOCK_MODE` (PR 21), `NEXT_PUBLIC_FF_PHONE_INTEL` (Twilio Lookup gate already present in `feature-flags.ts`).

---

## 6. Cost telemetry + brakes

All per-call paid-API spend tagged in the existing `cost_telemetry` table (v62) via `logCost()`:

- `feature: 'shopfront'`, `provider: 'twilio-lookup' | 'vonage-sim-swap' | 'fingerprint-pro' | 'claude-haiku-4-5' | 'hibp' | 'verifi-rdr' | 'ethoca-alerts'`.
- Daily threshold alerts via `TELEGRAM_ADMIN_CHAT_ID` (existing channel).
- `feature_brakes.shopfront` row populated by `cost-daily-check` cron when `SHOPFRONT_DAILY_CAP_USD` is exceeded; `synthesiseVerdict` early-returns degraded `PENDING` verdict during the 24h pause window.
- Use **bare numeric** env values (`15`, not `$15`) — `parseFloat("$15")` is `NaN` and silently disables the brake (same gotcha as Phone Footprint per CLAUDE.md).

Blended per-lookup cost target: **A$0.016** (per source spec §E):

| Component                           | Cost / lookup       |
| ----------------------------------- | ------------------- |
| Twilio Lookup carrier               | A$0.008             |
| Claude Haiku 4.5 verdict            | A$0.001             |
| Vonage SIM-swap (5% fire rate)      | A$0.004 blended     |
| FingerprintJS Pro (MED/HIGH only)   | A$0.0015 blended    |
| Supabase + Vercel + Inngest + Upstash | A$0.002 at scale  |
| **Blended**                         | **≈ A$0.016**       |

At A$49 / 1,500 included, gross margin ≈ 51% before Shopify revenue share (0% < US$1M cumulative, 15% above; 0% within Built for Shopify free band).

---

## 7. Tenant isolation + token security (Disputifier January 2026 lesson)

Hard rules, enforced from PR 3:

1. Offline tokens encrypted at rest (pgsodium symmetric).
2. **Tokens never appear in Inngest event payloads.** Inngest functions resolve the token via a `tenantContext(shop_id)` helper that decrypts on demand and clears the secret after the step completes.
3. Inngest cold-path functions cannot read tokens for shops other than the one currently being processed — enforced by the `tenantContext` API surface (no `getAllShops()` accessor exists on the path).
4. Refund-rate anomaly detection in PR 17's VAMP cron: alert on >5x baseline refund volume per shop per hour.
5. Tokens rotated on `app_subscriptions/update` cancellation, on `customers/redact`, on detection of anomalous refund volumes.
6. Full tokens never logged. Logger redacts any field matching `/token|secret|key/i` (existing `packages/utils/src/logger.ts` convention — verify rule covers `access_token_encrypted` decoded form).

---

## 8. Open questions + ADR candidates

Per CLAUDE.md, design decisions that are hard to reverse, surprising without context, AND the result of a real trade-off should be recorded as ADRs. Candidates:

- **ADR-0007 — Federated cluster join via SHA-256 + bloom filter.** Trade-off: privacy-law defensibility (APP 6.2(c) "permitted general situation" for fraud investigation; APP 11 security) vs recall reduction from hashing. Alternative considered: encrypted lookup with TEE — rejected on operational complexity. **Open until PR 0 privacy counsel opinion lands.**
- **ADR-0008 — Two-stage Risk Assessment publishing (`PENDING` → final).** Trade-off: hot-path latency (Built for Shopify < 500 ms) vs cold-path verdict accuracy. Alternative considered: synchronous full verdict — rejected because Twilio + Vonage + HIBP combined median latency is 1.5–4s.
- **ADR-0009 — Defer guarantee model to Stage 3 with 1,000-merchant + 6-month threshold.** Trade-off: capital-efficient SaaS pricing in Stages 1–2 vs liability-shift product-market fit in Stage 3. Below A$2M GMV/mo per merchant, variance dominates and a single A$2,000 luxury chargeback can wipe out a year of premium.
- **ADR-0010 — Separate Vercel project for `apps/shopfront` (not merged into `apps/web`).** Trade-off: deployment isolation (merchant-side outages don't take down `askarthur.au`) and brand separation vs duplicated CI cost. Alternative considered: single Next.js app with `/shopfront` route group — rejected because Shopify App Bridge requires a clean iframe boundary and per-app credentials.

Open questions still requiring user decision:

1. **Pricing nameplates locked at A$49 / A$199 / A$599?** The source spec recommends; this plan accepts. Lock at PR 9.
2. **Brand strategy.** Source spec recommends sub-domain (`shopfront.askarthur.au`) with merchant-targeted homepage distinct from consumer scam checker, no "Powered by Ask Arthur" badge at checkout. Confirm before PR 10 listing copy.
3. **Stage 3 representment build-vs-partner.** Source spec recommends rev-share partnership with Justt or Chargeflow rather than rebuilding their model retraining loop. Decision can be deferred to mid-Stage 2.
4. **Lite tier (A$29 / 500 lookups) trigger.** Source spec: introduce only if Chargeflow Prevent drops below $0.10/scan or NoFraud cuts below $0.05/tx. Monitor competitor pricing quarterly.
5. **Guarantee model launch criteria.** Source spec threshold: ≥ 1,000 paying merchants AND ≥ A$50M cumulative GMV AND ≥ 6 months of in-network chargeback data. Confirm at Stage 3 kickoff.

---

## 9. Risks (carried from source spec §H)

| Risk                                                              | Mitigation                                                                                                          |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Protected Customer Data Level 2 rejection                         | Submit PR 0 day one; build against dev store while waiting; degrade to hash-only signals on rejection                |
| Cross-merchant sharing legal opinion adverse                      | Stage 3 PR 20 is fully gated on opinion; Stages 1–2 ship without federation                                          |
| Vonage AU SIM-swap not live by Q4 2026                            | Drop SIM-swap from Business marketing copy entirely; market as roadmap item                                          |
| Shopify Checkout UI extension default-non-blocking (since Jan 2026) | PR 19 onboarding flow includes screenshot step to flip "Allow app to block checkout"                                 |
| Disputifier-style token exfiltration                              | §7 token security rules enforced from PR 3; refund-rate anomaly detection in PR 17                                   |
| Apple iOS 26 ATFP / Safari ITP eroding device fingerprint signal  | Multi-signal verdict (cluster + phone + email + behavioural); FingerprintJS Pro only on MEDIUM/HIGH triage          |
| Shopify API version churn (2026-04 → next)                        | `packages/shopify-sdk` pins API version; quarterly upgrade PR; verify before App Store listing                       |

---

## 10. Definition of done — Stage 1 ship gate

- [ ] PR 0 — Level 2 PII approved, privacy counsel opinion received, `shopfront.askarthur.au` live.
- [ ] PRs 1–10 merged to `main`, all flags ON for the App Store reviewer's test store.
- [ ] App Store listing approved by Shopify (typical 5–15 business days).
- [ ] Built for Shopify p95 < 500 ms verified over 28 days with ≥ 1,000 requests on a real install.
- [ ] At least 5 design-partner AU merchants onboarded and producing verdict feedback.
- [ ] Cost-telemetry dashboard at `/admin/costs` shows `feature: 'shopfront'` rows with blended cost ≤ A$0.020/lookup.
- [ ] Privacy policy + ToS published; cross-border processors disclosed.
- [ ] No PR 0 risks materialised in production.

---

## 11. Pointers

- **Source spec.** Long-form kickoff document (TL;DR + sections A–H + recommendations + caveats). Preserved in PR 1's description history.
- **Shopify GraphQL Admin API 2026-04.** `orderRiskAssessmentCreate`, `RiskAssessmentResult` enum, `ORDERS_RISK_ASSESSMENT_CHANGED` webhook.
- **Existing migrations referenced.**
  - v22 — `entity_clusters` (cluster join target)
  - v57 / v70 — Stripe + idempotency (reused for CE 3.0 auto-submit)
  - v62 — `cost_telemetry` (per-call cost tagging)
  - v65 — `feature_brakes` (24h cost-cap pause)
  - v75 / v76 / v77 — phone-footprint core + Vonage telco + verified fleet (reused by Shopfront verdict engine)
- **Existing scam-engine modules reused.** `cluster-builder.ts`, `phone-footprint/orchestrator.ts`, `hibp.ts`, `disposable-domains.ts`, `claude.ts`, `inngest/client.ts` + `events.ts`, `brand-alerts.ts`.
- **Related plans.** `docs/plans/breach-defence-suite.md` (B2B side, paused after PR 2), `docs/plans/phone-footprint-v2.md` (telco signals reused here).
- **Ops config (to be created at PR 1).** `docs/ops/shopfront-config.md` — env vars, feature flags, GitHub Actions, App Store listing notes, smoke-test checklist (mirrors `docs/ops/charity-check-config.md` and `docs/ops/phone-footprint-config.md` style).
