# Inngest slot budget — how to read it, and the decision rule for the fan-outs

Written 2026-09-07, after a day spent discovering that the obvious meter was the
wrong one. This exists so the next reader does not repeat that.

## What is actually constrained

Production dashboard, 2026-09-07:

```
Events received          274 / 500k     <- idle
Current backlog            0 / 100k     <- idle
Executions (runs+steps)   11k
CONCURRENCY IN USE         5 / 5        <- saturated (free pool, IN-XS)
```

**Volume is not the problem. Executor slots are.** Events and queue depth sit
near zero. An Inngest step holds one of the five slots for its entire duration,
so the scarce resource is **slot-seconds**, not queries and not step count.

This matters because the two obvious levers pull in opposite directions:

| lever               | executions meter | slot-seconds |
| ------------------- | ---------------- | ------------ |
| fewer, longer steps | better           | **worse**    |
| more, shorter steps | worse            | better       |

Neither is the answer on its own. The lever that serves both is **less work per
slot-second** — set-based writes instead of per-row loops (#1119, #1121).

## The measurement, and why the old one lied

Until #1120, `fn.complete` logged `durationMs = Date.now() - <handler entry>`.
Inngest **re-executes the handler body from the top at every step boundary**, so
that timestamp resets on each replay and the field only measured the final
segment. Over seven days almost every function reported `avg=1ms` — including
`reddit-intel-cluster`, directly observed holding a slot for minutes.

`fn.complete` now carries three fields that matter:

- **`elapsedSinceTriggerMs`** — `Date.now() - event.ts`. The event timestamp is
  set when the run is _triggered_ and survives replay. Includes queue wait,
  deliberately: on a saturated pool, time spent waiting for a slot is as
  interesting as time spent holding one.
- **`finalSegmentMs`** — the old measurement, honestly named.
- **`attempt`** — required for reading the above. `event.ts` is the _original_
  trigger time, so on a retry `elapsedSinceTriggerMs` includes every prior
  attempt and its backoff, which is not slot time. **Always filter to
  `attempt == 0`.**

## The query

Run against the `ask-arthur` Axiom dataset (`AXIOM_QUERY_TOKEN`, or
`apps/web/lib/axiom-query.ts`), over a full 24h so every cron cadence fires:

```kusto
['ask-arthur']
| where message == 'fn.complete' and ['fields.attempt'] == 0
| summarize
    runs   = count(),
    p50    = percentile(['fields.elapsedSinceTriggerMs'], 50),
    p95    = percentile(['fields.elapsedSinceTriggerMs'], 95),
    work   = percentile(['fields.finalSegmentMs'], 50)
  by ['fields.fn']
| sort by p95 desc
```

`fn.complete` is emitted at **WARN**, which bypasses sampling entirely, so
`runs` is a true count and the percentiles cover every run. It fires exactly
once per logical run, which is what makes it the only real run counter this
wrapper emits.

That was not always true. Until #1007 it was INFO at 10% sampling, and a
low-frequency cron was indistinguishable from one that never ran —
`archive-shadows-retention` showed 1 start and 0 completes across ~19 nightly
runs. **Axiom data from before 2026-09-07 is still a 10% sample**, so do not
compare a `count()` across that boundary.

`fn.start` deliberately stays INFO and sampled: the handler is re-executed at
every step boundary, so it fires more than once per run and un-sampling it would
add volume without producing a counter. Use
`dcount(['fields.requestId'])` if you need distinct runs from it, and never
infer health from a `fn.start` / `fn.complete` gap — they have different sample
rates _and_ different per-run cardinality.

## Before you conclude a function is dead: ask Inngest, not Axiom

On 2026-09-08 `clone-watch-enrich-attribution` showed **no Axiom signal for a
month** — no `fn.start`, `fn.complete` or `fn.error`. It was reported as dead.
Inngest's own records showed the daily cron had **completed every day**:

```
2026-09-03  Completed  13:30:48 → 13:59:35
2026-09-05  Completed  13:30:31 → 13:37:42
2026-09-06  Completed  13:30:33 → 13:35:40
2026-09-07  Completed  13:30:41 → 13:34:52
2026-09-08  Completed  13:30:21 → 13:36:18
```

Two things produced the silence, and both are now documented:

1. Before #1007 (2026-09-07), `fn.complete` was 10%-sampled, so a once-a-day
   function was expected to be invisible ~90% of days.
2. The wrapper fire-and-forgot its Axiom flush. Measured loss on a many-run
   function: **44 events sent, 41 `fn.complete` received — ~7%**. Fixed by
   awaiting the flush (bounded, never fatal). Data from before that fix still
   carries the loss.

**Silence in Axiom is not evidence a function did not run.** The ground truth
is Inngest, and the REST API exposes it without the dashboard:

```bash
K=$INNGEST_API_KEY   # apps/web/.env.local
# 1. find the cron tick (retention reaches back weeks)
curl -s "https://api.inngest.com/v1/events?name=inngest/scheduled.timer&received_after=2026-09-08T13:25:00Z&received_before=2026-09-08T13:35:00Z" -H "Authorization: Bearer $K"
#    → pick the event whose data.cron matches, take its internal_id
# 2. what did that tick produce?
curl -s "https://api.inngest.com/v1/events/<internal_id>/runs" -H "Authorization: Bearer $K"
#    → status, run_started_at, ended_at, run_id. Empty data = no run was created.
# 3. a run's current state
curl -s "https://api.inngest.com/v1/runs/<run_id>" -H "Authorization: Bearer $K"
```

For an event-triggered function, send its manual-trigger event with the
production `INNGEST_EVENT_KEY` (`vercel env pull` — it is not Sensitive-typed)
to `https://inn.gs/e/$EVENT_KEY`; the response `ids[0]` is the event id for
step 2. That is a real production invocation, so respect the function's caps.

`/v1/runs` (list), `/v1/functions`, `/v1/apps` and `/v1/usage` do not exist on
this API tier; run visibility is only reachable through an event.

## The decision rule — settled in advance, deliberately

These thresholds were chosen **before** the data existed, so the decision is
mechanical rather than an argument constructed around whatever came back. That
is the point.

### Step 0 — is there contention at all?

**Do not compare `p50` against `finalSegmentMs`.** An earlier version of this
rule did, and it is invalid: `finalSegmentMs` is only the LAST replay segment,
not total work, so the ratio is enormous by construction — measured at 215x and
30,000x on 2026-09-07 — and the gate could only ever return one answer. A rule
that cannot say "stop" is not a gate. Nothing in the current telemetry separates
queue wait from execution time, because total execution time across replays is
not measured.

Use **absolute `p95` elapsed, weighted by runs/day**, which is a fair proxy for
how long a function occupies the system regardless of the work/wait split:

- **If no function's `p95` x runs/day is a meaningful share of a slot-day**
  (5 slots x 86,400s = 432,000 slot-seconds), the 5/5 reading was instantaneous
  sampling. **Stop. Do not rework anything.** Revisit only if the dashboard's
  queue backlog goes above zero or cancellations appear.
- Otherwise, rank by that product and continue with the biggest.

Two conditions must hold before the numbers mean anything:

1. **#1007 must be deployed** (merged 2026-09-07). Before it, `fn.complete` was
   INFO at 10% sampling, so `runs` is a tenth of reality.
2. **A full 24h must have elapsed since the deploy**, so every cron cadence
   fires at least once — the daily ones (`clone-watch-enrich-attribution` at
   13:30 UTC, and the preclassify fan-out that follows the 08:30 NRD ingest) are
   exactly the two under evaluation.

### Step 1 — `shopfront-clone-haiku-preclassify`

Real work is ~3s (one Haiku call plus two DB round trips). It fans out **one
event per row, up to 50 runs/day x 2 steps = 100 boundaries**, and its
`concurrency: { limit: 3 }` lets it hold **three of the five slots** at once.

- **`p50 > 60s`** (20x its work) → queue wait dominates. **Do the fold:**
  `batchEvents: { maxSize: 50, timeout: "60s" }` turns 100 boundaries into 2.
  The handler parses one event today and must iterate `events[]`.
  **Carry over the idempotency reasoning first** — `idempotency: "event.id"`
  plus the date-stamped id in `shopfront-nrd-daily-ingest.ts` is the mechanism
  that re-attempts stranded rows the next day. Under `batchEvents` that no
  longer applies per-alert; the `record_clone_watch_classification` upsert and
  the selector's `cwc.alert_id IS NULL` exclusion (v159) become the only
  guards. They are sufficient, but the note must be rewritten, not deleted.
- **`p50 < 15s`** → leave it.

### Step 2 — `clone-watch-enrich-attribution`

One run/day, `2 + N + K + B` steps where N ≤ `ENRICH_RUN_CAP` (60). Its declared
33-minute finish budget is pinned to that 64-boundary worst case by
`apps/web/__tests__/inngestFinishBudgets.test.ts`.

- **Total `elapsedSinceTriggerMs` p50 > 20 min** → **do the fold:** collapse the
  60-way `enrich-${alert.id}` fan-out into one step with bounded-parallel
  `enrichCloneAttribution` (chunks of 5–8 via `mapWithConcurrency` from
  `@askarthur/utils/concurrency`) plus one bulk upsert. 60 boundaries → 1, and
  the finish budget drops from 64 boundaries to ~5. **Lower the declared
  `inngest-finish-budget:` comment in the same commit** or the budget test will
  keep enforcing the old number.
  - The enrichment calls themselves **cannot be batched** — per-domain RDAP /
    whois / CT / AbuseIPDB / ABR. Bounded parallelism only. Watch the AbuseIPDB
    free-tier 1,000/day cap when widening.
  - `kit-pivots` calls urlscan per IP and `break`s on `rate_limited`. That
    sequential-abort semantic must be preserved explicitly if parallelised, or
    kept at concurrency 2–3.
- **< 5 min** → leave it.

### Step 3 — the cheap one, regardless of the above

Merge `check-brake` into `select-pending` in the enricher. It spends a whole
step boundary — and therefore a slot acquisition — on one single-row
`feature_brakes` SELECT. The sibling preclassifier already folded this and
documents why at `clone-watch-haiku-preclassify.ts:195-201`.

## Outcome — applied 2026-09-08 against a full un-sampled day

| function                          | runs/day | p50              | p95   | slot-s/day | share of pool |
| --------------------------------- | -------- | ---------------- | ----- | ---------- | ------------- |
| shopfront-clone-haiku-preclassify | 41       | 166 s            | 270 s | 6,810      | 1.6%          |
| clone-watch-enrich-attribution    | 1        | ~6 min (Inngest) | —     | ~360       | 0.1%          |
| **whole fleet (30 functions)**    |          |                  |       | **17,448** | **4.04%**     |

**Step 0 says stop.** 17,448 of 432,000 slot-seconds. The 5/5 concurrency
reading was instantaneous sampling, not sustained pressure. **Neither fan-out
is reworked.** Revisit only if the dashboard's queue backlog leaves zero or
cancellations appear.

Two corrections were needed to reach that, both now in this doc: the original
Step 0 could only ever say "continue" (fixed in #1125), and the enricher's
absence from Axiom was a telemetry loss, not a dead function (§ above).

## What has already been done

| PR    | change                                                                                                                                                                                                                                                                                                          |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1117 | clustering: load+assign+persist in one step (vectors must not cross a step boundary — 4 MB cap)                                                                                                                                                                                                                 |
| #1119 | clustering writes set-based; round trips scale with distinct themes, not posts                                                                                                                                                                                                                                  |
| #1120 | `elapsedSinceTriggerMs` + `finalSegmentMs` + `attempt` — the measurement this doc depends on                                                                                                                                                                                                                    |
| #1121 | campaign-key backfill grouped; `mapWithConcurrency`/`groupBy` shared in `@askarthur/utils/concurrency`                                                                                                                                                                                                          |
| #1129 | the four converted wall-clock guards read `elapsedSinceTrigger(…) ?? 0` — fail-open on an unusable `event.ts`; degraded to a segment clock                                                                                                                                                                      |
| #1130 | Step Budget Module (`step-budget.ts`): `budgetedStep` (in-step, clock at step entry by construction) + `spanningBudget` (across boundaries, clock `event.ts`); clustering's 240 s no longer starts after the load; naming step budgeted; `reddit-intel-cluster` gets its first `timeouts.finish` (13m, derived) |

## Standing rule

Measure against production before changing a hot path. On 2026-09-07 the
clusterer's slot hold was estimated at 30–45s and measured at **7.3 minutes** —
off by a factor of ten — and the campaign-key backfill was proposed as a 500x
win and measured as ~3x against an empty worklist. Both corrections came from
querying prod, not from reading code.
