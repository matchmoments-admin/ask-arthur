# Ask Arthur Shopfront — implementation plan

> Mission-aligned Shopify app combining (a) a public-good consumer-trust
> layer (Verified-by-Ask-Arthur badge + cross-merchant clone-detection +
> public Verified Directory) with (b) a paid merchant-side clone-takedown
>
> - brand-protection tier that funds the mission. Listed on the App Store
>   under the sub-brand **"Ask Arthur Shield"**; the parent brand stays
>   `askarthur.au`. Synthesises three rounds of research delivered
>   2026-05-23 — initial critique, deep technical research, and the
>   sharper validation critique that pivoted the merchant install hook.
>
> Status (2026-05-23): **plan-only, not started.** Open for review before
> any code. Sequenced AFTER the Shop Signal Stage 0 measurement window
> closes (~2026-06-19) and the planned B2B `/api/v1/shop-check` (#322)
> ships, since both feed Shopfront's verification engine. Owner: brendan.
>
> Cross-references:
>
> - [`docs/plans/shop-guard-v2.md`](./shop-guard-v2.md) — the consumer
>   side of the shop-trust pipeline. Shopfront reuses its
>   `runAnalysisCore` Module and APIVoid adapter.
> - GitHub #322 — B2B `/api/v1/shop-check`. The Shopify app is a thin
>   merchant-facing wrapper around the same endpoint plus chargeback
>   and clone-detection capabilities.
> - [`CLAUDE.md`](../../CLAUDE.md) → "Standard ship workflow" — every
>   migration here follows the v-numbered idempotent pattern.

## 1. Locked decisions

The strategic critique on 2026-05-23 surfaced a trade-off the deep
research didn't fully resolve. Both inputs are correct in isolation;
the synthesis below is what we'll build.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Why                                                                                                                                                                                                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Mission first, monetisation second.** Ship the free tier as a public-good product (Verified badge + clone-detection alerts + Verified Directory). Paid tiers (Shield Pro / Business / Enterprise) sell brand-protection-with-takedown to merchants whose ROI is brand defence + lost-sale prevention. The Layer 4 Ask Arthur Network — Threat Feed License enterprise SKU (Decision #11) is the actual funding engine.                                                                                                                                                                                                                                                                                        | User constraint: "I just want to stop scams and help people." A SaaS-only play maxes ARR but doesn't move scam losses. A free-only play has no funding engine. The hybrid scales the consumer-protection surface without grant dependence.                                                                                                |
| 2   | **Merchant install hook is clone-detection-with-takedown-commitment, NOT chargeback defence.** The Verified badge alone is too weak to drive installs (user feedback 2026-05-23). Chargeback defence puts us in a knife-fight against Signifyd (3,304 installs), NoFraud (6,923 installs, free <100 orders/mo), and Chargeflow (pay-on-win) where our AU data has no edge. **Clone-detection IS our edge** — Reddit Intel fake-shop corpus + scam_reports give us forward-looking detection from scammer infrastructure side, not reactive from merchant assets (which is all Recon does). The Pro/Business tiers add a **5-business-day human-triage takedown commitment** — table stakes Recon doesn't offer. | Third research input (2026-05-23) caught this: SMB merchants under 1,500 chargebacks/mo aren't even in VAMP scope; WTP floor for trust-and-safety apps at 100-500 orders/mo is $0-9. Clone-detection + takedown is the actual merchant-value wedge that aligns with our data moat. Chargeback features demoted to Stage 3 conditional.    |
| 3   | **Continuous re-verification, not point-in-time.** "Verified by Ask Arthur" is refreshed daily against scam-corpus + weekly against ABN/ACNC; badge auto-downgrades to "Verification expired" or "Reported" on negative signal. The merchant dashboard surfaces the badge state with provenance.                                                                                                                                                                                                                                                                                                                                                                                                                | User feedback Q2: "sounds good but we need to have a constant check process." Without this, the badge becomes a liability — we'd vouch for a merchant who later scammed customers.                                                                                                                                                        |
| 4   | **Manual human-triage takedown in v1 (Shield Pro+), automated infrastructure deferred to v2.** Stage 1 ships an Ask Arthur ops-side admin queue where confirmed clones get human-reviewed + auto-generated DMCA + registrar abuse + Cloudflare host abuse templates submitted on the merchant's behalf, with a 5-business-day SLA commitment. **This IS the merchant value Recon doesn't offer.** Free tier gets templates only (self-serve). Automated takedown infrastructure (Bustem partnership, registrar API integrations) is Stage 2 efficiency, not Stage 1 capability.                                                                                                                                 | User feedback Q1: takedowns have legal exposure that automation amplifies. Manual human triage at the volume Stage 1 produces (estimated 5-20 confirmed clones/month across the design-partner cohort) is operationally cheap and legally safer than automation. It is also the differentiator vs Recon's templates-only model.           |
| 5   | **Custom distribution before App Store.** 10-30 hand-picked design partners in weeks 6-12. App Store submission only after week-12 retention + verdict-accuracy data justifies the 5-10 day review queue and the Protected-Customer-Data Level 2 application.                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Research finding (confirmed): App Store is structurally weak for paid trust apps in 2026. Custom distribution proves the value proposition before we sink 6 weeks into App Store polish.                                                                                                                                                  |
| 6   | **Global from day one, AU data is the moat — but DROP "SPF-aligned" framing.** Don't gate Shopfront on AU geography. The AU-specific data assets (ABN Lookup free API, ACNC charity register, Scamwatch + NASC + ACSC threat feeds, RaaS Telegram scrapers, Reddit Intel fake-shop corpus) are differentiators for ANY merchant — clones target AU brands selling to US/UK shoppers too. Marketing language: **"Built on AU government threat-feed data + aligned with national scam-prevention principles."** NOT "SPF-compliant" / "SPF-ready" / "ACCC-recognised."                                                                                                                                           | User: "AU wedge I'm not held to. If we think we can help the world with this issue somehow that would be good." Third research input confirmed: Treasury explicitly excluded online marketplaces from SPF first-wave designation (Dec 2025); "SPF compliance" marketing is misleading since Shopify merchants are not regulated entities. |
| 7   | **Shopify partnership outreach is decoupled from the build.** Single email to Shopify Trust & Safety / Shop Pay product team in week 1. Don't gate anything on the response. If they engage → 875M-shopper distribution. If not → ship the merchant app anyway.                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Asymmetric upside, near-zero downside. Decoupling avoids the trap of waiting on a platform partner that may never reply.                                                                                                                                                                                                                  |
| 8   | **Reuse the existing scam-engine Module, don't fork.** Shopfront's verdict engine IS `runAnalysisCore` (plus chargeback-specific adapters). Same shopSignal extraction, same APIVoid integration, same scam_reports corpus join. The Shopify-specific code is the OAuth + Polaris UI + GraphQL Admin glue + Inngest fan-out — ~6-8 eng-weeks of net-new code.                                                                                                                                                                                                                                                                                                                                                   | The research's `packages/buyer-trust-core` IS `packages/scam-engine` with chargeback-specific verdict synthesis. Creating a parallel engine duplicates ~70% of the existing code and fragments the corpus. Deletion test fails for a separate package.                                                                                    |
| 9   | **Defer the chargeback guarantee model.** Stage 1 ships recommendation-only ("here's our verdict, merchant decides"). Stage 3 considers full liability shift, but only after ≥1,000 paying merchants AND ≥6 months of in-network chargeback distribution data exist to set actuarial reserves.                                                                                                                                                                                                                                                                                                                                                                                                                  | Below ~A$2M/mo GMV per merchant, variance dominates — a single A$2K luxury-goods dispute can wipe a year of premium. Guarantee economics need scale we don't have yet.                                                                                                                                                                    |
| 10  | **One parent brand (`askarthur.au`), Shopify App Store listing sub-brands as "Ask Arthur Shield."** Everything on the web lives at `askarthur.au/shopfront` (sub-route, not subdomain). The sub-brand on the App Store separates SLA expectations (merchants expect different uptime/support from consumer apps) without fragmenting the parent brand's SEO + trust signal.                                                                                                                                                                                                                                                                                                                                     | One brand for SEO/trust + cross-pollination with the consumer extension. Sub-brand on App Store listing handles the different SLA + support tier expectations cleanly (third research input recommendation).                                                                                                                              |
| 11  | **Add `Ask Arthur Network — Threat Feed License` enterprise SKU at A$1,500-2,500/mo.** Targets SPF-designated sectors from 1 July 2026 — banks, telcos, digital platforms (social/search/IM) — who ARE regulated and have compliance budget. This is where the regulatory tailwind actually monetises, and the MRR is what makes the free Shopify tier survivable (~$15-20K MRR needed to fund free-tier infra + support + takedown triage).                                                                                                                                                                                                                                                                    | Third research input math: current $99/$449 B2B tiers can't fund the free tier's marginal cost. Cloudflare/HIBP/Let's Encrypt model needs structural funding advantages we don't have. Enterprise threat-feed SKU is the missing funding engine.                                                                                          |
| 12  | **Lock concrete kill criteria.** Day-90 kill: <20 installs AND <5 takedown-alert→action conversions AND <2% directory CTR AND 0 inbound B2B from Shopify funnel. Day-270 kill: <200 installs AND no press coverage AND <A$2K MRR sourced from Shopify cross-sell. Re-plan immediately if Shopify announces native verified-merchant tier OR Treasury designates ecommerce under SPF.                                                                                                                                                                                                                                                                                                                            | Without hard kill points the project drifts past its natural sunset and absorbs eng-weeks that should redirect to consumer extension or B2B API. Day-90 and Day-270 are aligned to Stage 1 mid-point and Stage 2 entry gates.                                                                                                             |
| 13  | **Verified Directory affiliate policy with strict guardrails.** Affiliate links allowed only for verified-passing merchants; prominently disclosed on every listing; refused for any merchant with scam_report within trailing 12 months (even if subsequently cleared); ranking algorithmically independent of affiliate status. Codify as ADR before Directory ships.                                                                                                                                                                                                                                                                                                                                         | Replaces the flat-ban from the previous plan version. Adds optional revenue without compromising integrity, IF the disclosure + scam-window refusal rules are codified and audited. Closes off the "we ranked X higher because they paid" failure mode.                                                                                   |
| 14  | **Directory is the primary moat; Shopify app is one distribution channel.** Build `askarthur.au/verified/{shop-handle}` to own the brand, the SEO, the consumer-extension cross-pollination. The Shopify app embeds the badge that links into the Directory; the Directory does NOT depend on the Shopify app. If Shopify ships native verified-merchant tier (40-50% probability in 24 months per third research input), we are still the trust signal consumers recognise.                                                                                                                                                                                                                                    | Existential mitigation for the highest-magnitude platform risk. Without this framing, Shopify ships verified-merchant in Shop app and obsoletes us overnight. With this framing, that's a marketing moment ("the verified-merchant feature Shopify just shipped runs on data we already provide globally").                               |

## 2. Product surface

Three concentric layers, each load-bearing:

### Layer 1 — Public-good (free for all merchants on any Shopify plan)

| Feature                                                                                                                                                                 | What the merchant gets                                                                             | What Ask Arthur gets                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Verified-by-Ask-Arthur badge** (Order Status thank-you page UI extension, all-plans, no Plus required)                                                                | Trust signal at checkout; consumer-visible "verified merchant" cue                                 | Per-install backlink + brand impression on every shopper transaction                                  |
| **Verified Directory** listing at `askarthur.au/verified/{shop-handle}` with badge provenance, ABN/ACNC/scam-corpus check state, last-refresh date                      | Inbound customer acquisition channel; SEO surface; shopper-facing trust page                       | Directory traffic → consumer extension installs → more scam reports → better detection (the flywheel) |
| **Clone-detection alerts** — daily scan of our scam_reports + Reddit Intel fake-shop corpus + brand-mention scrape for merchant's domain/SKUs/assets being impersonated | Brand-protection intelligence (currently $20K-200K/yr enterprise tools); manual takedown templates | Merchants become an active reporting surface for new clone scams                                      |
| **Daily re-verification** — automated ABN/ACNC + scam-corpus re-check; badge auto-downgrades on negative signal                                                         | Merchant trusts the badge stays accurate; we trust we won't badge bad actors                       | Continuous data feedback loop into the corpus                                                         |
| 50 buyer-trust verdicts / month                                                                                                                                         | Spot-check on individual orders during fraud triage                                                | Onboarding wedge; flywheel data                                                                       |

### Layer 2 — Shield Pro tier (A$29/mo)

Adds for merchants who want active brand defence:

- **5-business-day human-triage takedown commitment** for confirmed clones (the differentiator vs Recon's template-only model)
- Full clone-detection feature set: TLD watchlist matching + logo/hero-image perceptual hash + JSON-LD product clone detection + Shopify theme fingerprint
- Pre-launch domain-squat alerts (we monitor new domain registrations against the merchant's brand assets and flag candidates _before_ the clone goes live)
- Outbound DMCA + registrar abuse + Cloudflare host abuse one-click submission (we generate; merchant approves and sends)
- Brand-mention scrape across Reddit, Telegram, our scam_reports corpus, and Reddit Intel pipeline
- Per-clone severity scoring + history dashboard
- Slack / email / webhook alert integrations

### Layer 3 — Shield Business tier (A$99/mo) + Enterprise (custom)

Adds for merchants doing >A$300K/mo GMV with material brand-impersonation exposure:

- Cross-merchant federated clone detection — if a clone is registered against the same scammer infrastructure that hit another Shield merchant, we surface it as a leading indicator (gated on Stage 2 privacy counsel opinion)
- **Outbound scam-link scanner** — scans merchant's marketing emails/SMS for inadvertent inclusion of known phishing URLs in their own copy / linked landing pages (genuinely novel; no competitor)
- **Supplier-vetting for dropship merchants** — ABN/ACNC + scam_reports + Reddit Intel cross-check on every supplier the merchant lists (leverages our existing AU data moat)
- Priority takedown queue (1-business-day human triage SLA)
- LLM-generated dispute-narrative detection on incoming chargeback responses (deferred Stage 3 capability surfaced earlier here only if Stage 1 traction justifies)
- API access to underlying B2B endpoint (#322)
- Concierge onboarding

**Shield Enterprise tier (A$299/mo floor, custom thereafter)** adds multi-store, white-labelled badge, dedicated CSM, custom takedown SLA, the chargeback-defence features (CE 3.0, Verifi/Ethoca, VAMP monitor) — but ONLY if Stage 2 design-partner conversations validate willingness-to-pay above A$200/mo for those specifically. Otherwise chargeback features remain a Stage 3 conditional roadmap, not committed scope.

### Layer 4 — Ask Arthur Network — Threat Feed License (A$1,500-2,500/mo enterprise SKU)

**Not a Shopify app** — sold direct to SPF-designated sectors from 1 July 2026:

- Banks (looking to detect inbound scam payments)
- Telcos (looking to detect scam-SMS sender IDs)
- Digital platforms — social media / search engine / instant messaging (looking to detect scam ads + landing pages)
- Government agencies + consumer protection orgs (IDCARE, ACCC, NASC)

What they get: API access to our full threat-feed corpus + Reddit Intel narrative classifier + RaaS Telegram cross-reference + ABN/ACNC verification engine, with SLA + named support + custom integrations.

This SKU is the funding engine for the free Shopify tier. **Without ~$15-20K MRR from this tier (≈10-15 enterprise customers), the free-tier infra + support + takedown triage will bleed the company.** Stage 0 includes initial outreach to 5-10 SPF-designated organisations to validate willingness-to-pay at this price band BEFORE Stage 1 build commits resources.

## 3. Architecture

```mermaid
flowchart TD
    subgraph Merchant["Merchant's Shopify store (any plan)"]
        OS[orders/create webhook]
        DIS[disputes/create webhook]
        OSE[Order Status UI extension - badge render]
    end

    subgraph Shopfront["apps/shopfront-shopify on Vercel ap-southeast-2"]
        WH[/api/shopify/webhooks - HMAC verify - <300ms]
        DASH[Polaris dashboard - App Bridge - GraphQL Admin]
        BILL[Shopify Managed Pricing - usage events]
    end

    subgraph Engine["Reused: packages/scam-engine + new packages/shopfront-glue"]
        CORE[runAnalysisCore - existing]
        BTC[buyer-trust verdict synth - new]
        CE3[CE 3.0 evidence pack - new]
        VERIFY[continuous verification cron - new]
    end

    subgraph Data["Supabase - existing + new tables"]
        SCAM[scam_reports + verified_scams - existing]
        ACNC[acnc_charities - existing]
        REDDIT[reddit_post_intel - existing]
        SHOPV[shopfront_shops - new]
        SHOPO[shopfront_order_verdicts - new]
        SHOPV2[shopfront_verifications - new daily refresh state]
    end

    subgraph Public["askarthur.au/verified - existing brand surface"]
        DIR[Verified Directory - public]
        PROVE[Per-merchant provenance page]
    end

    OS -->|HMAC POST| WH
    DIS -->|HMAC POST| WH
    WH -->|Inngest fan-out| BTC
    BTC --> CORE
    CORE --> SCAM
    CORE --> ACNC
    CORE --> REDDIT
    BTC --> SHOPO
    BTC -->|orderRiskAssessmentCreate| OS

    VERIFY -->|daily cron| SHOPV2
    VERIFY --> CORE
    VERIFY -->|badge state| DIR

    DASH --> SHOPV
    DASH --> SHOPO
    DASH --> CE3

    OSE -->|badge JSON| DIR
    DIR --> PROVE
    PROVE -->|consumer extension CTA| Extension[Existing Chrome extension]
```

### 3.1 Reused modules (no fork)

- `@askarthur/scam-engine` — `runAnalysisCore`, `shop-signal`, APIVoid adapter (Deep Shop Check from #339). The buyer-trust verdict is `runAnalysisCore` output + cluster-graph join + Shopify-specific facts.
- `@askarthur/types` — existing `Tables<>` (post #295) extended with the four new `shopfront_*` tables.
- `@askarthur/supabase` — existing client factories.
- `@askarthur/utils` — logger, feature-flags, rate-limit, cost-telemetry (`logCost` with `feature: 'shopfront_*'`).
- `pipeline/scrapers/` — existing RaaS Telegram + Scamwatch + ACNC scrapers ARE the data moat. Zero changes; Shopfront just reads.

### 3.2 New code (~6-8 eng-weeks)

- `apps/shopfront-shopify/` — Next.js App Router, App Bridge 4, Polaris React, GraphQL Admin 2026-04. OAuth (managed install, offline + online tokens), GDPR mandatory webhooks (`customers/data_request`, `customers/redact`, `shop/redact`), Order Status UI extension (badge), embedded admin dashboard. **App Store listing sub-brand: "Ask Arthur Shield."**
- `packages/shopfront-glue/` — typed wrappers around clone-detection scanners, billing API hooks, takedown-template assembly, continuous-verification scheduler. Thin orchestration over `scam-engine`; ≤2K LOC.
- `supabase/migrations/v140_shopfront_init.sql` — `shopfront_shops`, `shopfront_verifications`, `shopfront_clone_alerts`, `shopfront_takedown_attempts`, `shopfront_directory_listings`. All RLS-enabled, indexed for the merchant-isolation query pattern. Tokens encrypted via pgsodium.
- Inngest functions — `shopfront/clone-scan` (daily cron, the core feature), `shopfront/verify-merchants` (daily cron — continuous re-verification), `shopfront/takedown-triage` (queue for paid-tier 5-BD SLA), `shopfront/directory-refresh` (Directory page regeneration).
- Public surface — `apps/web/app/verified/page.tsx` (directory index) + `apps/web/app/verified/[shop]/page.tsx` (per-merchant provenance page). **This is the disintermediation moat per Decision #14.**

### 3.3 Cost telemetry (mandatory per CLAUDE.md)

Every paid call tagged via `logCost`:

```ts
logCost({
  feature: "shopfront_clone_scan" | "shopfront_verify" | "shopfront_takedown",
  provider: "apivoid" | "anthropic" | "whois-api" | "perceptual-hash-service",
  operation: "...",
  estimatedCostUsd: ...,
  metadata: { shop_id, alert_id },
  requestId: ...
});
```

New `feature_brakes` rows:

- `feature_brakes.shopfront_clone_scan` (A$15/day default — daily cron over N merchants × clone-candidate URLs)
- `feature_brakes.shopfront_verify` (A$5/day default — ABN/ACNC/scam-corpus re-check)
- `feature_brakes.shopfront_takedown` (A$5/day default — outbound takedown submission costs)

## 4. Continuous-verification pipeline (Decision #3)

The badge cannot be a point-in-time stamp. Verification is a **daily cron** + **on-trigger refresh** + **public provenance page** with the current state and last-check timestamp.

| Trigger                                           | Action                                                                                                                                       | Badge state outcome                                                                                                                               |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daily 02:00 UTC cron over all installed shops     | Re-query ABN Lookup, ACNC, scam_reports, verified_scams, Reddit Intel fake-shop corpus, APIVoid (sampled, A$5/day cap) for merchant's domain | `verified` → `verified` (refresh date updated), or `verified` → `expired` (data source unavailable), or `verified` → `reported` (negative signal) |
| New scam_report row matches merchant's domain/SKU | Badge immediately downgrades to `reported`; merchant emailed + dashboard banner                                                              | `verified` → `reported`                                                                                                                           |
| Merchant requests manual re-check from dashboard  | On-demand re-verify (≤1/hour rate-limited)                                                                                                   | refresh in <30s                                                                                                                                   |
| ABN cancelled or ACNC deregistered                | Detected by daily cron; badge downgrades to `expired` with explanation                                                                       | `verified` → `expired`                                                                                                                            |
| 90 days since last verification (safety net)      | Force re-verify if any source was unreachable on the daily cron                                                                              | depends on result                                                                                                                                 |

Badge embed (theme app extension) reads the live state from our API on render — no stale embedded data. Cache TTL ≤6h on the badge JSON to balance freshness vs API load. Public provenance page (`askarthur.au/verified/{shop-handle}`) shows the full history: when first verified, what was checked, current state, link to download verification certificate (audit-trail JSON signed with our key).

This is the "constant check process" the user flagged as a requirement.

## 5. Phased rollout

### Stage 0 — preflight (week 1, decoupled from build)

1. **Submit Protected Customer Data Level 2 application** in Shopify Partner Dashboard. Approval lead time 3-6 weeks; longest-pole blocker for any merchant-data feature. _Note: clone-detection + badge don't strictly need Level 2 (merchant-data only), so Stage 1 can ship without it; chargeback features in Stage 3 would need it._
2. **Single email to Shopify Trust & Safety + Shop Pay product team**. Pitch: scam-detection data feed for Shop Pay fraud rails / Shop app reporting flow. Don't gate anything on the reply.
3. **Initial outreach to 5-10 SPF-designated organisations** (banks, telcos, search/social platforms) to validate willingness-to-pay for the A$1,500-2,500/mo Ask Arthur Network — Threat Feed License (Decision #11). This is the funding-engine validation gate — if WTP doesn't land here, Stage 1 free-tier scope must shrink to fit current B2B MRR.
4. **External privacy counsel** (Maddocks or G+T) for written opinion on cross-merchant federated clone-clustering under APP 6.2(c) and APP 8. Budget A$8-15K. Required before Stage 2 cross-merchant clone-detection ships.
5. **Decision: takedown partner**. Outreach to Bustem (pay-per-takedown) and similar to scope a partnership for the Stage 1 5-BD takedown SLA. Defer to in-house human-triage for v1 if no good fit.
6. **Lawyer-vetted disclaimer language** for the Verified badge ("verified as of [date], not a warranty, point-in-time, may be revoked"), the clone-detection alerts ("matches signals at X% confidence, not legal characterisation"), and the Directory (s 18 ACL + uniform defamation compliance). Budget A$3-5K for the wording pack.

### Stage 1 — free tier + Shield Pro tier (weeks 2-10, ~9 eng-weeks)

**Stage 1 hook (Decision #2): clone-detection-with-5-BD-takedown-commitment is THE merchant install reason.** Chargeback features are NOT in Stage 1. Stage 1 ships custom-distributed to 10-30 design partners. App Store submission deferred to Stage 2.

| Workstream                                                                                                                                                                             | Eng-weeks          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `apps/shopfront-shopify` skeleton, App Bridge 4, Polaris dashboard, OAuth, GDPR webhooks                                                                                               | 1.5                |
| `packages/shopfront-glue` — Shopify Admin GraphQL wrappers (NO `orderRiskAssessmentCreate` in Stage 1; deferred)                                                                       | 0.5                |
| `supabase/migrations/v140` + RLS + pgsodium token encryption + clone-alert + takedown tables                                                                                           | 0.75               |
| **Clone-detection scanners** — TLD watchlist matching, logo/hero pHash, JSON-LD product clone, Shopify theme fingerprint. Reuses Reddit Intel + scam_reports + brand-mention scrape    | 2.0                |
| **5-BD takedown triage queue** — admin dashboard for Ask Arthur ops to review confirmed clones + auto-generate DMCA / registrar abuse / Cloudflare host abuse templates + log outcomes | 1.0                |
| Continuous-verification cron + badge state machine (Decision #3)                                                                                                                       | 1.0                |
| Order Status thank-you trust badge (UI extension, all-plans) with dynamic-on-hover API check (badge defence)                                                                           | 0.5                |
| Verified Directory `/verified` + per-merchant provenance page (Decision #14 — primary moat)                                                                                            | 1.0                |
| Shopify Managed Pricing — Free + Shield Pro (A$29) + Shield Business (A$99) tier setup                                                                                                 | 0.5                |
| Cost telemetry hooks + feature_brakes rows + ops runbook                                                                                                                               | 0.5                |
| Custom-distribution onboarding flow — per-store install links from Partner Dashboard                                                                                                   | 0.25               |
| **Total**                                                                                                                                                                              | **~9.5 eng-weeks** |

### Stage 2 — outbound scam-link scanner + supplier-vetting + App Store submission (Q4 2026, ~5-6 eng-weeks)

Pre-condition: Stage 1 design-partner cohort produces ≥10 paying merchants AND ≥5 published takedown case studies. Below that bar, do NOT invest App Store polish — the wedge isn't proven.

- **Outbound scam-link scanner** (Decision #11 / Layer 3) — merchants paste their marketing email/SMS copy; we scan embedded links against our scam_reports + Reddit Intel + brand-mention corpus. Real harm vector (merchants accidentally including phishing URLs in their own marketing), zero competitors today.
- **Supplier-vetting for dropship merchants** (Decision #11 / Layer 3) — ABN/ACNC + scam_reports + Reddit Intel cross-check on every supplier the merchant lists in their dropship feed. Real moat vs Spocket/AliExpress vetting (which is essentially non-existent).
- App Store listing copy + screencasts + Built-for-Shopify polish (sub-brand "Ask Arthur Shield")
- App Store submission + first review (5-10 BD)
- Cross-merchant federated clone clustering (gated on Stage 0 privacy counsel opinion)
- LLM-generated dispute-narrative detection — moved from Stage 1 because it's chargeback-adjacent; ship here only if Stage 1 merchants explicitly ask for it

Pre-condition: ≥10 paying design-partner merchants. Below 10, do not invest the App Store polish — the Stage 1 wedge isn't proven.

- CE 3.0 evidence-pack generator + auto-submission to Stripe + Shopify Payments AU
- Verifi RDR + Ethoca Alerts integration (Business tier add-on)
- LLM-generated dispute-narrative detection (Claude Haiku 4.5)
- VAMP ratio monitor + Telegram digest alerting
- App Store listing copy + screencasts + Built-for-Shopify polish
- App Store submission + first review (5-10 BD)
- Cross-merchant federated cluster API (gated on privacy counsel opinion from Stage 0)

### Stage 3 — Plus checkout-blocking + guarantee pilot (Q2 2027+, ~10-12 eng-weeks)

Pre-condition: ≥1,000 paying merchants AND ≥6 months of in-network chargeback distribution data. Most of these are conditional features, not committed scope.

- Checkout UI extension with `block_progress` (Plus only, feature-flagged, opt-in per Jan 2026 Shopify default change)
- Optional chargeback-guarantee model with actuarial reserves
- Vonage AU SIM-swap live (gated on carrier approval)
- Multi-store / multi-brand Enterprise tooling
- Bustem-style takedown partner integration

## 6. Risks + open questions

1. **Protected Customer Data Level 2 rejection** — without it, customer email/phone/address fields return `null` from the Shopify API. Mitigation: degrade Stage 1 to hash-only clustering using IP + device + order metadata (loses ~25% of signal value); badge + clone-detection layer still works because they don't need PII.

2. **Cross-merchant federated cluster joins — legal sign-off required.** Stage 2 only. Privacy counsel must confirm APP 6.2(c) permitted-general-situation applies to our specific architecture. Federated bloom-filter ("do you have this hash?") is the working proposal.

3. **Shopify platform risk — quantified at 40-50% probability within 24 months** (third research input) of Shopify shipping native "Verified Merchant" in the Shop app. This is the highest-magnitude risk in the plan. Mitigation per Decision #14: **the Verified Directory at `askarthur.au/verified` is the moat, NOT the Shopify app.** The Shopify app embeds a badge that links into our Directory; the Directory does not depend on the Shopify app. If Shopify ships native verified-merchant, we reposition as "the trust signal consumers already recognise, now available everywhere Shopify's native feature isn't" — and the consumer extension's per-page badge auto-verification (Decision #14 surface) becomes the cross-platform enforcement layer Shopify can't ship.

4. **The "badge becomes a liability" risk.** If we badge a merchant who later scams, the brand damage is asymmetric. Mitigation: continuous-verification pipeline (Decision #3) + explicit per-merchant disclosure ("verified as of [date], rechecked daily") + auto-downgrade on first negative signal + Verified Directory shows badge history transparently. The badge promise is _"as of right now, no negative signal,"_ not _"warranty."_

5. **Disputifier January 2026 security incident lesson.** A small fraction of Disputifier merchants had Shopify API tokens exfiltrated and abused. Mitigation: tokens encrypted at rest via pgsodium; Inngest event payloads NEVER contain tokens; refund-rate anomaly detection per shop per hour; token rotation on suspicious-activity signals.

6. **Continuous-verification API cost.** Daily re-verify across N merchants × M data sources can scale faster than A$5/day brake allows. Mitigation: hierarchical re-verification — heavy checks (APIVoid, full crawl) monthly, light checks (scam_reports.domain join) daily. `feature_brakes.shopfront_verify` is the hard cap.

7. **Mission-vs-revenue tension on the public Verified Directory.** Affiliate-revenue temptation could taint the directory's trust if implemented loosely. Mitigation per Decision #13: **affiliate revenue allowed under strict guardrails** — verified-passing merchants only; prominently disclosed on every listing; refused for any merchant with scam_report within trailing 12 months even if subsequently cleared; ranking algorithmically independent of affiliate status. Codify as ADR before Directory ships in Stage 1. NO sponsored placements. NO paid-higher-ranking. The "we ranked X higher because they paid" failure mode is closed by codifying the policy.

8. **Does Decision #6 (global from day one) create an obligation to verify non-AU merchants we don't have data on?** Mitigation: the Verified badge state machine has a `not-verified-in-region` outcome for merchants in countries where we lack regulator data (i.e. anywhere except AU). They get the chargeback-prevention SaaS layer + clone-detection but NOT the public Verified badge. This is honest and avoids the "we vouched for a merchant we couldn't actually verify" failure mode.

9. **Open: who is the merchant-side product manager?** Shopfront is a different product from the consumer scam checker — different users, different sales motion, different success metrics. Either (a) brendan owns both with explicit context switching, (b) a co-founder/contractor owns merchant-side, or (c) we defer until a merchant-PM is in place. This isn't a tech question but it bites at week 5 when the first design-partner merchant emails support.

## 7. Concrete next steps (this week, decoupled from full build)

1. **File this plan as GitHub issues** via `/to-issues` skill — break Stage 0 + Stage 1 into independently-grabbable tickets with the `architecture-review` label for review before any code.
2. **Open the Protected Customer Data Level 2 application** in the Shopify Partner Dashboard (Stage 0 step 1). Longest-pole for any merchant-data feature; Stage 1 ships without it but Stage 3 needs it.
3. **Send the Shopify Trust & Safety / Shop Pay outreach email** (Stage 0 step 2). Single email; no follow-through commitment.
4. **Begin SPF-designated-sector outreach** (Stage 0 step 3) — 5-10 banks/telcos/digital-platforms to validate A$1,500-2,500/mo Ask Arthur Network — Threat Feed License WTP. **This is the funding-engine validation gate.**
5. **Scope external privacy counsel + disclaimer-language lawyer** (Stage 0 steps 4 + 6) — get quotes from Maddocks or G+T. Privacy work books for late-Stage 1; disclaimer-language work must complete before Stage 1 ships.
6. **Defer build start until** (a) Shop Signal Stage 0 measurement window closes ~2026-06-19, (b) #322 B2B endpoint ships, (c) Stage 0 preflight items above are in motion, (d) **SPF-sector WTP validation lands positive** (else the free-tier scope shrinks). Stage 1 build starts week-of 2026-06-22 at earliest.

## 8. What this plan deliberately doesn't do

- Doesn't ship chargeback defence as the merchant hook. Death-match against Signifyd / NoFraud / Chargeflow where our data has no edge. Chargeback features are Stage 3 conditional, never the lead.
- Doesn't ship a paid-only SaaS. The free tier IS the public good. Funded by the Layer 4 Ask Arthur Network — Threat Feed License enterprise SKU.
- Doesn't ship a separate `packages/buyer-trust-core`. The deletion test fails — it'd be a thin wrapper over `scam-engine` that fragments the corpus.
- Doesn't position Shopfront as AU-only. AU-specific data is the moat globally.
- Doesn't market as "SPF-compliant" or "SPF-ready" or "ACCC-recognised." Treasury explicitly excluded ecommerce from SPF first-wave designation; "SPF compliance" claims are misleading for Shopify merchants.
- Doesn't ship checkout-blocking in Stage 1. Plus-only + opt-in-by-default since Jan 2026 + non-Plus customers can't use it. Wrong place to invest first.
- Doesn't ship a chargeback guarantee. Variance dominates below ~A$2M/mo GMV per merchant; defer until we have scale.
- Doesn't pursue cross-platform expansion (BigCommerce, Magento, WooCommerce) before Shopify is at A$50K MRR.
- Doesn't make the Shopify app the primary surface. The Verified Directory at `askarthur.au/verified` is the moat (Decision #14) — Shopify app is one distribution channel for the badge.
- Doesn't ban Directory affiliate revenue outright. Allowed under strict guardrails (Decision #13) — verified-passing only, prominently disclosed, refused within 12 months of any scam_report.

---

## Caveats

- Eng-week estimates assume one full-stack senior + part-time designer + brendan in PM/strategy. Adjust if staffing changes.
- Pricing tiers (Shield Pro A$29 / Shield Business A$99 / Shield Enterprise A$299 / Ask Arthur Network A$1,500-2,500) are post-research-synthesis estimates; revisit after first 10 design-partner conversations + 5 SPF-sector outreach conversations. Willingness-to-pay validation is BOTH a Stage 0 gate (for Layer 4 enterprise SKU) AND a Stage 1 acceptance criterion (for Shield tiers).
- The Verified Directory consumer flywheel ("badge → directory → extension installs → corpus → better detection") is the structural argument for why this plan is mission-aligned. If it doesn't measurably feed the consumer extension's growth within 6 months, the entire mission framing is unproven and we should revisit Stage 3 scope.
- The Shopify partnership email in Stage 0 has no SLA. If it lands a meeting → asymmetric upside (875M shopper reach). If it doesn't → we ship anyway. Don't conflate "no reply" with "no signal" — Shopify product teams are notoriously slow.
- The continuous-verification pipeline (Decision #3) is the part most likely to surprise us at scale. Daily re-verify across thousands of merchants with multiple paid data sources will hit `feature_brakes` early; budget instrumentation accordingly.
