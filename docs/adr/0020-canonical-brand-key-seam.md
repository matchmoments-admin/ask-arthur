# Canonical brand-key Seam across the three brand streams

**Status:** accepted (2026-07-06)

Ask Arthur has three "brand" intelligence streams — **reported-scams**
(`scam_reports.impersonated_brand`, plus `verified_scams`/`feed_items`),
**Reddit-intel** (`reddit_post_intel.brands_impersonated[]`), and **clone-watch**
(`shopfront_clone_alerts`, keyed by `inferred_target_domain`) — that could not
join, because each stored brand identity under a different, disagreeing key.
Reported-scams and Reddit stored raw free-text names ("National Australia Bank"
/ "NAB" / "nab"); clone-watch stored a legitimate domain and kept the brand only
inside a `signals` JSONB. Three key functions encoded the fragmentation:
`brandNormalize()`/`brand_normalize()` (strip to `[a-z0-9]`), `deriveBrandKey()`
(underscore form, `known_brands.brand_key`), and `inferred_target_domain`. A
brand under active impersonation therefore surfaced in three places under three
keys and reinforced itself nowhere. A canonical layer already existed
(`brand_aliases` + `brand_normalize()` + `resolve_brand()`, v174/v175) but had
**zero code callers** outside one default-OFF monthly job. We record this because
standardising a join key three functions disagreed on is hard to reverse once
downstream surfaces depend on it.

Full build sequence + rejected alternatives: `docs/plans/brand-convergence-seam.md`.

## Decision

Adopt the existing canonical key — `brand_normalize(raw)` → resolve via
`brand_aliases` → `canonical_brand` (normalised value as the fallback when no
alias matches) — as the single join **Seam**, wired in **read-side only**.

- **Code home.** A shared pure resolver Module `packages/shopfront-glue/src/
brand-resolver.ts` (`buildBrandResolver`), co-located with the `brandNormalize`
  twin under the same parity harness. The Supabase-backed loader
  (`apps/web/lib/brand-aliases.ts` `loadAliasRecord`) is the Adapter, kept
  app-side so `shopfront-glue` stays free of a Supabase dependency.
- **Key reconciliation by promotion, not unification.** `brand_normalize` is
  promoted to the one join key; `deriveBrandKey` is frozen as a display/report-
  ref slug; `inferred_target_domain` stays the clone alert's discriminator and
  gains a **sibling** `target_brand_normalized` column (v197). Alert tables are
  **not** merged (ADR-0016) — the sibling column is a discriminator, not a union.
- **Read-side only.** No canonical value is written onto any hot free-text
  column; every canonical projection is derived by crons and is fully
  rebuildable. The hot `scam_reports` write path is untouched (no column, no
  index, no RPC change). Its only new exposure is a windowed, indexed,
  service-role-only aggregate RPC (`aggregate_scam_report_brands`).
- **Reinforcement.** (1) `reddit_watchlist_candidates` becomes multi-source via
  `source_counts` JSONB, folded into the existing weekly cron (Phase 1). (2)
  Clone-alert triage gains cross-stream corroboration as SEPARATE named columns +
  an additive ORDER-BY term gated by `p_corroboration_priority` — the
  deterministic clone `severity` is never touched (ADR-0015, Phase 2). (3)
  `/api/analyze` cites an operator-CONFIRMED clone as a red flag, flag-gated
  (Phase 2b). (4) `brand_register` — the per-brand "brand 360" rollup — is
  rebuilt nightly and aligns all three streams into one queryable identity
  (Phase 3).

## Consequences

- The canonical vocabulary lives in one Module + one data home; the copy-pasted
  `resolveCanonical` closure is concentrated, not scattered.
- **Inngest budget (per ADR-0019: Hobby plan, 5 slots, 50k step-runs/month).**
  The only NEW recurring invocation is `brand-register-refresh` — **daily**
  (`30 3 * * *`), `concurrency: 1`, `singleton: skip`, `timeouts.finish: 5m`,
  6 steps/run. That is **+7 function runs/week**; **≈180 step-runs/month** when
  `FF_BRAND_REGISTER` is ON (≈0.4% of the 50k cap), and ≈30 no-op runs/month
  while it is default-OFF. Phase 1 adds one step to the existing weekly
  `reddit-brands-discover` run (≈+5 step-runs/month); Phases 2/2b add **zero**
  Inngest load (a column write in the existing NRD ingest, and a synchronous
  read in the analyze request path). No new function threatens the analyze
  fan-out's reserved slots.
- Every consumer surface ships default-OFF; nothing brand-facing publishes
  without operator-confirmed data (analyze cites only `tp_confirmed`/
  `tp_actioned` clones).
- `brand_register` is pure-derived — `DROP TABLE` is lossless; the empty-batch
  guard on `replace_brand_register` means a failed aggregation can never wipe it.

## Alternatives considered

- **Write-side canonical column on all three streams** (rejected): a
  column+index+backfill and an RPC change on the hot `scam_reports` write path,
  splits each brand into two candidate rows, and adds a write-side staleness
  problem — all for value derivable read-side.
- **Live VIEW / MATERIALIZED VIEW over `scam_reports`** (rejected): re-scans the
  hot table per pageview and can't carry human-curation state.
- **Merging the two alert tables** (rejected): violates ADR-0016.
- **A separate `scam-brands-discover` Inngest cron** (rejected in favour of the
  fold-in): a second weekly cron would add invocations against the Hobby budget
  for no cadence benefit; folding the scam source into the existing weekly run
  costs one extra step.

## Amendment 2026-09-03 — the monthly brand store was never promoted, and a bridge now papers over it

`clone_watch_monthly_brand_stats` (v193, merged **2026-07-05**) keys its rows on
`brand`, and that column stores the brand's PRIMARY DOMAIN — `apple.com`,
`hellostake.com` — because `lexical-match` emits `legitimate_domains[0]`, the
NRD ingest writes it to `inferred_target_domain`, and the aggregation keys on
that. This ADR was accepted **one day later**, on 2026-07-06, and promotes
`brand_normalize` to the one join key while explicitly demoting
`inferred_target_domain` to "the clone alert's discriminator". The table is
therefore a per-brand aggregate keyed on the discriminator: not a violation
anyone committed, but a promotion that never reached it. `v198`'s
`aggregate_open_clone_alerts_by_brand`, built after this ADR, correctly uses
`target_brand_normalized`, so the two per-brand aggregates now disagree on their
key.

`brand_coverage_history` (v294/v295, #1075) made that visible by carrying BOTH
keys: `brand_normalized` to join alerts, `brand_domain` to join the monthly
stats. That is a **deliberate temporary bridge**, and it is recorded here so the
next reader does not mistake it for the intended design. It has a real cost:
three brands (Services Australia, Medicare, Centrelink) share
`servicesaustralia.gov.au`, so the coverage table can describe them separately
and the stats table cannot — a de-listing of the earliest-covered sibling would
suppress all three brands' trend claims, silently and in the fail-closed
direction.

**The completing move**, when the monthly store is next touched: give
`clone_watch_monthly_brand_stats` a `brand_normalized` sibling column, mirroring
what v197 did for the alerts table (the precedent this repo already set), and
have `getCloneWatchTrendRows` aggregate on it. `brand_coverage_history` then
drops `brand_domain` to a display/audit column and the bridge disappears.

Not done now because the store has three months of published editions keyed the
old way, and re-keying it is a data migration with a reconciliation obligation
to those editions — not something to bundle into a reporting feature. The bridge
is honest and tested; the debt is named.

## Related

- `docs/plans/brand-convergence-seam.md` — the phased plan (Phases 0–3).
- ADR-0015 (signal model), ADR-0016 (source layering / discriminate-not-merge),
  ADR-0019 (Inngest concurrency + cadence budget).
- Migrations v195 (known_brands alias seed), v196 (multi-source candidates),
  v197 (clone-triage corroboration), v198 (brand_register), v294–v297
  (brand_coverage_history + the two-key bridge above).
