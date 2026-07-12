# Inngest Hobby-plan concurrency budget + cron cadence policy

**Status:** accepted (2026-05-30)

The Inngest Hobby plan gives the whole account **5 concurrent execution slots**
and a **50,000 step-run/month** free-tier cap. The May 27–29 execution burst ran
**123,511 step-runs** — ~2.5× the monthly cap in three days — driven by a runaway
URLScan loop plus a fleet of `*/30` and hourly crons all contending for the same
5 slots and starving the latency-sensitive analyze fan-out. We record this
because the resulting policy (a concurrency budget reserved for analyze, plus a
cadence-cut convention) is hard to reverse without re-introducing the same
contention, and because the lookback-overlap reasoning that makes the cadence
cuts lossless is non-obvious.

## Context

The root cause of the volume was fixed first in PR #551 (migration v169:
URLScan failure-streak short-circuit + a daily submission throttle). PR #552 is
the structural hardening: it stops a healthy-but-busy fleet from monopolising
the 5-slot budget and from generating step-runs faster than the work actually
requires.

Two pressures shaped the decision:

1. **The analyze fan-out is latency-sensitive and the rest is not.** A user
   waiting on `/api/analyze` cares about seconds; a regulator-alert push or a
   feed embed does not care about 30 vs 60 minutes. When all functions share one
   5-slot pool, a burst of heavy recurring fan-out can fully occupy the slots and
   delay the analyze consumers.
2. **Many crons ran far more often than their inputs change.** `*/30` embeds and
   pushes generated step-runs every half hour whether or not new rows had landed,
   and a 5-minute materialized-view refresh ran the (expensive) `REFRESH … CONCURRENTLY`
   regardless of whether feedback had changed.

## Decision

### Concurrency budget — reserve ≥2 slots for analyze

Cap the heavy recurring fan-out functions at **concurrency 3** so that, even
when every heavy function is saturated, **≥2 of the 5 slots remain free** for
the analyze fan-out consumers. The 5→3 rebalance applies to:

- `phone-footprint-pdf` (render)
- `phone-footprint-refresh-monitor`
- `phone-footprint-vonage-backfill-monitor`
- `enrich-vulnerability` (AU-context per-CVE)
- `match-b2b-exposure`

### Cadence-cut policy — wider cadence is lossless when the lookback overlaps

Widen a recurring cron only when the window it reads back over is ≥ its new
interval, so no input can fall through the gap between runs:

- `feed-items-embed`: `*/30` → `0 * * * *` (hourly). Pulls all unembedded rows,
  so a wider gap only delays embedding, never drops it.
- `regulator-alert-push`: `*/30` → `0 * * * *` (hourly), **with LOOKBACK_MINUTES
  raised 60 → 75**. The 75-minute lookback overlaps the 60-minute interval, so
  every alert is still seen exactly once even at an hourly cadence.
- `clone-watch-poll-netcraft` (`shopfront-clone-poll-netcraft`): `*/30` →
  `0 * * * *` (hourly). Polling takedown status is not time-critical.
- `onward-auto-report` (`report-onward-auto-report`): `25 * * * *` (hourly) →
  `25 */3 * * *` (every 3h). Its sweep reads a 24h window and dedups via the
  `onward_report_log` unique index, so a 3h cadence is lossless.

### Change-guard for expensive refreshes

`feedback-triage-refresh`: `*/5` (relaxed to `*/15` in #524) → `*/30`, **plus a
change-guard early-exit** so most ticks skip the `REFRESH MATERIALIZED VIEW
CONCURRENTLY` entirely (only refreshing when underlying feedback has changed),
**plus `singleton: { mode: 'skip' }`** so overlapping ticks don't stack.

### Circuit-breaker conventions (fleet-wide)

Applied across the fleet in #552:

- **`timeouts.finish`** — a finite finish-timeout on long-running functions so a
  hung step can't occupy a slot indefinitely (and can't silently rack up
  step-runs).
- **`singleton: { mode: 'skip' }`** — for crons where a second concurrent run is
  never wanted; a tick that overlaps a still-running prior tick is skipped rather
  than queued.
- **concurrency limits** — explicit per-function caps (see the budget above)
  rather than relying on the implicit shared pool.

### Deregistration → full removal of `meta-brp-report`

`meta-brp-report` (Meta Brand Rights Protection deepfake reporter) was a stub
that did no real work; #552 **removed it from the Inngest function registry**
(`packages/scam-engine/src/inngest/functions.ts`) so it stopped consuming a cron
slot and step-runs. **Superseded 2026-07-13 (fleet review):** the stub file, its
`metaBrpReporter` feature flag, and its doc/`feature_brakes` references were
**fully deleted** — it never ran (unregistered, `deepfake_detections` empty
all-time, Graph-API call commented out, footgun #519) and saved 0 step-runs, so
keeping it as dead code only cost review-surface. Resurrect from git history if
deepfake→Meta BRP reporting is ever built; the go-live checklist must couple the
Graph-API call and the `reported_to_meta=true` UPDATE in one commit (#519).

## Reversal trigger

If analyze fan-out latency is fine and a recurring function's freshness SLA
tightens, a cadence can be narrowed again — but only after re-checking that the
lookback window still overlaps the (smaller) interval. If Inngest is upgraded off
the Hobby plan (more slots), the concurrency-3 caps can be relaxed, but keep the
"reserve slots for analyze" principle proportional to the new slot count.

## Related

- #551 — root-fix: URLScan failure-streak short-circuit + daily throttle (migration v169)
- #552 — this hardening: circuit breakers + concurrency rebalance + cadence cuts + change-guard + `meta-brp-report` deregistration
- #524 — earlier `feedback-triage-refresh` relaxation (`*/5` → `*/15`)
- `docs/plans/inngest-cron-hardening.md` — the cron-hardening plan these changes execute
- `docs/system-map/background-workers.md` — current per-function cron cadences
- `docs/inngest-brakes.md` — per-function concurrency + step-budget table
