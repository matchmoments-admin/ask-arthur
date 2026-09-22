# Clone-watch deepening plan (2026-09-23)

Source: `/improve-codebase-architecture` review of clone-watch end to end (three audits:
architecture friction, prod invocation/telemetry cost, platform integration), run after
#1176. Goal: simple, efficient, scalable; every Lane observable; clone-watch serving the
whole platform through existing seams, not beside them.

Baseline (prod, 14 days to 2026-09-22): ~250–330 Inngest steps/day across clone-watch;
~80 urlscan submits/day to non-resolving domains; reconcile max run 13.6 of a 15 m finish;
8 of 23 Lanes write an Outcome Row; enrich-attribution silent 6 days (09-11..16).

## Sequencing

Seven PRs. 1→4 are serial (they share Lane files); 5, 6, 7 run in parallel worktrees.
Migration numbers are reserved up front so parallel branches cannot collide.

| PR | Items | Migration | Owner |
| -- | ----- | --------- | ----- |
| 1 | Attribution Module (#1) + Lifecycle/thresholds made load-bearing (#7) | v315 | lead |
| 2 | Lane ledger completion (#3) — supersedes #1175 | — | lead |
| 3 | Netcraft report Module + reconcile batching (#2) | v316 | lead |
| 4 | Liveness gate + invocation shaping (#4, #5) | v317 | lead |
| 5 | Analyze consults first-party threat URLs (#6) | v320 (if needed) | agent |
| 6 | Clone takedowns through the onward routing brain (#8) | v318 | agent |
| 7 | One monthly per-brand store (#9) | v319 | agent |

## PR 1 — Attribution Module + Lifecycle load-bearing

- `lib/clone-watch/attribution.ts`: the ONE reader of `shopfront_clone_alerts.attribution`
  (`readAttribution(jsonb) → { registrar, registrarIanaId, abuseEmail, createdDate,
  nameServers, statuses, hosting{ip,asn,country}, registrantCountry }`), typed against the
  writer's `CloneAttribution`. Every reader goes through it: enforcement matrix, admin send
  route (fixes the 422), clone-cohort/clone-metrics, lifecycle-recheck, submit-netcraft,
  brand-outreach-pilot, enrich-attribution's own `DossierShape`. Registrar abuse channel uses
  `lib/email/registrar-abuse.ts` (curated URL + ICANN fallback) instead of email-only.
- v315: `feed_clone_platform_entity` projects `attribution.whois` onto
  `scam_urls.whois_registrar / whois_created_date` (B2B feed stops returning nulls for
  clones) + backfill of existing clone rows; `taken_down` lifecycle downgrades the
  Platform Entity's `confidence_level` from high→medium (no longer blocks forever).
- v315: the eight surviving `p_min_confidence DEFAULT 0.7` → `0.4` (ADR-0026 scale).
- `lifecycle.ts` becomes load-bearing: export `NO_DOWNGRADE_STATES`; `netcraft-urls.ts`
  imports it; a SQL-parity test reads the migration guard's state list.

## PR 2 — Lane ledger completion (ADR-0025 extended)

- Roster keyed by REAL Inngest ids; sub-lanes as `metadata.sub_lane`.
- `recordLaneError(lane, err, meta)` beside `recordLaneOutcome` — one `$0` error row shape
  (`<feature>_error`), replacing hand-rolled `-error` literals.
- `brakeState(feature) → 'engaged' | 'clear' | 'unknown'`; each caller states its unknown
  policy (outbound = fail closed).
- Every clone-watch Lane writes an Outcome Row on every exit path (incl. quiet/skip):
  enrich-attribution, auto-triage (from #1175), netcraft-auto (auto sub-lane),
  feed-platform quiet path, notify-weaponised, notify-brand-prepare, enforcement-plan/execute,
  reemergence, digests, report-summary, stewardship. Fire-and-forget `logCost` inside steps
  replaced by awaited writes.
- `laneHealth.ts` absence watches for the new roster entries.

## PR 3 — Netcraft report Module + reconcile batching

- `lib/clone-watch/netcraft-report.ts`: `reportToNetcraft(alerts, { kind })` owns reason
  text, reporter email, POST (one timeout), `merge_clone_alert_submission`, lifecycle
  advance to `reported`. netcraft-auto (auto + resubmit) and the manual triage path use it;
  the `shopfront-clone-submit-netcraft` Lane is deleted (triage emits into the same Module).
- Reconcile: fetch ≤12 uuids in ONE step (bounded concurrency, soft-fail per uuid), apply
  in ONE set-based RPC (`apply_netcraft_reconcile_batch`, v316) that records verdicts +
  lifecycle together. v316 cadence backoff: `netcraft.unchanged_reads` counter; after 3
  unchanged reads the uuid is revisited every 72 h. Steps/run 27 → 4.

## PR 4 — Liveness gate + invocation shaping

- `probeLivenessVerdict` gates urlscan submit + recheck (dead → stamp the existing dead-domain
  cadence, no urlscan/SB call). reemergence-monitor uses the same Module (fixes the
  timeout-reads-as-dead bug).
- v317: recheck backoff — a declined row with ≥8 unchanged rechecks moves to weekly.
- Preclassify: `batchEvents { maxSize: 50, timeout: "60s" }` — one run classifies the day.
- urlscan-retrieve: `budgetedStep` (was the wrong `spanningBudget`); cron
  `10 3,9,12,15,21 * * *`.
- feed-platform: `debounce { period: "2m" }`. enforcement-execute: daily while its flag is off.

## PR 5 — First-party threat URLs in the analyze verdict

- In `packages/scam-engine/src/analyze-core.ts` (shared by web/extension/bots), look up the
  submitted URLs' hosts in `scam_urls` (`confidence_level in ('high','confirmed')`,
  `is_active`) and feed hits into `mergeVerdict`'s `urlResults` as a first-party reputation
  source — same seam as GSB/VT, not a post-hoc red flag. Replaces the triage-status-only
  `clone-alert-lookup` citation for weaponised clones.

## PR 6 — Clone takedowns through the onward routing brain (ADR-0018 amendment)

- v318: `onward_report_log.clone_alert_id` (nullable FK) + `netcraft` onward destination;
  clone enforcement-execute becomes a producer into `onward_report_log` (per-URL dedup across
  scam-report and clone sources); intake constants only in `lib/onward/destinations.ts`.
  Stewardship "reported" counts then include clone sends.

## PR 7 — One monthly per-brand store (ADR-0020 amendment)

- v319: `clone_watch_monthly_brand_stats` gains `brand_normalized`, `weaponised_ever`,
  `taken_down_in_month`, `frozen_at`; published months are not rewritten on re-run.
  report-brand-stewardship reads the store instead of refolding alerts. One monthly cohort
  producer; consumers read.

## Verification per PR

Typecheck + full web/scam-engine suites; go-red on every new guard; migration applied to
prod and exercised on real rows; post-merge: trigger each touched Lane via its manual event
and read its Outcome Row. Final: a 24 h telemetry diff vs the baseline above.
