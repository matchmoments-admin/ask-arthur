# Inngest Cron Hardening — Plan

> Status: **planned, not started** (2026-05-29). Output of a read-only review of all 31 cron-triggered Inngest functions. Tracking issues filed per theme: **A=#519, B=#520, C=#521, D=#522, E=#523, F=#524**. A parallel agent is active in this repo — see "Risk / coordination notes" before applying any migration.

## Context

A read-only review of all **31 cron-triggered Inngest functions** (plus the event-driven jobs they fan into) surfaced a consistent set of defects: real correctness/cost bugs in the older enrichment jobs, missing cost-telemetry + brake guards that the newer features all have, retention sweeps that are safe today but become dangerous at launch-scale, and several jobs whose value/cadence no longer justifies their cost.

**Goal:** harden the cron fleet against the verified bugs, close the cost-observability gaps before traffic scales, and consolidate/retire jobs that aren't earning their keep — without disturbing functioning behaviour. Work proceeds as **themed PR bundles** so related fixes ship and review together (per the repo's "fewer larger PRs" convention).

## Inventory (what runs, when)

| Band                    | Jobs                                                                                                                                                                                                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nightly 02:00–05:00 UTC | billing-ingest (02:00) · feed-retention (02:30) · 3× staleness (03:00) · phone-footprint-retention (03:15) · reddit-posts-retention (03:45) · cost-telemetry-retention (04:00) · cluster-builder (04:00) · acnc-embed (04:00) · telco-retention (04:30) · archive-shadows (05:00) |
| Intraday                | enrich-vulnerability (hourly) · entity-enrichment (4h) · urlscan (4h+30) · enrichment/risk-scorer/meta-brp (6h) · ct-monitor (12h)                                                                                                                                                |
| High-frequency          | feedback-triage-refresh (_/5) · feed-items-embed, regulator-alert-push, netcraft-poll (_/30) · phone-footprint-claimer (hourly)                                                                                                                                                   |
| Weekly                  | feed-sync ×2 (Sun 07:00) · fp-cluster-digest (Sun 09:00) · clone-watch-weekly-digest (Sun 10:00)                                                                                                                                                                                  |
| Daily clone-watch       | shopfront-nrd-ingest (08:30) · notify-brand-prepare (09:30) · urlscan-rescan (11:00)                                                                                                                                                                                              |
| Event-driven (cron-fed) | reddit-intel daily→embed→cluster chain · scam-report-embed · haiku-preclassify                                                                                                                                                                                                    |

## Findings recap (severity-sorted)

| ID      | Job                               | Severity           | Issue                                                                                                                            |
| ------- | --------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| H1      | `cluster-builder`                 | HIGH               | Unbounded full-table fetch (no `.limit()`) + unbounded UPDATE on hot `scam_reports` + non-atomic 3-write → dup clusters on crash |
| H2      | `urlscan-enrichment`              | HIGH               | Non-idempotent submit loop in one `step.run` → re-pays URLScan on retry; read-modify-write race clobbers `enrichment_data`       |
| H3      | `entity-enrichment`               | HIGH               | Rows stuck `in_progress` on crash are never re-selected → silent permanent enrichment gaps                                       |
| H4      | `feed-items-embed`                | HIGH               | Paid Voyage call with no `feature_brakes` guard + no flag gate (every peer has one)                                              |
| H5      | `reddit-intel-cluster`            | HIGH               | `persist-clusters` non-idempotent: `INSERT` + `Math.random()` slug → dup theme rows on retry; in-batch new-theme match broken    |
| H6      | v149 RPC grant                    | HIGH               | `list_clone_alerts_for_urlscan_rescan` SECURITY DEFINER missing `REVOKE … FROM PUBLIC` → anon-callable                           |
| H7      | `urlscan-rescan`                  | HIGH               | `Date.now()` in fan-out event id → double-scan on step-cache-miss; no brake pre-check                                            |
| S1      | (cross-cutting)                   | SYSTEMIC           | No `logCost()` on `twilio-lookup`, `abuseipdb`, `ipqualityscore`, `urlscan`, `ct-lookup` helpers                                 |
| M-cost  | `cost-telemetry-retention`        | MEDIUM             | Unbounded `DELETE` on high-write table; one giant statement on first-run/backlog                                                 |
| M-telco | `telco/phone-footprint retention` | MEDIUM→HIGH@launch | Unbounded UPDATE/DELETE; must chunk before Vonage/SIM-swap traffic turns on                                                      |
| M-bill  | `billing-ingest-nightly`          | MEDIUM             | External `fetch` no timeout; one flaky provider drops two others' rows for the day                                               |
| M-alert | `scam-alerts`                     | MEDIUM             | No "already pushed" ledger → duplicate consumer pushes; 10k token cap                                                            |
| M-reg   | `regulator-alert-push`            | MEDIUM             | Whole fan-out in one `step.run` → re-pushes notified narratives on retry                                                         |
| M-fb    | `feedback-triage-refresh`         | MEDIUM             | Unconditional `REFRESH … CONCURRENTLY` every 5 min (~288/day, mostly no-op)                                                      |
| M-risk  | `risk-scorer`                     | MEDIUM             | N+1 RPC loop (100 round-trips) + freshest-window starvation                                                                      |
| M-ct    | `ct-monitor`                      | MEDIUM             | Multi-minute single-step crt.sh scan, retry-the-world; marginal value vs Python scraper                                          |
| M-brake | `cost-daily-check`                | MEDIUM             | Per-feature caps assume cap > global gate; no invariant guard; `.limit(10)` slice                                                |
| N-meta  | `meta-brp-report`                 | LOW                | Pure stub; confirm `FF_META_BRP_REPORTER` OFF; uncomment-footgun                                                                 |
| C-\*    | consolidation                     | LOW                | Merge 2 Sunday digests; generic retention runner; 3am stagger                                                                    |

> **Verified correction:** an earlier review draft flagged the per-feature brakes as "dead code." They are **not** — any feature exceeding its own ($5/$10/$15) cap has by arithmetic already crossed the $2 global gate, so the per-feature logic runs. The real (narrower) issue is the unguarded invariant (M-brake).
>
> **Determinism note:** **no `step.run`-ID determinism bugs** (the #455/#456 infinite-replay class) exist anywhere — those cleanups held. H5/H7/phone-footprint involve `Date.now()`/`Math.random()` in _event ids / return values / DB columns_, which weaken idempotency but do not loop.

## Existing tracked work to fold in (don't duplicate)

| This plan                       | Existing item                                      | Action                                                                     |
| ------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------- |
| Staleness 3am chunking/stagger  | BACKLOG item 9 (`mark_stale_*` 5K-batch rewrite)   | Absorb into Bundle F; close the backlog line                               |
| `cluster-builder` H1            | BACKLOG line 516 (Phase 8.1 SQL-isation, L-effort) | H1 is the _cheap safety pre-fix_; ship first, leave the big rewrite parked |
| `logCost` enricher gaps S1      | issues #514/#515 (Axiom, top-8 fns) + BACKLOG 517  | Adjacent, not the same surface; cross-link, keep separate                  |
| Brake kill-switch               | BACKLOG line 483 (hard-cap Redis kill-switch)      | M-brake guard is a prerequisite note; cross-link                           |
| `match-b2b-exposure` not firing | BACKLOG line 518                                   | Out of scope here; leave as-is                                             |

## Reusable patterns (confirmed file:line)

- `logCost(ev: CostEvent)` + `PRICING` — `apps/web/lib/cost-telemetry.ts:19,112`. Constants present: `TWILIO_LOOKUP_V2_USD`, `IPQS_PHONE_FRAUD_USD`, `VONAGE_*`, `VOYAGE_*`, `RESEND_USD_PER_EMAIL`. Add `URLSCAN_USD_PER_SCAN`, `ABUSEIPDB_USD`.
- Brake guard `isRedditIntelBraked()` — `packages/scam-engine/src/inngest/reddit-intel-error-log.ts:31` (reads `feature_brakes.paused_until > NOW()`). `feature_brakes` is key-value (`migration-v65-feature-brakes.sql`) — new keys need no schema change.
- Error telemetry `logFunctionError(ctx)` — `reddit-intel-error-log.ts:70` (inserts `cost_telemetry` WHERE `feature='…-error'`).
- 5K-chunk retention SQL template — `archive_feed_items_batch` (v98) / `archive_secondary_tables_batch` (v118): `LIMIT p_batch_size` → `DELETE … WHERE id = ANY(v_ids)` → cron drain-loop until 0.
- Per-item `step.run` (correct) — `meta-brp-report.ts:102` (`step.run(\`report-${detection.id}\`)`). Whole-loop (avoid for fan-out) — `regulator-alert-push.ts:123`.
- `readBoolEnv()` / `readStringEnv()` — `packages/utils/src/env.ts` (bracket-notation + trim; server flags only — `NEXT_PUBLIC_*` stays literal).

## Themed PR bundles

### Bundle A — Cost telemetry + brakes (code-only, no migration) → Issue

**Fixes:** S1, H4, M-brake, N-meta-confirm.

- `logCost()` into the 5 paid-API helpers (`twilio-lookup`, `abuseipdb`, `ipqualityscore`, `urlscan`, `ct-lookup`). Add the two missing `PRICING` constants.
- Brake guards `isFeedItemsEmbedBraked()` / `isScamReportEmbedBraked()` + flag gates on `feed-items-embed.ts` and `scam-report-embed.ts` (copy `isRedditIntelBraked` shape). New `feature_brakes` keys `feed_items_embed`, `scam_report_embed`.
- `cost-daily-check/route.ts`: register the two new caps in the per-feature block (lines 139-209); add an invariant log/assert that every per-feature cap ≥ global threshold; aggregate brakes off an unbounded `GROUP BY feature`, not the `.limit(10)` display slice.
- Confirm `FF_META_BRP_REPORTER` OFF in prod (verify via a fn run, not `vercel env ls`); comment-guard the uncomment-without-UPDATE footgun in `meta-brp-report.ts`.

### Bundle B — Enrichment correctness (code + 1-2 RPCs) → Issue

**Fixes:** H2, H3, H5, M-risk.

- **H2** `urlscan-enrichment.ts`: per-URL `step.run(\`submit-${entityId}\`)`so retries don't re-pay; replace read-modify-write on`enrichment_data`with a`jsonb_set`/merge RPC.
- **H3** `entity-enrichment.ts`: `in_progress` reaper — re-claim rows `in_progress > N min` (or reset step at start).
- **H5** `reddit-intel-cluster.ts`: idempotent `persist-clusters` (upsert themes on deterministic key, not `Math.random()` slug); fix in-batch new-theme matching; add retry-with-feedback to the naming Sonnet call.
- **M-risk** `risk-scorer.ts`: set-based `compute_entity_risk_scores(ids[])` RPC (kill the 100-call loop); order by `risk_scored_at ASC NULLS FIRST` to fix starvation.

### Bundle C — Cron determinism / idempotency (code-only) → Issue

**Fixes:** H7, phone-footprint requestId, M-reg, M-ct.

- **H7** `clone-watch-urlscan-rescan.ts:80`: date-bucket event id (`:${todayUtc}`); add `feature_brakes.shopfront_clone_outreach` pre-check.
- `phone-footprint-refresh.ts:206`: `requestId` from stable `queueId`; hoist `getFootprintIdByRef` out of the per-delta loop (:243).
- **M-reg** `regulator-alert-push.ts`: per-narrative `step.run(\`push-${id}\`)`.
- **M-ct** `ct-monitor.ts`: one `step.run` per crt.sh keyword; backoff sleeps out of the shared step.

### Bundle D — Retention hardening + migrations → Issue

**Fixes:** M-cost, M-telco, M-bill, compliance error-telemetry.

- Chunk to ≤5K with `SET LOCAL statement_timeout = '300s'` (never `0`) — new idempotent migrations superseding bodies of `prune_cost_telemetry` (v112), `prune_telco_events` (v113), `anonymise_expired_footprints`/`sweep_inactive_monitors` (v75). Template = v98/v118.
- **M-bill** `billing-ingest-nightly.ts`: `AbortSignal.timeout()` on external `fetch`; independent per-provider steps (catch-per-step).
- `logFunctionError()` + Telegram page-on-failure on the two compliance sweeps.
- Apply migrations via `mcp__supabase__apply_migration` (project `rquomhcgnodxzkhokwni`) **after** Vercel-green; re-run advisors before merge.

### Bundle E — cluster-builder safety pre-fix (code + possibly 1 RPC) → Issue

**Fix:** H1. Cheap precursor to the parked Phase 8.1 rewrite.

- `.limit()` + cursor pagination on the unclustered-links fetch (`cluster-builder.ts:82`); chunk the `scam_reports.cluster_id` UPDATE ≤5K (:233); atomic cluster-insert → member-insert → report-stamp (single RPC/guard). Leave recursive-CTE SQL-isation to BACKLOG 516.

### Bundle F — Consolidation / necessity (code + cron-schedule edits) → Issue

**Fixes:** C-\*, M-fb, 3am stagger, ct-monitor audit, BACKLOG item 9.

- Merge the two Sunday digests into one Telegram message — removes a fn + cron and fixes the `0 9 Sun` collision with the daily feedback-digest.
- **M-fb**: change-guard early-exit on `feedback-triage-refresh`, or drop cadence to `*/15`–`*/30`.
- Stagger the three `0 3 * * *` staleness crons (`0/10/20 3`); fold in BACKLOG item 9's 5K-batch `mark_stale_*` rewrite.
- ct-monitor dedup-vs-Python-scraper audit — decide keep/retire; document.
- _(Optional)_ generic retention runner replacing the 7 near-duplicate wrappers (config-driven), concentrating timeout-cap/progress-log/error-paging. Apply the deletion test first.

## Sequencing

1. **Bundle A** + **H6** (one-line `REVOKE … FROM PUBLIC` migration — fast-track, can ride A or solo) — cheap, high-value.
2. **Bundle B** + **Bundle C** — code-only, parallelisable.
3. **Bundle D** + **Bundle E** — migration-bearing; coordinate with the parallel agent so two agents don't both apply migrations.
4. **Bundle F** — last, most discretionary.

## Verification

- Per bundle: `pnpm --filter @askarthur/scam-engine typecheck && test`, `pnpm --filter @askarthur/web typecheck` (+ `pytest` if Python touched).
- Inngest fns: trigger each touched fn on the Vercel preview, confirm run output (env is snapshotted at deploy — new flags need a redeploy). Insert a `feature_brakes` row and re-trigger to confirm short-circuit.
- Migrations (D/E): run `packages/scam-engine/src/__tests__/rpcs.smoke.test.ts` against a preview branch; re-run `mcp__supabase__get_advisors` (security + performance) — no new ERRORs. Verify H6 with `has_function_privilege('public','list_clone_alerts_for_urlscan_rescan(int,int)','execute')` → false.
- Cost telemetry (A): after a real enricher run, `cost_telemetry WHERE feature IN ('twilio-lookup','abuseipdb','ipqualityscore','urlscan','ct-monitor')` returns rows; `/admin/costs` shows them.
- Idempotency (B/C): force an Inngest retry (throw mid-step in preview) → no duplicate themes (H5), no double URLScan submit (H2), no duplicate `phone_footprints` snapshot.
- Retention chunking (D): seed a >5K-row backlog in a preview branch, run the sweep, confirm per-chunk progress logs + no single statement exceeds the 300s cap / 10-min watchdog threshold.

## Risk / coordination notes

- A **parallel agent is active**. Migration-bearing bundles (D, E) and any `feature_brakes`/`cost-daily-check` edits must be coordinated — agree branch ownership before applying migrations to `rquomhcgnodxzkhokwni`.
- New server-side flags use `readBoolEnv()` (`packages/utils/src/env.ts`), never the `=== "true"` literal. `NEXT_PUBLIC_*` stays literal.
- Every new SECURITY DEFINER RPC: `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` (the H6 lesson).
- No behaviour change to functioning jobs beyond the listed fixes; consolidation (F) is opt-in last and reversible.
