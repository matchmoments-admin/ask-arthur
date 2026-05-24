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

- whoisds.com free-tier NRD lists are publicly downloadable at deterministic date-based URLs (the page header reads "without a license and without any payment"). The Inngest fn computes yesterday's URL on each tick via `computeNrdUrl(yesterdayUtc())` in `packages/scam-engine/src/inngest/shopfront-nrd-daily-ingest.ts`. No signup, no env var, no rotation. `WHOISDS_NRD_ZIP_URL` remains an optional override for tests or emergency source-switching.
- NRD zip is ~50-200MB (~100K-1M domains/day). Download + parse in chunks; chunked DB writes ≤5K/iteration per CLAUDE.md hot-table rules.
- `statement_timeout='300s'` cap per CLAUDE.md "long-running write loop" rule.

## 3-PR sequence

| PR  | Title                                                                                                 | Files                                                                                                                                                | Wall-clock | Issue |
| --- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----- |
| 1   | feat(shopfront-glue): clone-watch MVP foundation — v140 schema + AU brand watchlist + lexical matcher | new `packages/shopfront-glue/` package; `supabase/migration-v140-shopfront-init.sql`; `au-brand-watchlist.ts`; `lexical-match.ts` + unit tests       | ~1.5 days  | S0E.1 |
| 2   | feat(shopfront-glue): NRD daily Inngest ingest + Telegram digest                                      | `packages/scam-engine/src/inngest/shopfront-nrd-daily-ingest.ts`; env var `WHOISDS_NRD_ZIP_URL`; feature flag `FF_SHOPFRONT_CLONE_WATCH` default OFF | ~1.5 days  | S0E.2 |
| 3   | feat(web): public /clone-watch page + ADR-0016 amendment commit                                       | `apps/web/app/clone-watch/page.tsx`; optional `/clone-watch/[brand]/page.tsx`; sitemap + robots; `docs/adr/0016-...md` addendum; #376 body amendment | ~1 day     | S0E.3 |

**Total wall-clock:** ~4 days of focused work for a working engine + public URL.

### PR 1 detail (S0E.1)

**Goal:** schema + matcher in place. No execution yet.

**Migration v140 (`supabase/migration-v140-shopfront-init.sql`):**

- `shopfront_shops` (per #376 schema reference; stays empty until #373)
- `shopfront_clone_alerts` (per #376 locked schema, ALL columns + CHECK + indexes)
- `shopfront_takedown_attempts` (per #376 locked schema)
- RLS service-role only on all three
- Apply via `mcp__supabase__apply_migration` against project `rquomhcgnodxzkhokwni`
- Verify via `mcp__supabase__get_advisors` (security + performance) — no new ERRORs

**Package `packages/shopfront-glue/`:**

- Standard pnpm workspace package shape (`package.json`, `tsconfig.json`, `src/index.ts`)
- `src/au-brand-watchlist.ts`: exported `AU_BRAND_WATCHLIST` array of AU retail + banks/telcos/post. Deduped list (~50 entries): Bunnings, Woolworths, Coles, Westpac, NAB, ANZ, CBA, Telstra, Optus, Vodafone, Australia Post, Myer, David Jones, JB Hi-Fi, Harvey Norman, Officeworks, Kmart, Target, Big W, Aldi, IGA, Dan Murphy's, BWS, Liquorland, Chemist Warehouse, Priceline, Mitre 10, Reece, Toll, StarTrack, Sendle, Domino's, McDonald's, KFC, Hungry Jack's, Subway, 7-Eleven, Toyworld, Smiggle, Cotton On, Bonds, Country Road, Witchery, Sportsgirl, Glue Store, Universal Store, City Beach, Surfstitch. Each entry: `{ brand: string, legitimate_domains: string[] }`. NOTE: severity_floor dropped from MVP — Brand Match alone caps at score 40 per #376 formula → tier always = `low`. Tiering becomes meaningful when Visual Match (Phase A) and Semantic Match (Phase C) add weight.
- `src/lexical-match.ts`: `lexicalMatch(domain: string, watchlist: BrandEntry[]): MatchResult | null` — runs Levenshtein edit-distance + Unicode confusables + punycode normalisation + brand-substring detection. Returns `{ brand, score, signal_type: 'levenshtein' | 'confusable' | 'punycode' | 'substring', evidence }` on hit. Excludes legitimate_domains.
- URL canonicalisation contract (used by S0E.2 + every consumer of the matcher): `candidate_url = 'https://' + domain.toLowerCase() + '/'` (always https, always trailing slash, always lowercased). `url_hash = sha256(candidate_url)` (hex, lowercase). Lives in `packages/shopfront-glue/canonicalise.ts`. All clone-watch writers (Layer 0 NRD, Phase A corpus, Phase B firehose) MUST go through this so `uniq_clone_alerts_target_url` dedupes same-domain hits across runs.
- Unit tests via vitest: `__tests__/lexical-match.test.ts` covering edge cases (legitimate domain rejection, punycode normalisation, confusable detection, edit-distance boundary). Plus a `canonicaliseCandidateUrl` test asserting the locked form.

**Verification (pre-merge gate):**

- `pnpm turbo build` clean
- `pnpm --filter @askarthur/shopfront-glue test` green
- Migration applied to prod via `mcp__supabase__apply_migration`; `mcp__supabase__get_advisors` (security + performance) — no new ERRORs from v140
- **`/local-ultrareview`** pass — the architecture + security agents are load-bearing here (new package, new schema, new write target)

### PR 2 detail (S0E.2)

**Goal:** daily run produces hits in `shopfront_clone_alerts`. No public page yet.

**Inngest function `packages/scam-engine/src/inngest/shopfront-nrd-daily-ingest.ts`:**

- ID: `shopfront-nrd-daily-ingest`
- Cron: `30 8 * * *` (daily 08:30 UTC — well-spaced from existing 08:00 UTC reddit-intel-trigger)
- Feature flag gate: `FF_SHOPFRONT_CLONE_WATCH` (default OFF; flip ON after first successful prod run)
- Steps:
  1. `step.run("download-and-parse-nrd")` — computes yesterday's NRD URL via `computeNrdUrl(yesterdayUtc())` (or honours `WHOISDS_NRD_ZIP_URL` override for tests), fetches via `ssrfSafeDispatcher` (per #387). 60s timeout. URL pattern is `https://www.whoisds.com/whois-database/newly-registered-domains/${base64("YYYY-MM-DD.zip")}/nrd`.
  2. `step.run("parse-nrd-list")` — unzips, parses domain list. Returns `string[]`.
  3. `step.run("lexical-match-domains")` — runs each domain through `lexicalMatch()` against `AU_BRAND_WATCHLIST`. Returns hits.
  4. `step.run("insert-clone-alerts")` — chunked insert into `shopfront_clone_alerts` (chunks of ≤5K) via UPSERT on the existing `uniq_clone_alerts_target_url` index (which dedupes same-domain hits across runs). `target_shop_id = NULL`, `inferred_target_domain = <brand_legitimate_domain>`, `candidate_url = canonicaliseCandidateUrl(domain)`, `url_hash = sha256(candidate_url)`, `source = 'nrd'`, `severity = Math.floor(brand_match_score * 40)` (matcher caps `brand_match_score < 1.0`, so severity ≤ 39 → `severity_tier = 'low'` always at MVP, since Visual + Semantic terms are 0). The matcher already returns `score ≤ 0.95`; `Math.floor` is defence-in-depth.
  5. `step.run("log-cost-telemetry")` — `logCost({ feature: 'shopfront_clone_watch', provider: 'whoisds', cost_usd: 0, qty: <domain_count> })`.
  6. `step.run("send-telegram-digest")` — internal-only digest: "Today's clone-watch: N hits across M brands. Top 5: [...]"

  **No cross-surface dedupe against `brand_impersonation_alerts` at MVP** — that table has no `candidate_url` column (it stores `scammer_urls TEXT[]`). For the ~6-12 bank/telco/post brands on the watchlist, accept that Layer 0 and ct-monitor.ts may report the same suspect domain on two surfaces during the 7-day evidence window. If duplicate noise becomes material, a follow-up migration adds `candidate_url` to `brand_impersonation_alerts` and reintroduces a dedupe step then.

- Error handling: each step has try/catch; failures log to `cost_telemetry WHERE feature='shopfront_clone_watch_error'` and Telegram-page.
- `statement_timeout='300s'` set at session start (Supabase client option `db.headers['x-statement-timeout'] = '300s'` or per-call SET LOCAL).
- Hard cap on Inngest run duration: <5 min (per CLAUDE.md "<5 min" rule).

**Post-merge prod smoke checklist (required — Inngest fns don't fire on Vercel previews):**

1. No env var to set — the Inngest fn computes yesterday's URL automatically. (`WHOISDS_NRD_ZIP_URL` is an optional override; leave it unset unless you need to back-fill a specific historical date or swap source.)
2. Flip `FF_SHOPFRONT_CLONE_WATCH=true` in Vercel prod env.
3. Trigger run manually via Inngest dashboard (`shopfront-nrd-daily-ingest` → "Invoke").
4. Wait for run completion (≤5 min). Verify status `success` in Inngest dashboard.
5. Verify Telegram digest landed in the digest channel.
6. SQL check: `SELECT COUNT(*), MAX(first_seen_at) FROM shopfront_clone_alerts WHERE source = 'nrd'` returns expected row count + recent timestamp.
7. SQL check: `SELECT * FROM cost_telemetry WHERE feature = 'shopfront_clone_watch' ORDER BY created_at DESC LIMIT 1` returns the new row.
8. If anything off-pattern (row count looks wrong, Telegram silent, errors in cost_telemetry feature='shopfront_clone_watch_error'), flip flag back OFF and diagnose before re-enabling.

**Env vars (Vercel):**

- `WHOISDS_NRD_ZIP_URL` (production + preview) — Brendan adds after one-time whoisds signup
- `FF_SHOPFRONT_CLONE_WATCH` = `false` (initial; flip after first prod run verified)

**Verification (pre-merge gate — Inngest won't fire on preview, so this is unit-only):**

- `pnpm turbo build` clean
- Vitest covers UPSERT idempotency (same domain twice → one row, last_seen_at updated)
- Vitest covers canonical-URL form (lowercased domain, https://, trailing slash)
- **`/local-ultrareview`** pass — security agent reviews SSRF dispatcher wiring + zip-bomb defence; ops/cost agent reviews 5-min cap + statement_timeout + chunked inserts

**Post-merge prod smoke:** runs the post-merge checklist above (env set → flag flip → manual Inngest trigger → row + telemetry + digest verification → flip back OFF if anything off-pattern).

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
- **`noindex` by default for first 7 days** — `export const metadata = { robots: { index: false, follow: false } }` in `page.tsx`. Page still renders for outreach-email recipients clicking through directly; just not surfaced to search engines while v0 (unvetted) copy is live. Sitemap excludes `/clone-watch`. Index-flip is a follow-up PR after #371 lawyer-vetted v1 copy lands.

**Optional `apps/web/app/clone-watch/[brand]/page.tsx`:** per-brand drill-down (rolling 30-day window).

**Sitemap update:** `apps/web/app/sitemap.ts` does NOT include `/clone-watch` at MVP (noindex). Sitemap-add is part of the lawyer-copy follow-up PR (per #371).

**`docs/adr/0016-clone-detection-source-layering.md` amendment:** the addendum text from §3 above appended.

**#376 body amendment:** add a "Scope clarification 2026-05-24" callout near the top noting that the `target_shop_id IS NULL` write path is now used by the MVP (S0E.1/2/3); Phase A scope (#376 itself) remains the `target_shop_id IS NOT NULL` + `source = 'corpus'` path against installed merchants.

**Verification (pre-merge gate):**

- `pnpm turbo build` clean
- Visual eyeball on Vercel preview
- Lighthouse score ≥ 90 (it's a simple SSR page)
- Preview page response includes `<meta name="robots" content="noindex,nofollow">`
- **`/local-ultrareview`** pass — security + docs/drift agents are the critical reviewers here (this is the highest-defamation-risk surface in the MVP; review v0 copy against `docs/policy/draft-disclaimer-pack-v0.md` Surface 5 principles word-by-word)

**Post-merge prod smoke:**

- `curl https://askarthur.au/clone-watch` → 200 OK, body contains "Clone-watch" string
- `curl -s https://askarthur.au/clone-watch | grep -i 'noindex'` returns the meta tag
- Plausible event `clone-watch.page_view` fires when loaded in a real browser
- `curl https://askarthur.au/sitemap.xml | grep -c clone-watch` returns `0`

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

## Matcher evolution log

The Layer 0 lexical matcher (`packages/shopfront-glue/src/lexical-match.ts`) has shipped three iterations as production evidence has accumulated. Each iteration is recorded with its acceptance-gate result. The signal-gating rationale (substring gated, confusable + Levenshtein ungated, token list selection, two-char-ccTLD drop) is captured in [ADR-0017](../adr/0017-clone-detection-substring-gating.md).

- **v1 (S0E.1, PR #397)** — substring + Levenshtein with brand-stripping. First prod run produced 432 hits with ~95% FPs from short-brand substring noise (137× ANZ matching `franzese.com`, 137× IGA matching `lanzhoudhl.com`, 85× NAB from `bigbassbonanzacasino.uk` etc).
- **v1.5 (PR #403)** — added `MIN_BRAND_LEN_FOR_LOOSE_SUBSTRING=5` word-boundary check for short brands (ANZ/NAB/IGA/KFC/BWS). Brands ≥5 chars kept substring-anywhere; brands <5 chars required standalone-segment match. First-fix run reduced to 17 hits with ~70% FPs — mostly common-English-word collisions on long brands (3× Reece matching _Greece_, 7× Target mostly real businesses).
- **v2 (PR #408)** — scam-context-token gate on substring hits (Option A from #405). Substring matches now require the brand-stripped residue to contain at least one of 14 scam-context tokens (`bank`, `login`, `support`, `ads`, `online`, `secure`, `verify`, `pay`, `home`, `shop`, `store`, `account`, `au`); confusable + Levenshtein paths stay ungated. Two-char-ccTLD drop heuristic prevents `.com.au` from universally satisfying the `au` token. Bare-brand-on-wrong-TLD exception (e.g. `westpac.com` IS the brand) fires without context. Post-deploy run (2026-05-24 10:32 UTC): 5 hits, 20% FP rate (within the <30% acceptance gate, ≥3 daily-hits floor). Known FN: short brands lose Levenshtein safety net when no scam-context token is present (e.g. `kfc-net.net` no longer fires). Known FP class surfaced live: `auto-*` prefix leaks via mid-word `au` substring (FP `autoecolesoultbycfconduite.fr` for Coles) → tracked as v3 follow-up in [#409](https://github.com/matchmoments-admin/ask-arthur/issues/409).

### Acceptance gate (locked at v2)

Two coupled gates that any future matcher iteration must clear:

1. **FP rate <30%** on the daily NRD run (eyeball-verified for the first 7 days post-flip, then periodic spot-checks via the verification SQL in `docs/ops/clone-watch-config.md`).
2. **Daily hit count ≥3** — "the floor". Distinguishes a working matcher from a silenced one; a v3+ iteration that drives the FP rate to 0% by emitting zero hits is a regression, not an improvement.

## What kills this MVP / triggers a re-plan

- whoisds.com paywalls the NRD zip → swap to a different free source (alternatives: ICANN CZDS per-TLD subscriptions, registry-specific public lists). If no free source remains, the engine still works on internal corpus alone (#376 Phase A path) — but the public-evidence flywheel weakens.
- Lexical matching produces high false-positive rate that erodes outreach credibility → tighten the matcher's edit-distance / score thresholds; ship a manual ops review step before public-page publication (currently auto-published).
- AU brand requests opt-out → remove from `au-brand-watchlist.ts`; redeploy. The static file IS the seam by design.
- Defamation concern arises before #371 lawyer-vetted copy returns → flip `FF_SHOPFRONT_CLONE_WATCH` to OFF; the page renders empty until copy is signed off. The page itself does not characterise; rolling the flag off is sufficient.
