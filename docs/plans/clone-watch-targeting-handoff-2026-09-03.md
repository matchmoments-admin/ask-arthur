# Clone-watch targeting intelligence — handoff (2026-09-03)

Continuation point for the monthly brand-targeting feature (wayfinder map
#1060, ticket #1075) plus the Inngest-crunch remediation that preceded it.
Read this top-to-bottom before touching anything; the **In-flight** section is
the exact stopped-mid-edit state.

## Where everything lives

| Thing                               | Where                                                                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Feature branch (PRs 1–6 + refactor) | `clone-watch/brand-coverage-history` → **PR #1076** (open)                                                                                                                                 |
| Metrics honesty (v292/v293)         | `clone-watch/metrics-honesty-v292` → **PR #1073** (open, rebased on main)                                                                                                                  |
| Recovery-script idempotency fix     | `clone-watch/reemit-idempotency-guard` → **PR #1077** (open)                                                                                                                               |
| Merged already                      | **#1072** (Inngest crunch relief) on main, deployed                                                                                                                                        |
| Worktrees (this machine)            | `…/scratchpad/wt-coverage`, `wt-metrics`, `wt-reemit` under the session scratchpad; deps installed                                                                                         |
| Plan                                | `~/.claude/plans/zippy-watching-allen.md`                                                                                                                                                  |
| Prod access                         | `pnpm --filter @askarthur/web exec tsx scripts/_query.ts --sql "…"` (untracked helper in the MAIN checkout, uses `SUPABASE_ACCESS_TOKEN` from `.env.local`); Supabase MCP is not connected |

**Migrations v294–v297 are APPLIED to prod** (coverage table + key fix +
brand-stats intel columns + integrity constraints). v292/v293 also applied.
Prod data state: `brand_coverage_history` has 295 rows (Medicare/Centrelink
present, Domain/Lendi closed at 2026-06-07); `clone_watch_monthly_brand_stats`
for 2026-08 has intel columns populated for 153/153 brands and reconciles
(Σclones=1032, Σdeliberate=887).

## In-flight — STOPPED MID-EDIT, finish this first

The architecture refactor commit (`19e7906c` on #1076) wired the trend gate
into the spotlight and unified the dedupe — but **`fetchCloneCohort`,
`CLONE_COHORT_SELECT` and `applyCohortRules` in
`apps/web/lib/clone-watch/clone-cohort.ts` have ZERO callers**. The type and
the dedupe were unified; the fetch was not, so the two duplicate SELECT lists
(`report-card-data.ts` `fetchMonthByBrand` and `report-brand-stewardship.ts`
`fetch-clone-detections`) still exist — the exact drift that lost
`clone_tactic` once already.

**Trap discovered at the stopping point:** `fetchCloneCohort` as written
DEDUPES, but both callers need UNDEDUPED rows — the report card dedupes
per-brand inside `aggregateClonesByDomain` while targeting-intelligence
dedupes globally, and those are deliberately different questions (see the
named comment in `report-brand-stewardship.ts` ~L434). Wiring it as-is would
silently change published numbers. Fix: make `fetchCloneCohort` return
raw-but-cohort-filtered rows (`applyCohortRules` only, NO dedupe), let callers
dedupe; then wire both callers and delete their inline SELECTs. Re-verify
after wiring with the prod reconciliation (`Σclones=1032` for 2026-08 must be
unchanged).

Also: a `/code-review` of commit `19e7906c` was launched and **its findings
never landed** (session ended first). Check PR #1076 for a late comment, or
re-run: review should focus on gate-bypass completeness, the dead
`fetchCloneCohort`, and whether dedupe unification changed any published
number.

## What is done and prod-verified on #1076

1. **Coverage history + trend gate** (v294/v295/v297, `brand-coverage.ts`,
   backfill script). Gate verdicts: claimable / coverage_started /
   coverage_ended / below_floor / coverage_unknown; fails closed; throws on
   malformed months. Verified on real Aug-vs-Jul: 38 claimable, The Ordinary
   and Mecca correctly withheld (both added to watchlist 2026-07-21).
2. **Targeting characterisation** (`targeting-intelligence.ts`,
   `asn-canonical.ts`): tactic/TLD/intent/hosting/clusters, every distribution
   carries denominator + unknown bucket. Verified against independent SQL on
   the real August cohort (TLDs exact; hosting partitions 341 fronted + 490
   unattributed + 201 origin = 1032). Intent restricted to scanned rows (n=52)
   because the Haiku classifier's ENTIRE input is
   `{brand, candidate_domain, candidate_url}` — it never loads the page;
   `risk_indicators` must never be published.
3. **Per-brand persistence** (v296): new columns on
   `clone_watch_monthly_brand_stats`, written via `writeTrendRows` spread.
4. **Cron coverage snapshot**: `snapshot-watchlist-coverage` step in
   `clone-watch-report-summary.ts` (runs 1st @ 11:00 UTC), pure
   `planCoverageSync` + cron-owned adapter. Ordering is load-bearing: the
   snapshot must precede compute-summary.
5. **Publish surface**: slide 05 "How the names are built" (SLIDE_COUNT 7→8 in
   BOTH files, sync-tested), caption gains TLD line + classifier caveat +
   mandatory trend disclosure; `targeting-copy.ts` holds six honesty rules,
   all test-pinned. Real August caption generated from prod: 2,534/2,900
   chars. **Nothing publishes automatically** — the existing approval-gated
   LinkedIn lane is untouched.
6. **Gate wired to publisher** (the review's blocking finding): mover/entrant
   spotlight rungs now require `verdict.kind === "claimable"`. Proven on prod:
   without the gate July publishes "Amazon sharpest riser 17→38 (+124%)" which
   is a coverage artefact (Amazon covered only from 2026-06-16); with it, July
   falls back to globals, August keeps honest Bonds 16→28.
7. Two defects fixed in **already-published monthly copy**: "one actor
   registering in bulk" (actor claim from a count) and "~50 major Australian
   brands" (list holds 293; now computed from `AU_BRAND_WATCHLIST.length`).
8. ADR-0020 amended: `clone_watch_monthly_brand_stats.brand` is domain-keyed
   (merged one day before the ADR); `brand_coverage_history`'s two keys are a
   NAMED temporary bridge; completing move = `brand_normalized` sibling column
   (v197 precedent), deferred because three published editions key the old way.

Suite at last green: **1,489 passed**, typecheck clean, lint 0 errors.

## Recurring trap of this whole effort — read before writing any query

**Four key-format mismatches produced plausible wrong numbers:**

1. `brand_contact_directory.brand` = display names ("Australia Post") vs
   normalized keys → "0 of 203 brands reachable".
2. v294 keyed coverage on `brandNormalize` but
   `clone_watch_monthly_brand_stats.brand` stores DOMAINS → 0/172 join (v295).
3. "Kmart 21→34 +62%" — `target_brand_normalized` splits kmart.com.au into
   `kmart`+`kmartaustralia`; real figure by domain key is 32→34 (+6%). 72 rows
   fleet-wide disagree between keys.
4. `buildClassifierCaveat` mixed per-brand and global dedupes (fixed).
   Rule: never join or aggregate brand data without confirming WHICH key a table
   stores; `servicesaustralia.gov.au` maps to THREE brands.

## Remaining work, in order

1. **Finish the cohort wiring** (In-flight above) + fold the never-landed
   review findings.
2. **Merge order**: #1073 (independent, green, migrations already applied) →
   #1076 (after review findings) → #1077. All need `--squash`; ship-workflow
   step 10 verification after each.
3. **Post-merge**: re-run `reemit-lost-weaponised.ts` (1 alert, #3713, was
   inside the 24h idempotency window; now well past). Detector
   `unnotified_weaponised` in cost_telemetry should read 0 after.
4. **Soak (#1068)**: 2–3 days of checks post-merge — zero
   `inngest/function.cancelled` events (Inngest REST API with
   `INNGEST_SIGNING_KEY` from `vercel env pull`), preclassify residue 0, cost
   rows == classifications, first witnessed takedown (none since Aug 19 —
   escalate if still none), public /clone-watch strip shows median 23h
   (v293; ISR 1h — always curl TWICE).
5. **First LinkedIn edition with new slide**: render
   `/admin/report-card?month=2026-08&slide=5`, check height ≤1350; the cron
   lane runs 2nd of month with Telegram approval.
6. **Open tickets**: #1070 (founder: two brand emails pending approval since
   Aug 24), #1074 (fold per-item Inngest steps + finish logCostAsync migration,
   41 sites), #1075 (parent — close when #1076 merges), #1067 follow-up
   (post-soak recheck throughput doubling 6h→3h if slots healthy).

## Verifying the feature end-to-end (the user asked)

Fastest honest path after #1076 merges: manually fire
`clone-watch/report-summary.manual-trigger.v1` with
`{periodMonth: "2026-08"}` (or wait for the Oct 1 cron), then:
`clone_watch_monthly_brand_stats` 2026-08 reconciles; `brand_coverage_history`
snapshot ran (`added/closed/unchanged` in the run output); render all 8 slides

- caption for 2026-08 and check the disclosure numbers match
  `card.brandTrends.excluded`; then the real end-to-end is the **Oct 2 LinkedIn
  lane** producing the September edition with a clean Sep-vs-Aug (coverage
  unchanged since 2026-07-21, so September is the first fully-clean MoM month).
