# Ask Arthur Phone Footprint — Implementation Playbook v2

Status: **Locked in (2026-04-23).** Source of truth for Sprint 1–10. Codebase
corrections from pre-implementation reconnaissance baked in — see §"Stack
corrections accepted".

## Decision summary

**Vonage stays.** All eight Vonage APIs remain in scope as pillars 3 and 4 of
the composite risk score. To protect time-to-market while Aduna + Telstra
approval lands, Sprint 1 ships every Vonage-dependent table, a mock adapter
behind `FF_VONAGE_MOCK_MODE`, and a graceful-degradation path in the scoring
engine — then flips to live behind a feature flag the day approval clears,
with an Inngest backfill job to upgrade existing footprints.

**Consumer pricing (new SKUs alongside existing B2B):**

| SKU                           | AUD/mo | AUD/yr        | Scope                                                                                                                  |
| ----------------------------- | ------ | ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Footprint Free**            | $0     | $0            | Own-number lookup, OTP-gated, 3/day, band badge, 1 saved number                                                        |
| **Footprint Personal**        | $7.99  | $79           | 5 saved numbers, monthly refresh, delta alerts, PDF export, Claude explanations, SIM-swap heartbeat (when Vonage live) |
| **Footprint Family**          | $12.99 | $129          | Up to 5 members, private dashboards, 25 pooled saved numbers                                                           |
| **Pro $99/mo** _(kept)_       | $99    | $990          | Existing Arthur Pro — B2B-API, adds 100 footprint lookups/mo                                                           |
| **Business $449/mo** _(kept)_ | $449   | $4,490        | Existing Arthur Business — adds 1,000 footprint lookups/mo + batch                                                     |
| **Fleet Starter** _(new)_     | $999   | $9,990        | 50-seat corporate, SSO, 5k monitored numbers, webhook alerts, PDF, audit trail                                         |
| **Fleet Enterprise**          | quote  | from $60k ACV | Unlimited seats, SPF s58BT gateway positioning, per-call SIM-swap overage                                              |

**Corporate scope: Option A (full fleet tier) at the low end** — SSO, bulk
upload, webhooks, audit trail, PDF. Skip SCIM, custom SLAs, white-label until
v2. The SPF Act bank-designation window (1 July 2026) and 6–12 month AU bank
procurement cycles mean we must be RFP-ready mid-2026 or miss the tailwind
entirely. Shipping a credible fleet product in Sprints 7–8 puts Arthur in
pilot conversations by Q3 2026.

**Stack corrections accepted:**

- Stripe (not Paddle) — Paddle was dropped in migration v59.
- Twilio Verify added in Sprint 1 — no OTP exists today.
- RPC rewritten against `scam_entities.entity_type='phone'` + `normalized_value`
  (NOT the playbook's `kind` column which does not exist), and cluster joins
  go via `scam_reports.cluster_id` (entities have no cluster_id).
- Orchestrator uses `Promise.allSettled` with batch caps
  (`packages/scam-engine/src/inngest/entity-enrichment.ts` style, not
  `p-limit`).
- LeakCheck replaces HIBP for phone-keyed breach data.
- Migration numbers are v75/v76/v77, not v80/v81 — latest live is v74.
- `entity_risk_weights` table doesn't exist; signal weights live inside
  `compute_entity_risk_score` RPC (v24/v26/v27). Future telco-signal integration
  will edit that RPC rather than adding a new table.
- Phone ownership columns go on `user_profiles` (NOT `users` — `users` is
  `auth.users` and is Supabase-managed).
- RLS policies reference `org_members` (the actual table), not `memberships`.

**Vonage pillar preserved.** All eight endpoints, all dependent tables, admin
panels, composite-score pillars 3 and 4, consumer "SIM Swap Heartbeat" premium
feature, corporate SIM-swap webhook product — retained, shipped in Sprint 1
schema, behind mock-mode until approval.

---

## 1. Why Vonage stays, even with approval pending

Vonage is the single most valuable technical moat Ask Arthur can build before
SPF designation in July 2026. Carrier-attested SIM-swap signals are the
textbook disruption control under SPF Principles 2 (Prevent), 3 (Detect), and
5 (Disrupt). Truecaller, Hiya, and Whoscall do not have it; Prove has it at US
bank-scale prices; Vonage + Aduna is the only CPaaS route into AU MNOs for a
startup-sized ACV.

Dropping Vonage would reduce Phone Footprint to a better-packaged Twilio
Lookup + HIBP clone competing head-on with Truecaller's A$6/mo. Keeping
Vonage — even in degraded mock-mode at launch — tells banks the story that
matters: we can see SIM swaps, our composite score degrades gracefully when
coverage isn't available, and we ship the pillar the moment Aduna says yes.

Sprint 1 ships the schema + a mock adapter; Sprint 6 ships the
live-approval upgrade path.

## 2. The five-pillar composite risk score

Weighted sum across five pillars, producing a 0–100 risk number and a
`safe | caution | high | critical` band. Each pillar returns
`{ score: 0..100, confidence: 0..1, available: bool }`. When a pillar is
unavailable, weight is redistributed proportionally and the response includes
a `coverage: { vonage: "pending" | "live", ... }` object surfaced to the UI.

| #   | Pillar                     | Weight | Primary source                                                                        | Fallback                          |
| --- | -------------------------- | ------ | ------------------------------------------------------------------------------------- | --------------------------------- |
| 1   | Internal scam reports      | 30%    | `scam_entities` + `report_entity_links` + `scam_reports.cluster_id` → `scam_clusters` | n/a (first-party)                 |
| 2   | Breach exposure            | 20%    | LeakCheck (phone) + HIBP (email if linked)                                            | HIBP Pwned Passwords via k-anon   |
| 3   | Live reputation            | 25%    | Vonage Number Insight v2 `fraud_score`                                                | IPQS phone reputation             |
| 4   | SIM swap / carrier drift   | 15%    | Vonage Identity Insights SIM Swap + Device Swap                                       | Twilio `sim_swap` (contact-sales) |
| 5   | Identity & line attributes | 10%    | Twilio Lookup v2 `line_type_intelligence` + Vonage Roaming/Reachability               | Twilio Lookup only                |

**Graceful-degradation rule.** If Vonage is mock-mode, pillar 3 falls back to
IPQS at 0.7 confidence, and pillar 4 returns `available: false` with weight
redistributed across pillars 1, 2, 3, and 5. UI shows a "SIM-swap coverage:
pending for this carrier" chip instead of a green tick.

## 3. Corrected stack assumptions

**Billing: Stripe.** Envs follow existing convention. Four new price IDs:

- `STRIPE_PRICE_FOOTPRINT_PERSONAL_MONTHLY` / `..._ANNUAL`
- `STRIPE_PRICE_FOOTPRINT_FAMILY_MONTHLY` / `..._ANNUAL`
- `STRIPE_PRICE_FLEET_STARTER_MONTHLY` / `..._ANNUAL`
- `STRIPE_PRICE_FLEET_ENTERPRISE` (manually-invoiced)

Existing `sync_subscription_tier` RPC **not touched**; a separate
`sync_phone_footprint_entitlements` function lives in its own table
(`phone_footprint_entitlements`) so entitlements can be upgraded/downgraded
independently of Arthur's core tier.

**OTP does not exist yet.** Twilio Verify is a Sprint 1 add. Twilio account
already exists. Work: create Verify Service in console, store SID in
`TWILIO_VERIFY_SERVICE_SID`, add `phone_e164` + `phone_verified_at` to
`user_profiles`, wire `/api/phone-footprint/verify/{start,check}`. This is
the APP 3.5/3.6 compliance spine.

**Orchestrator uses `Promise.allSettled` with batch caps**, matching
`packages/scam-engine/src/inngest/entity-enrichment.ts`. No `p-limit`.
Fan-out to five providers runs in one `allSettled` batch with per-provider
timeouts.

**RPC schema.** `phone_footprint_internal` takes `p_msisdn_e164 text`, queries
`scam_entities WHERE entity_type = 'phone' AND normalized_value = p_msisdn_e164`,
joins to `report_entity_links` for report counts, then joins to `scam_reports`
via report_entity_links.report_id to get `cluster_id` (NOT
`scam_entities.cluster_id` — that column does not exist).

**LeakCheck replaces HIBP for phone breaches.** HIBP 2.0 (May 2025) removed
phone support. LeakCheck (leakcheck.io, Lithuania) USD $9.99/mo entry or USD
$179/3mo enterprise. HIBP stays for email-keyed lookups.

## 4. Three-tier consumer product design

Pricing sits between Truecaller/Hiya (A$4–6/mo) and Norton Identity Advisor
(A$10/mo). No dominant AU-native consumer scam-detection subscription in the
A$5–15/mo band — this is the gap.

**Footprint Free** is a teaser. Drives OTP verification (APP 3.5 defence),
qualifies intent, upsells. Band badge only (`safe/caution/high/critical`), no
provider-level detail. 3 lookups/day per verified identity; 1 lookup per IP
before Turnstile challenge. 1 saved number.

**Footprint Personal A$7.99/mo.** Priced A$2 above Truecaller Premium to
signal a different category — footprint intelligence, not caller-ID. 5 saved
numbers, monthly refresh, delta alerts, PDF export, Claude plain-English
explanations, and — the premium hook — **SIM Swap Heartbeat**: when Vonage is
live, Arthur subscribes to CAMARA SIM-swap events for saved numbers and pushes
a mobile notification within seconds of a swap.

**Footprint Family A$12.99/mo** is 1.6× Personal, aggressive family-plan
pricing vs the 2.5–3× norm but maps to Whoscall's Family/Individual ratio.
Up to 5 members, private dashboards per member, 25 pooled saved numbers.

**Why not A$4.99 or A$14.99?** A$4.99 invites direct feature comparison
against Truecaller that Arthur can't win on raw DB size. A$14.99 without
underwritten ID-theft insurance is indefensible next to Equifax Identity
Protect A$14.95.

**Existing Pro A$99/mo and Business A$449/mo stay as-is.** Adding Phone
Footprint lookup quota to both (100/mo Pro, 1,000/mo Business, plus batch on
Business) is pure upside. `sync_subscription_tier` left alone.

**Fleet Starter A$999/mo and Fleet Enterprise from A$60k ACV** are the new
corporate lane. Fleet Starter is self-serve, Stripe-billed, annual-preferred
at A$9,990/yr. Fleet Enterprise is quote-only, includes per-call SIM-swap
overage pricing.

## 5. Corporate tier scoping — Option A

SPF Act 2025 commencement, bank designation 1 July 2026, 6–12 month AU bank
procurement, statutory s 58BT authorised third-party gateway hook. Cost of
waiting for v2 is the cost of missing the SPF procurement wave.

Ship SSO (Google Workspace + generic SAML via Clerk or WorkOS), bulk CSV
upload, per-org webhook alerts, PDF export, 90-day audit trail. Defer SCIM,
custom SLAs, white-label, on-prem to v2. Reuse `organizations` + `org_members`
(v55) — no new tenancy model. Fleet Enterprise customers get manually-
provisioned Stripe invoice + account manager.

Contract template includes optional clause establishing Arthur as candidate
**s 58BT authorised third-party data gateway** once SPF rules finalised
(31 March 2027).

## 6. Database migrations

Three migrations. Latest live is v74 → we ship v75/v76/v77, all idempotent.

**v75 — phone-footprint core** (see `supabase/migration-v75-phone-footprint-core.sql`):

- `phone_footprints` (snapshot cache, composite score, pillars JSONB, coverage JSONB, msisdn_e164 + msisdn_hash, 7-day TTL)
- `phone_footprint_monitors` (saved numbers, ownership_proof JSONB, consent_expires_at, refresh cadence)
- `phone_footprint_alerts` (delta events, idempotent via key)
- `phone_footprint_refresh_queue` (Inngest claim queue)
- `phone_footprint_entitlements` (Stripe-synced, separate from `subscriptions`)
- `phone_footprint_otp_attempts` (abuse forensics + soft-ban state)
- Corrected RPC `phone_footprint_internal(p_msisdn_e164 text)` using real schema
- Retention functions: `anonymise_expired_footprints()`, `sweep_inactive_monitors()`
- `v_phone_footprint_metrics` view for admin
- RLS matching existing Arthur pattern (service role + own-user + org_members)

**v76 — Vonage / telco tables** (see `supabase/migration-v76-vonage-telco.sql`):

- `sim_swap_monitors` (org/user owned, webhook URL, max_age_hours)
- `sim_swap_events` (msisdn_hash, swapped bool, source ∈ vonage|twilio|mock)
- `device_swap_events`
- `subscriber_match_checks`
- `telco_signal_history` (entity_id FK, signal_type, signal_value JSONB)
- `telco_api_usage` (cost accounting per call)
- `telco_webhook_subscriptions` (CAMARA webhook state)
- `telco_provider_health` (live/mock/degraded/down + latency)
- All tables ship **in Sprint 1**; populated only when Vonage flips live.

**v77 — phone verification + fleet org cols** (see `supabase/migration-v77-phone-verified-fleet.sql`):

- `user_profiles.phone_e164` + `phone_verified_at` + `phone_e164_hash`
- `organizations.fleet_tier`, `fleet_seat_cap`, `fleet_webhook_url`,
  `fleet_webhook_secret`, `fleet_refresh_interval`

## 7. Code structure

`packages/scam-engine/src/phone-footprint/`:

| File                     | Purpose                                                                |
| ------------------------ | ---------------------------------------------------------------------- |
| `types.ts`               | `Pillar`, `Footprint`, `FootprintTier`, `ProviderResult`, `Coverage`   |
| `normalize.ts`           | AU E.164 normalization, HMAC msisdn hashing via Vault pepper           |
| `provider-contract.ts`   | `FootprintProvider` interface, `withTimeout` helper                    |
| `providers/internal.ts`  | `internalScamDb()` — calls `phone_footprint_internal` RPC              |
| `providers/twilio.ts`    | Reuses existing `twilio-lookup.ts` `lookupPhoneNumber()`               |
| `providers/ipqs.ts`      | Reuses existing `ipqualityscore.ts` `checkIPQS()`                      |
| `providers/vonage.ts`    | OAuth2, NI v2 + SIM Swap + Device Swap. Honours `FF_VONAGE_MOCK_MODE`. |
| `providers/leakcheck.ts` | NEW. flag-gated off by default until DPA                               |
| `orchestrator.ts`        | `Promise.allSettled` fan-out, 6s batch timeout, per-provider timeouts  |
| `scorer.ts`              | 5-pillar weighted sum, graceful degradation, redactForFree             |
| `delta.ts`               | Compares two snapshots, emits alert severity                           |

`apps/web/lib/twilioVerify.ts` — new wrapper.

API routes under `apps/web/app/api/phone-footprint/`:

- `[msisdn]/route.ts` — main lookup (anon teaser + paid self-lookup)
- `verify/start/route.ts` — OTP send via Twilio Verify
- `verify/check/route.ts` — OTP validate, stores ownership_proof
- `monitors/route.ts` + `monitors/[id]/route.ts` — CRUD
- `[msisdn]/pdf/route.ts` — async PDF via Inngest

Admin page `apps/web/app/admin/phone-footprint/page.tsx`.

## 8. Stripe SKU design

Seven new Price IDs (all AUD):

| Env                                       | Product            | Monthly | Annual |
| ----------------------------------------- | ------------------ | ------- | ------ |
| `STRIPE_PRICE_FOOTPRINT_PERSONAL_MONTHLY` | Footprint Personal | 7.99    | —      |
| `STRIPE_PRICE_FOOTPRINT_PERSONAL_ANNUAL`  | Footprint Personal | —       | 79     |
| `STRIPE_PRICE_FOOTPRINT_FAMILY_MONTHLY`   | Footprint Family   | 12.99   | —      |
| `STRIPE_PRICE_FOOTPRINT_FAMILY_ANNUAL`    | Footprint Family   | —       | 129    |
| `STRIPE_PRICE_FLEET_STARTER_MONTHLY`      | Fleet Starter      | 999     | —      |
| `STRIPE_PRICE_FLEET_STARTER_ANNUAL`       | Fleet Starter      | —       | 9,990  |
| `STRIPE_PRICE_FLEET_ENTERPRISE`           | Fleet Enterprise   | quote   | —      |

Existing Pro/Business envs unchanged.

## 9. Rate limiting and abuse controls

Per-tier Upstash ratelimits keyed on `footprint:{userId|ip}`:

| Bucket           | Limit                                          | Scope            |
| ---------------- | ---------------------------------------------- | ---------------- |
| Free             | 3/day per verified user, 1/IP before Turnstile | anon + free tier |
| Personal         | 30/day                                         | self-lookups     |
| Family           | 50/day pooled                                  | family plan      |
| Pro              | 100/mo (existing)                              | bundled          |
| Business         | 1,000/mo                                       | bundled          |
| Fleet Starter    | 5,000/mo + 250/day burst                       | fleet            |
| Fleet Enterprise | contract-defined                               | enterprise       |

**Turnstile** fires on 2nd anonymous lookup from any IP within 24h and on
every free-tier lookup from a new device fingerprint.

**Per-MSISDN cross-IP detection**: if a single `msisdn_hash` is queried from
3+ distinct IPs in 24h, response downgrades to teaser-only regardless of tier.
Core APP 3.5 "fair means" defence against stalker/enumeration.

**Daily cost kill-switch** via `cost_telemetry` + `logCost()`. Per-tier daily
budgets (AUD): Free $30, Personal $200, Family $400, Pro $1k, Business $5k,
Fleet Starter $10k. At 80% of budget, lookups queue to next UTC day with
"high demand" message.

**Teaser-only default for unverified numbers.** Lookup of a non-owned number
returns band + pillar titles only. Enforced in `composeScore` via
`redactForFree` when `tier === 'free'` OR `ownershipProven !== true`.

## 10. Australian compliance

**APP 1.7 ADM transparency (10 Dec 2026).** Hard deadline. Privacy policy
must disclose personal info used by scorer, decisions made solely by it
(Arthur does not currently), and decisions it substantially supports.
Sprint 9 ships the policy revision + user-facing "How we score your footprint"
explainer. Legal sign-off is a launch gate.

**APP 3.5/3.6 self-lookup defence.** OTP is the compliance spine. Policy
language: "OTP verification to the queried number ensures (a) the individual
whose personal information is the subject of the lookup is the person
requesting it (APP 3.6(a)), and (b) collection occurs by fair means (APP 3.5)."

**APP 8 overseas recipients.** Vonage (EU/UK), LeakCheck (Lithuania), IPQS
(US), Twilio (US/IE), Claude API (US). Each requires DPA with APP-equivalent
clauses. Single "Overseas Recipients" appendix lists all five.

**APP 11 security.** `msisdn_hash` is HMAC-SHA256(msisdn, vault_pepper) with
pepper in Supabase Vault. `msisdn_e164` column-encrypted (pgsodium) in
`phone_footprints` + `phone_footprint_monitors`. Decrypted only during
orchestrator execution; never logged.

**SPF Act 2026 positioning.** Public intent-to-apply as candidate **s 58BT
authorised third-party data gateway** once rules finalised (31 March 2027).

**Retention.** Footprints 7-day TTL then `anonymise_expired_footprints()`.
Monitors 13-month soft-delete without renewed consent. Cost telemetry 24
months. Audit trail 90 days Starter, contract-defined Enterprise.

**NDB runbook.** `/compliance/ndb-runbook.md` — detection → 4h triage → 72h
OAIC notification if "likely serious harm" → customer notification with
specific pillar data affected.

## 11. Ten-week sprint sequence

| Sprint | Weeks | Deliverable                                                                                                                                                  |
| ------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1     | 1–2   | Migrations v75–v77, Twilio Verify, feature flags, Vonage mock adapter, internal provider, free-tier API route with OTP/Turnstile/rate-limit                  |
| S2     | 3–4   | Free-tier end-to-end, footprint report page (redacted view), composite scorer with graceful degradation, cost_telemetry integration, admin live-lookups view |
| S3     | 5–6   | LeakCheck (flag-gated), Stripe Personal + Family SKUs, entitlements sync, PDF export, Claude explanation module                                              |
| S4     | 7–8   | Monitors fully wired, Inngest monthly-refresh, delta alerts, composite score v2 with telco_signal_history weights                                            |
| S5     | 9–10  | PWA wrapper, Chrome+Firefox extension right-click lookup, SIM Swap Heartbeat push (mock), Vonage approval-landed Inngest backfill                            |
| S6     | 11–12 | Vonage go-live: `FF_VONAGE_ENABLED=true` + `FF_VONAGE_MOCK_MODE=false` staging → backfill → prod flip. Buffer if approval slips.                             |
| S7     | 13–14 | Fleet Starter foundations: SSO (Clerk/WorkOS), bulk CSV, per-org webhooks, Stripe SKU                                                                        |
| S8     | 15–16 | Fleet features + Enterprise lane: 90-day audit, org PDF pack, manual Stripe invoicing, bank pilot outreach                                                   |
| S9     | 17–18 | Compliance cutover: APP 1.7 ADM disclosure, "How we score" explainer, APP 8 appendix, NDB runbook, legal sign-off                                            |
| S10    | 19–20 | Admin observability + launch: Vonage provider health, coverage heatmap, swap-swap correlation, cost-per-footprint, consumer launch                           |

## 12. Cost model

Unit costs (AUD, conservative):

- Internal scam DB: $0.001/call
- LeakCheck: $0.003/call enterprise
- Vonage NI v2 + SIM Swap + Device Swap bundle: $0.12/call
- IPQS fallback: $0.010/call
- Twilio Lookup: $0.012/call
- Twilio Verify AU SMS: $0.10/successful verification
- Claude explanation: $0.002/call
- PDF + storage: $0.0005/call

**Blended marginal cost** (paid, Vonage live): **A$0.145/footprint**.
**Teaser** (no Vonage/LeakCheck/Claude): **A$0.025** + $0.10 OTP (~30% trigger) = **A$0.055 blended**.

| Scale        | Paid | Free | Marginal/mo | Infra    | Total COGS/mo |
| ------------ | ---- | ---- | ----------- | -------- | ------------- |
| MVP (1k)     | 600  | 400  | A$109       | A$400    | **A$509**     |
| Growth (50k) | 20k  | 30k  | A$4,550     | A$2,500  | **A$7,050**   |
| Scale (500k) | 250k | 250k | A$50,000    | A$15,000 | **A$65,000**  |

Break-even: 70 Personal subs covers MVP. 900 Personal + 200 Family covers
Growth at A$2.7k margin.

**Vonage sensitivity**: negotiating $0.12 → $0.07 at 100k+/mo saves ~A$13k/mo
at Growth scale. Secure enterprise commit by Sprint 5.

## 13. Risks

| Risk                           | Mitigation                                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Vonage approval slippage       | All tables ship S1. Mock adapter. `coverage: "pending"` chip in UI. One flag flips on approval. Worst case: launch with 4 pillars + visible "pending". |
| Enumeration abuse              | OTP gate + Turnstile + per-MSISDN cross-IP downgrade + daily cost kill-switch + teaser-only default for unverified.                                    |
| LeakCheck DPA slippage         | `FF_LEAKCHECK_ENABLED=false` default. Pillar 2 weight redistributes automatically.                                                                     |
| APP 1.7 deadline (10 Dec 2026) | Sprint 9 compliance cutover 3 weeks pre-deadline. If sign-off slips, launch without Claude explanations.                                               |
| APP 3.5 self-lookup            | Teaser-only default + OTP-gated full lookup. Auditable via `ownershipProven` flag per footprint.                                                       |
| Pro cannibalisation            | Pro gets 100 footprint lookups included. Low risk; positive optionality.                                                                               |
| B2B timing vs Vonage           | Fleet Enterprise conversations from Sprint 7 with LOI clause contemplating mock-mode at start.                                                         |
| Twilio SIM-swap fallback       | Pre-negotiated (contact-sales). Provider interface supports swap with no schema changes.                                                               |

## Conclusion

Every Vonage-dependent table ships in Sprint 1. Every UI surface tolerates
`coverage: "pending"`. Every pillar degrades gracefully. This commitment is
what lets Arthur ship on time regardless of when Aduna + Telstra approval
lands — transforming Vonage from a launch blocker into a feature-flag flip.

Two moves compound over 18 months:

1. **s 58BT authorised third-party data gateway** positioning under SPF — no
   competitor has articulated this. Publish public intent-to-apply by end of
   Sprint 9.
2. **SIM Swap Heartbeat** is the one consumer feature Truecaller, Hiya,
   Whoscall, Norton cannot match. Hero position in consumer marketing from
   day one of live Vonage.

Ship Sprint 1 as specified. Flip `FF_VONAGE_MOCK_MODE=false` the day approval
lands. Be RFP-ready for banks by mid-2026. The rest is execution.
