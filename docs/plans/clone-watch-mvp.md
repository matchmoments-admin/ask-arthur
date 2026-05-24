# Clone-watch MVP — pre-Stage-1 engine that proves the Shopfront value

**Status:** planning locked 2026-05-24. Build via the 3-PR sequence in §4.
**Stage label:** S0E (Stage 0 — Engine). Sits between Stage 0 wall-clock and Stage 1 build.
**Cost:** A$0/mo marginal — verified against current Inngest + Vercel + Supabase usage.

## Why this exists

The locked Shopfront build chain (`docs/plans/shopify-shopfront.md`) orders work as:

1. Stage 0 wall-clock (lawyer, PCD-L2, partnerships)
2. Stage 1 Shield app (badge + Directory + free clone-scanner gated to installed merchants)
3. Stage 2 Phase B (CT firehose, gated on ≥10 paying merchants)
4. Phase C (NRD + Voyage + Hetzner, gated on Layer 4 WTP signal)

User insight 2026-05-24: **the Shield app is a wrapper around evidence the engine produces.** Promising "we'll alert you if a clone is detected" to a prospective merchant is hollow if we have zero detections to show. The outreach in #367 (Shopify T&S) and #370 (takedown partners) is vaporware without an operating engine; #368 (SPF-sector P1 funding gate) is a much stronger pitch with a live evidence URL than with corpus stats alone.

The clone-watch MVP **pulls the deterministic NRD-lexical engine forward** to a Pre-Stage-1 layer that runs against a public AU brand watchlist (not gated to installed merchants). Output is a public `askarthur.au/clone-watch` page listing yesterday's suspect domain registrations. Every Stage 0 outreach lands on this URL.

## What stays from the locked plan

- **ADR-0015 signal model** unchanged. MVP uses Brand Match (deterministic-string) only. Visual Match / Semantic Match unchanged.
- **ADR-0016 source layering** mostly unchanged. NRD pulled forward (see §3 amendment). Calidog CT firehose still Phase B, gated on ≥10 paying merchants + 48h stability spike. Voyage embeddings + Hetzner + cross-merchant federation still Phase C.
- **All 6 ADRs (0011-0016)** load-bearing.
- **Disclaimer pack v0** (`docs/policy/draft-disclaimer-pack-v0.md`) still ships to lawyer. The public `/clone-watch` page borrows its factual-signal-only principles for v0 copy; replaced with lawyer-vetted v1 when #371 returns.
- **`packages/shopfront-glue/`** is the home for all MVP code (deletion test still fails for `packages/domain-monitor/` at MVP scope).
- **`packages/scam-engine/src/inngest/ct-monitor.ts`** is NOT touched. Different product surface (Decision #3).
- **`shopfront_clone_alerts` table** is the single write target (unified per Decision #1). MVP writes rows with `target_shop_id = NULL` and `inferred_target_domain = <matched_brand>` + `source = 'nrd'`.
- **#373 v140 migration** is moved forward — MVP ships v140 (full schema: `shopfront_shops` + `shopfront_clone_alerts` + `shopfront_takedown_attempts`). #373 inherits the schema instead of creating it. `shopfront_shops` stays empty until #373 actually installs merchants.

## What changes

### 1. NRD source layer pulled forward

ADR-0016 puts whoisds NRD daily zip in Phase C. The MVP pulls it forward to a new "Layer 0" — a brand-watchlist-driven (not installed-merchant-driven) lexical sweep over a free public NRD source. Rationale: NRD daily zip costs A$0, lexical matching costs A$0, and the public-evidence proof-of-life requirement makes this the highest-leverage thing to ship before any outreach lands.

This does **not** change ADR-0015 (signal model is still deterministic-only at the MVP / Phase A). It is a small amendment to ADR-0016's source layering — captured in §3 below.

### 2. New write path on `shopfront_clone_alerts`

Phase A as scoped in #376 writes only `target_shop_id IS NOT NULL` + `source = 'corpus'` rows (per-installed-merchant corpus matches). The MVP introduces the `target_shop_id IS NULL` + `inferred_target_domain IS NOT NULL` + `source = 'nrd'` branch as the **first** write path, ahead of Phase A's installed-merchant path. The schema already supports both via the existing CHECK constraint.

### 3. New public surface

Nothing in the locked plan describes a pre-merchant public page. The MVP adds `askarthur.au/clone-watch` — read-only, factual-signal-only, no merchant accounts required, no merchant authentication needed. The same page becomes the inbound channel for #385 cold-outreach when an AU merchant whose brand we matched lands on it from search or from our email.

### 4. AU brand watchlist as a config file

The locked plan derives the brand-keyword set from installed `shopfront_shops`. The MVP uses a static AU brand watchlist (~50 retail merchants — Bunnings, Woolworths, Coles, Westpac, etc.) committed to source. When installed merchants exist later, the matcher unions both sets. The watchlist file is the seam — easy to extend, easy to lawyer-vet, easy to remove an entry if a brand requests opt-out.

## ADR-0016 amendment (text committed in same PR as this plan)

To be appended to `docs/adr/0016-clone-detection-source-layering.md` after the "Reversal trigger" section, before "Related":

> ## Amendment 2026-05-24 — NRD pulled forward to Pre-Stage-1 MVP (Layer 0)
>
> A pre-Stage-1 MVP layer ("Layer 0 — clone-watch") is added that runs the whoisds NRD daily zip against a static AU brand watchlist. Layer 0 sits BEFORE Phase A's installed-merchant scope and feeds the public `askarthur.au/clone-watch` page. Justification: Layer 0 costs A$0/mo marginal (whoisds free tier + deterministic lexical matching + 1 daily Inngest fn within free-tier headroom) and produces the evidence URL every Stage 0 outreach needs.
>
> What moves: whoisds NRD daily zip ingest (Phase C → Layer 0). What stays: Voyage embeddings (still Phase C), Hetzner certstream-server (still Phase C conditional), cross-merchant federated clustering (still Phase C). Calidog CT firehose (still Phase B, gated on ≥10 paying merchants + 48h stability spike).
>
> Where Layer 0 writes: same `shopfront_clone_alerts` table (Decision #1 unchanged) with `target_shop_id IS NULL` + `inferred_target_domain` populated + `source = 'nrd'`. The schema's existing CHECK constraint and `idx_clone_alerts_unverified` partial index already support this branch — no schema change.
>
> Where Layer 0 code lives: `packages/shopfront-glue/` (same as Phase A). Deletion test still fails for `packages/domain-monitor/` at this scope.
>
> Where the public page lives: `apps/web/app/clone-watch/` (Next.js App Router).
>
> Source-layering table updated:
>
> | Phase       | Sources                                                                                                     | Storage                                                                  | Package                                               |
> | ----------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------- |
> | **0 (MVP)** | whoisds NRD daily zip × static AU brand watchlist (~50 brands)                                              | `shopfront_clone_alerts` (target_shop_id IS NULL branch, source = 'nrd') | `packages/shopfront-glue/`                            |
> | A (#376)    | Brand-keyword corpus over `scam_reports` + `reddit_post_intel` + `feed_items` × installed `shopfront_shops` | `shopfront_clone_alerts` (target_shop_id IS NOT NULL, source = 'corpus') | `packages/shopfront-glue/`                            |
> | B           | Calidog public certstream WSS + lexical-pattern matcher                                                     | SAME `shopfront_clone_alerts` (NOT a parallel table)                     | `packages/shopfront-glue/` (extended)                 |
> | C           | Voyage embeddings + Hetzner (conditional) + cross-merchant federation                                       | `shopfront_clone_alerts` + sibling `shopfront_clone_alerts_embeddings`   | `packages/domain-monitor/` (deletion test now passes) |

## $0 cost analysis (verified)

**Current Inngest functions:** ~25 across the repo. Cron distribution:

- 12+ daily-or-less-frequent
- 6 every-N-hours (every 4-12h)
- 3 every 30 minutes
- 1 every 5 minutes (feedback-triage-refresh)

**Current Vercel crons:** 17 routes (per `apps/web/vercel.json`). Max cron count per Vercel Pro is 40. **23 free slots remaining.**

**MVP adds:**

- 1 daily Inngest function (`shopfront-nrd-daily-ingest`) → +30 runs/mo → well within Inngest free-tier headroom (Inngest hobby = 25K runs/mo; Starter = 250K/mo)
- 0 new Vercel cron routes (Inngest handles the cadence)
- 1 new Supabase table (`shopfront_clone_alerts` + 2 siblings) — written daily ~10-50 rows
- 0 new external paid APIs (whoisds free tier, Telegram bot already used by other digests)
- 0 new R2 / Blob storage (NRD zip downloaded + parsed + discarded in-memory each run)

**Total marginal cost: A$0/mo.** No new feature brake required at MVP; existing `feature_brakes.shopfront_clone_scan` (A$15/d) covers the eventual Phase A/B/C combined budget.

**Operational notes:**

- whoisds.com free tier requires manual signup at https://www.whoisds.com (Brendan one-time, captures the daily-download URL with embedded token). Capture the URL in Vercel env as `WHOISDS_NRD_ZIP_URL`. URL rotates monthly per whoisds policy.
- NRD zip is ~50-200MB (~100K-1M domains/day). Download + parse in chunks; chunked DB writes ≤5K/iteration per CLAUDE.md hot-table rules.
- `statement_timeout='300s'` cap per CLAUDE.md "long-running write loop" rule.

## 3-PR sequence

| PR  | Title                                                                                                 | Files                                                                                                                                                | Wall-clock | Issue |
| --- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----- |
| 1   | feat(shopfront-glue): clone-watch MVP foundation — v140 schema + AU brand watchlist + lexical matcher | new `packages/shopfront-glue/` package; `supabase/migrations/v140_shopfront_init.sql`; `au-brand-watchlist.ts`; `lexical-match.ts` + unit tests      | ~1.5 days  | S0E.1 |
| 2   | feat(shopfront-glue): NRD daily Inngest ingest + Telegram digest                                      | `packages/scam-engine/src/inngest/shopfront-nrd-daily-ingest.ts`; env var `WHOISDS_NRD_ZIP_URL`; feature flag `FF_SHOPFRONT_CLONE_WATCH` default OFF | ~1.5 days  | S0E.2 |
| 3   | feat(web): public /clone-watch page + ADR-0016 amendment commit                                       | `apps/web/app/clone-watch/page.tsx`; optional `/clone-watch/[brand]/page.tsx`; sitemap + robots; `docs/adr/0016-...md` addendum; #376 body amendment | ~1 day     | S0E.3 |

**Total wall-clock:** ~4 days of focused work for a working engine + public URL.

### PR 1 detail (S0E.1)

**Goal:** schema + matcher in place. No execution yet.

**Migration v140 (`supabase/migrations/v140_shopfront_init.sql`):**

- `shopfront_shops` (per #376 schema reference; stays empty until #373)
- `shopfront_clone_alerts` (per #376 locked schema, ALL columns + CHECK + indexes)
- `shopfront_takedown_attempts` (per #376 locked schema)
- RLS service-role only on all three
- Apply via `mcp__supabase__apply_migration` against project `rquomhcgnodxzkhokwni`
- Verify via `mcp__supabase__get_advisors` (security + performance) — no new ERRORs

**Package `packages/shopfront-glue/`:**

- Standard pnpm workspace package shape (`package.json`, `tsconfig.json`, `src/index.ts`)
- `src/au-brand-watchlist.ts`: exported `AU_BRAND_WATCHLIST` array of ~50 brands (Bunnings, Woolworths, Coles, Westpac, NAB, ANZ, CBA, Telstra, Optus, Vodafone, Australia Post, Myer, David Jones, JB Hi-Fi, Harvey Norman, Officeworks, Kmart, Target, Big W, Aldi, IGA, Dan Murphy's, BWS, Liquorland, Chemist Warehouse, Priceline, Bunnings, Mitre 10, Reece, Toll, StarTrack, Sendle, Domino's, McDonald's, KFC, Hungry Jack's, Subway, Coles Express, 7-Eleven, ALDI, Toyworld, Smiggle, Cotton On, Bonds, Country Road, Witchery, Sportsgirl, Glue Store, Universal Store, City Beach, Surfstitch). Each entry: `{ brand: string, legitimate_domains: string[], severity_floor: 'low' | 'medium' | 'high' }`. Severity floor caps allow trusted brands (banks, govt-adjacent) to default to high — separate from the composite-score severity tier.
- `src/lexical-match.ts`: `lexicalMatch(domain: string, watchlist: BrandEntry[]): MatchResult | null` — runs Levenshtein edit-distance + Unicode confusables + punycode normalisation + brand-substring detection. Returns `{ brand, score, signal_type: 'levenshtein' | 'confusable' | 'punycode' | 'substring', evidence }` on hit. Excludes legitimate_domains.
- Unit tests via vitest: `__tests__/lexical-match.test.ts` covering edge cases (legitimate domain rejection, punycode normalisation, confusable detection, edit-distance boundary).

**Verification:**

- `pnpm turbo build` clean
- `pnpm --filter @askarthur/shopfront-glue test` green
- Advisor pass on prod (no new ERRORs from v140)

### PR 2 detail (S0E.2)

**Goal:** daily run produces hits in `shopfront_clone_alerts`. No public page yet.

**Inngest function `packages/scam-engine/src/inngest/shopfront-nrd-daily-ingest.ts`:**

- ID: `shopfront-nrd-daily-ingest`
- Cron: `30 8 * * *` (daily 08:30 UTC — well-spaced from existing 08:00 UTC reddit-intel-trigger)
- Feature flag gate: `FF_SHOPFRONT_CLONE_WATCH` (default OFF; flip ON after first successful prod run)
- Steps:
  1. `step.run("download-nrd-zip")` — fetches `WHOISDS_NRD_ZIP_URL` via `ssrfSafeDispatcher` (per #387). 60s timeout. Returns Buffer.
  2. `step.run("parse-nrd-list")` — unzips, parses domain list. Returns `string[]`.
  3. `step.run("lexical-match-domains")` — runs each domain through `lexicalMatch()` against `AU_BRAND_WATCHLIST`. Returns hits.
  4. `step.run("insert-clone-alerts")` — chunked insert into `shopfront_clone_alerts` (chunks of ≤5K). `target_shop_id = NULL`, `inferred_target_domain = <brand_legitimate_domain>`, `source = 'nrd'`, composite severity computed.
  5. `step.run("log-cost-telemetry")` — `logCost({ feature: 'shopfront-clone-watch', provider: 'whoisds', cost_usd: 0, qty: <domain_count> })`.
  6. `step.run("send-telegram-digest")` — internal-only digest: "Today's clone-watch: N hits across M brands. Top 5: [...]"
- Error handling: each step has try/catch; failures log to `cost_telemetry WHERE feature='shopfront-clone-watch-error'` and Telegram-page.
- `statement_timeout='300s'` set at session start.
- Hard cap on Inngest run duration: <5 min (per CLAUDE.md "<5 min" rule).

**Env vars (Vercel):**

- `WHOISDS_NRD_ZIP_URL` (production + preview) — Brendan adds after one-time whoisds signup
- `FF_SHOPFRONT_CLONE_WATCH` = `false` (initial; flip after first prod run verified)

**Verification:**

- Trigger via Inngest dev UI in dev environment
- Smoke-test against a real (small) NRD zip
- Check Telegram digest fires
- Verify `shopfront_clone_alerts` rows insert with correct shape via `mcp__supabase__execute_sql`

### PR 3 detail (S0E.3)

**Goal:** public URL exists with yesterday's hits. ADR + #376 amendments commit.

**Page `apps/web/app/clone-watch/page.tsx`:**

- Server component, Next.js 16 App Router
- Renders yesterday's `shopfront_clone_alerts` WHERE `source = 'nrd'`, ordered by composite severity DESC
- Columns: candidate domain, inferred target brand, signal type, severity tier, detected timestamp
- Factual-signal-only copy per `docs/policy/draft-disclaimer-pack-v0.md` Surface 5 principles
- Top of page: "About clone-watch" — what we observe, what we don't claim, how to claim a Verified listing, how to opt out
- Pagination: top 100 today; "view history" link to per-brand drill-down (optional Phase 0E follow-up)
- Cache-Control: `public, s-maxage=3600, stale-while-revalidate=600` — refresh hourly
- Plausible event: `clone-watch.page_view`
- `noindex` removed from `apps/web/next.config.js` if present — this page IS indexable (it IS the public surface)

**Optional `apps/web/app/clone-watch/[brand]/page.tsx`:** per-brand drill-down (rolling 30-day window).

**Sitemap update:** `apps/web/app/sitemap.ts` includes `/clone-watch` and per-brand slugs.

**`docs/adr/0016-clone-detection-source-layering.md` amendment:** the addendum text from §3 above appended.

**#376 body amendment:** add a "Scope clarification 2026-05-24" callout near the top noting that the `target_shop_id IS NULL` write path is now used by the MVP (S0E.1/2/3); Phase A scope (#376 itself) remains the `target_shop_id IS NOT NULL` + `source = 'corpus'` path against installed merchants.

**Verification:**

- `curl https://askarthur.au/clone-watch | grep -c "Clone-watch"` ≥ 1 after deploy
- Visual eyeball on Vercel preview
- Lighthouse score ≥ 90 (it's a simple SSR page)
- Plausible event fires in dev

## Outreach implications after MVP ships

The whole point of this MVP is to make outreach convertible. Sequenced:

| #                      | Before MVP             | After MVP + 1 week of hits                                                                                           |
| ---------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| #366 PCD-L2            | Send (forward-looking) | Send (unchanged)                                                                                                     |
| #369 privacy counsel   | Send                   | Send                                                                                                                 |
| #371 disclaimer pack   | Send v0 draft          | Send v0 draft + reference live `/clone-watch` URL as evidence of the surface that needs lawyer-vetted copy           |
| #368 SPF-sector P1     | Send with corpus stats | **Send with live `/clone-watch` URL + "yesterday we detected N suspect AU domain registrations targeting [brands]"** |
| #367 Shopify T&S       | Defer                  | **Send — engine is live + has 1 wk of evidence**                                                                     |
| #370 takedown partners | Defer                  | **Send with daily-hit volume — "we'll generate ~N referrals/wk based on the last 7 days of data"**                   |

## What this MVP does NOT include

- No merchant-facing surface (no badge, no Directory, no per-merchant dashboard) — those are Stage 1.
- No cold-outreach automation — manual-only per Image #2's `outreach-send` rule. Brendan reviews `/clone-watch` daily; sends factual-signal emails by hand using `docs/policy/draft-disclaimer-pack-v0.md` Surface 5 as the v0 template.
- No Calidog CT firehose — still Phase B, still gated on ≥10 paying merchants + 48h stability spike.
- No Voyage embeddings — still Phase C, still gated on Layer 4 WTP signal (#368).
- No takedown automation — still Stage 1 (#377 Shield Pro).
- No cross-merchant federated clustering — still Phase C.
- No fetching of candidate pages (no Visual Match) — MVP is Brand Match (string) only. Phase A's Visual Match adds page-fetch.

## Handoff sequencing

This plan ships as PR 4 (planning artefacts: this doc + ADR-0016 addendum + GH issue updates).

Build PRs S0E.1 → S0E.2 → S0E.3 ship in a separate session via the handoff at `/tmp/handoff-clone-watch-mvp-*.md`. First move for that session: PR 1 (S0E.1) — schema + foundation. Pre-PR-1 wall-clock task: Brendan signs up at whoisds.com to obtain `WHOISDS_NRD_ZIP_URL` (5-min task). PR 1 can ship without the URL since it has no live execution.

## What kills this MVP / triggers a re-plan

- whoisds.com paywalls the NRD zip → swap to a different free source (alternatives: ICANN CZDS per-TLD subscriptions, registry-specific public lists). If no free source remains, the engine still works on internal corpus alone (#376 Phase A path) — but the public-evidence flywheel weakens.
- Lexical matching produces high false-positive rate that erodes outreach credibility → tighten the matcher's edit-distance / score thresholds; ship a manual ops review step before public-page publication (currently auto-published).
- AU brand requests opt-out → remove from `au-brand-watchlist.ts`; redeploy. The static file IS the seam by design.
- Defamation concern arises before #371 lawyer-vetted copy returns → flip `FF_SHOPFRONT_CLONE_WATCH` to OFF; the page renders empty until copy is signed off. The page itself does not characterise; rolling the flag off is sufficient.
