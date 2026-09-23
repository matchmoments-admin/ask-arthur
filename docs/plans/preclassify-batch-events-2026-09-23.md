# Pre-classifier batching (deferred item from the clone-watch deepening, 2026-09-23)

**Gate:** implement only after the first at-volume Jev run (08:30 UTC 2026-09-23)
verifies healthy — every new `clone_watch_classifications` row `model_id='jev-…'`,
~25–50 `shopfront_clone_preclassify`/`typesafe` cost rows, zero `anthropic`, zero
`*_error`. If that run is unhealthy, fix/roll back first
(`FF_CLONE_WATCH_JEV_PRIMARY=false`) and do NOT batch.

## Problem (prod, 14 days to 2026-09-22)

`shopfront-clone-haiku-preclassify` starts ONE Inngest run per alert: ~26 runs at
08:31 each morning, `concurrency: 3`, i.e. 3 of the account's 5 slots held during
the fleet's busiest window. With Jev the real work is ~300 ms/alert — the whole
day is ~8 s of vendor time wrapped in 26 runs × 2–3 step boundaries.

## Change

1. **Trigger:** `batchEvents: { maxSize: 50, timeout: "60s" }` on
   `shopfront/clone.preclassify-requested.v1`; `concurrency: 1`.
2. **Duplicate protection:** drop `idempotency: "event.id"` (Inngest rejects it with
   `batchEvents`). Protection is preserved where it actually lives:
   - the fan-out's event id `clone-watch-preclassify:<alertId>:<YYYY-MM-DD>` is
     deduplicated by Inngest at ingestion (24 h window) — the same guarantee the
     function-level key gave;
   - the handler dedupes `alertId` within a batch;
   - `record_clone_watch_classification` is an UPSERT (write-idempotent).
3. **Handler:** parse every event; dedupe; one brake read (fail-closed); ONE
   `budgetedStep("classify-batch")` running the items through
   `mapWithConcurrency` — Jev primary: `classifyPrimaryWithJev` at 4 in flight;
   Haiku rollback (`FF_CLONE_WATCH_JEV_PRIMARY=false`): the existing per-alert Haiku
   path + Jev shadow tail at 2 in flight. Per-item try/catch: a failed alert writes
   its `_error` row and is left for the next daily re-fan (the selector re-emits any
   alert with no classification row — the existing backstop). Items the budget
   can't reach are likewise left for tomorrow and counted.
4. **Observability:** the Lane joins the roster (`recordLaneOutcome`,
   feature/op `shopfront_clone_preclassify`/`batch`): `{ events, alerts, classified,
failed, unreached, braked }`; silent-zero = `alerts>0 ∧ classified=0`. The
   absence watch on `classify` rows stays (it proves vendor calls happen).
5. **Budget:** budgetedStep 200 s (50 × Haiku ~3 s / 2 in flight = 75 s worst
   realistic); finish floor per `inngestFinishBudgets.test.ts`.

## Expected effect

~26 runs/day → 1; ~60–75 steps/day → ~4; the 08:31 slot crunch (3 of 5 slots)
→ 1 slot for seconds. No change to what is classified or how.

## Tests (go-red each)

- batch of N events → N classifications, one run; duplicate alertIds classified once
- one alert throws → others persist, its `_error` row written, outcome `failed: 1`
- braked → nothing classified, outcome `braked: true`
- rollback path (flag off) classifies via Haiku with the shadow tail
- roster/laneHealth/finish-budget guards updated

## Rollback

Revert the PR. Events already queued are processed per-alert again by the old
handler; the UPSERT makes any overlap harmless.
