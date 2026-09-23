# Inngest fleet audit — 2026-09-16

Asset for wayfinder ticket [#1146](https://github.com/matchmoments-admin/ask-arthur/issues/1146)
on map [#1143](https://github.com/matchmoments-admin/ask-arthur/issues/1143). The retire /
park / skip decisions are the founder's and live in
[#1152](https://github.com/matchmoments-admin/ask-arthur/issues/1152); this page is the evidence.

## Method (so the numbers can be re-derived)

- **Registry:** every `createFunction(` under `apps/web/app/api/inngest/functions/` and
  `packages/scam-engine/src/inngest/` — 75 functions (74 parsed by id literal + `analyze-failure-subscriber`,
  whose id is a constant). Triggers, `concurrency`, `throttle`, `timeouts.finish`, static `step.run`
  sites and the first flag gate were read from source. Four functions whose source _comments_
  mention a cron (`scam-alert-push`, `enrich-vulnerabilities-cron`, `regulator-alert-push`,
  `report-onward-auto-report`) are **already parked as event-only** by an earlier sweep — the
  precedent for the PARK verdict below.
- **Runtime:** the Inngest REST API (`GET /v1/events?name=inngest/function.{finished,failed,cancelled}`,
  signing key) swept over **7 days, 2026-09-09 → 09-16**, in 3-hour windows split adaptively
  under the ~51-row cap (174 calls, 1,053 rows). Each event carries `function_id`, the trigger
  event's `ts`, the run's **return value**, and `received_at`. Axiom was not reachable
  (`AXIOM_QUERY_TOKEN` is a sensitive var and pulls back empty).
- **`slot-min/wk`** = Σ (`received_at` − trigger `ts`) per function. This is trigger→finish
  wall time, which INCLUDES account-concurrency queue wait. It is the contention a function
  adds to the 5-slot pool, not its pure execution time; a 240 s "no-op" is mostly queue wait
  on the `:00` pileup, which is precisely why the no-op check must run before any `step.run`.
- **`no-op runs`** = runs whose return value carried `skipped: true` or a `reason` string.
  Functions that return counts of zero without a reason (auto-triage) are under-counted here.
- **Not covered:** monthly crons (1st/2nd of month fall outside the window); event-driven
  functions that received no events (dormant, cost nothing); Vercel compute cost (this is
  Inngest slot contention only).

## Headline

|                                                                                                              | slot-min/wk               | share |
| ------------------------------------------------------------------------------------------------------------ | ------------------------- | ----- |
| Fleet total (51 functions that ran)                                                                          | **2,623** (≈ 375 min/day) | 100%  |
| Runs that did nothing on a dark flag, a mothballed feature, or an empty worklist (PARK / ADD-SKIP / RETIRE?) | **750**                   | 29%   |
| One-run-per-alert fan-out that should be one batch run (`haiku-preclassify`, #1074)                          | **382**                   | 15%   |
| Runs cancelled at `timeouts.finish` or failing identically every day (FIX)                                   | **684**                   | 26%   |

So roughly **70% of the fleet's trigger→finish time is spent on runs that produce nothing**,
and the concurrency crunch (#1069) is a symptom of that, not of real work exceeding 5 slots.
Code-side relief first, Inngest Pro only with evidence — the evidence says the pool is
mostly holding queue-waiters.

### Defects found (fleet, not clone-watch)

1. **`acnc-charity-backfill-embed` has failed every run for the whole window** — 7/7
   `NonRetriableError: Voyage embeddings 429 "You have not yet added your payment method in the
billing page and will have reduced rate limits"`. The Voyage account is on the unpaid tier;
   this backfill hits the reduced limit daily, fails, and re-fires tomorrow (~7 slot-min/day
   for nothing). Every other Voyage caller (`reddit-intel-embed` 2 failures, `feed-items-embed`,
   `scam-report-embed`) shares that ceiling. **Founder decision: add a payment method, or park
   the backfill cron until one exists.**
2. **The #1069 cancellation class is open in the data pipeline.** `pipeline-staleness-check-ips`
   was **cancelled on 7 of 7 runs** (4 m finish, p50 271 s) — IP staleness has not completed in
   a week, so `is_active` gating on IP entities is stale (the `retiring-a-feed-can-break-is-active`
   failure shape). Also `pipeline-staleness-check` 6/10, `feed-items-embed` 12/48,
   `pipeline-enrichment-fanout` 8/18 (p50 **15 min**). Cancelled runs do not retry, error, or
   log; the finish budgets were made "honest" in #1135–#1139 but the work still exceeds them.
   Bound the work (chunk + short-batch exit), then derive the budget — the
   `mutually-unsatisfiable-constants` rule.
3. **`clone-watch-auto-triage`** runs daily (7/7 Completed, ~220 s) and has never logged a cost
   row: the retrieve lane stamps `tp_actioned` before its 13:00 run, so its eligibility gate
   never matches. Its only platform-facing job (feed `scam_entities`) moves to #1151.

### The `:00` pileup, measured

`0 */4`, `0 */6`, `0 */8`, `0 */12`, `0 3`, `0 4`, `0 6`, `0 9`, `0 13` — thirteen crons still
fire on the hour. The no-op runs above show p50 elapsed of 130–250 s for functions that do
one query and return: that is queue wait. #1069 moved some crons off `:00`; the rest should
follow, and a flag/brake/worklist check that runs **before** the first `step.run` costs no
slot at all.

## Per-function table

Sorted by slot-min/wk. Verdicts: **KEEP** · **FIX** (broken) · **BATCH** (fan-out → one run)
· **ADD-SKIP** (check for nothing-to-do before the first step; de-`:00`; lower cadence)
· **PARK** (dark flag / mothballed: make event-only like the four precedents) · **RETIRE?**
(founder call). DORMANT = event-driven, no events in the window (costs nothing).
MONTHLY = outside the window.

| fn                                      | feature                      | cron                                 | runs/d        | p50 s | p95 s | slot-min/wk | no-op runs | status                    | verdict               | why                                                                                                                                        |
| --------------------------------------- | ---------------------------- | ------------------------------------ | ------------- | ----- | ----- | ----------- | ---------- | ------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| shopfront-clone-haiku-preclassify       | clone-watch                  | event                                | 25.6          | 109   | 301   | 381.7       | 0/179      | Completed:179             | **BATCH**             | one run per alert (~30/day, 2 steps each) — fold into one batch run per ingest; biggest single slot consumer (#1074)                       |
| pipeline-enrichment-fanout              | data-pipeline                | 0 _/12 _ \* \*                       | 2.6           | 891   | 1044  | 255.2       | 0/18       | Completed:10,Cancelled:8  | **FIX**               | 44% cancelled at 13m finish; p50 15 min — bound the work, then the budget                                                                  |
| feed-items-embed                        | news-intel                   | 0 _/4 _ \* \*                        | 6.9           | 241   | 617   | 226.0       | 32/48      | Completed:36,Cancelled:12 | **FIX**               | 25% cancelled at 4m; 2/3 of runs are no-op — check unembedded count before first step; 6×/day is over-frequent for a mostly-empty worklist |
| reddit-intel-daily                      | reddit-intel                 | event                                | 4.0           | 332   | 498   | 158.5       | 0/28       | Completed:28              | **KEEP**              |                                                                                                                                            |
| feedback-triage-refresh                 | news-intel                   | 50 \* \* \* \*                       | 24.0          | 38    | 73    | 148.8       | 168/168    | Completed:168             | **ADD-SKIP**          | hourly, 168/168 no_new_feedback — trigger on feedback insert or drop to 4×/day; ~150 slot-min/wk for nothing                               |
| shopfront-clone-lifecycle-recheck       | clone-watch                  | 30 _/6 _ \* \*                       | 4.1           | 245   | 292   | 117.2       | 0/29       | Completed:29              | **KEEP**              | fixed in #1142                                                                                                                             |
| shopfront-clone-urlscan-retrieve        | clone-watch                  | 10 _/3 _ \* \*                       | 8.1           | 113   | 207   | 112.7       | 5/57       | Completed:57              | **KEEP**              |                                                                                                                                            |
| shopfront-clone-netcraft-reconcile      | clone-watch                  | 0 10 \* \* \*                        | 0 22 \* \* \* | 2.0   | 429   | 585         | 102.5      | 0/14                      | Completed:14          | **KEEP**                                                                                                                                   |                                                                                                       |
| acnc-charity-backfill-embed             | charity-check                | 0 4 \* \* \*                         | 2.0           | 416   | 580   | 97.3        | 0/14       | Failed:14                 | **FIX**               | 7/7 Failed: Voyage 429 unpaid tier — founder: add Voyage payment method or park the cron                                                   |
| competitor-intel-extract                | arthurs-watch                | 0 _/6 _ \* \*                        | 4.0           | 199   | 317   | 91.6        | 24/28      | Completed:28              | **ADD-SKIP**          | 24/28 no-op at p50 199s — cheap count before setup; on the :00 pileup                                                                      |
| pipeline-entity-enrichment              | data-pipeline                | 0 _/8 _ \* \*                        | 3.0           | 242   | 403   | 91.3        | 21/21      | Completed:21              | **ADD-SKIP**          | 21/21 no-op at p50 242s — gate before first step; on the :00 pileup                                                                        |
| reddit-intel-embed                      | reddit-intel                 | 25 2,8,14,20 \* \* \*                | ...           | 8.1   | 60    | 360         | 89.2       | 27/57                     | Completed:55,Failed:2 | **ADD-SKIP**                                                                                                                               | same shape as cluster: 28 cron runs, 27 no-op                                                         |
| reddit-intel-cluster                    | reddit-intel                 | 45 2,8,14,20 \* \* \*                | ...           | 11.9  | 40    | 111         | 65.4       | 55/83                     | Completed:83          | **ADD-SKIP**                                                                                                                               | cron half is 28 runs mostly no-op alongside the event-driven half — one safety-net cron/day is enough |
| pipeline-staleness-check-ips            | data-pipeline                | 10 3 \* \* \*                        | 2.0           | 271   | 330   | 64.2        | 0/14       | Cancelled:14              | **FIX**               | 7/7 CANCELLED at 4m finish (p50 271s) — IP staleness has not completed in a week; is_active gating is stale                                |
| pipeline-risk-scorer                    | data-pipeline                | 0 _/12 _ \* \*                       | 2.0           | 232   | 311   | 51.4        | 13/14      | Completed:14              | **ADD-SKIP**          | 13/14 no-op at p50 232s; on the :00 pileup                                                                                                 |
| phone-footprint-refresh-claimer         | phone-footprint (MOTHBALLED) | event                                | 4.0           | 87    | 221   | 51.2        | 28/28      | Completed:28              | **PARK**              | mothballed feature; 28/28 "FF_VONAGE_ENABLED disabled" — make event-only like the four already parked                                      |
| pipeline-urlscan-enrichment             | data-pipeline                | 30 _/8 _ \* \*                       | 3.0           | 132   | 184   | 44.4        | 21/21      | Completed:21              | **ADD-SKIP**          | 21/21 no-op at p50 132s                                                                                                                    |
| pipeline-staleness-check                | data-pipeline                | 0 3 \* \* \*                         | 1.4           | 269   | 300   | 41.8        | 0/10       | Cancelled:6,Completed:4   | **FIX**               | 6/10 cancelled at 4m finish (p50 269s)                                                                                                     |
| shopfront-clone-netcraft-issue          | clone-watch                  | 0 11 \* \* \*                        | 1.4           | 217   | 507   | 39.0        | 5/10       | Completed:10              | **KEEP**              |                                                                                                                                            |
| shopfront-clone-urlscan-submit          | clone-watch                  | 0 9 \* \* \*                         | 1.1           | 290   | 479   | 38.0        | 0/8        | Completed:8               | **KEEP**              | fixed in #1142; move off :00 (09:00 pileup)                                                                                                |
| shopfront-clone-netcraft-auto           | clone-watch                  | 0 13 \* \* \*                        | 1.0           | 288   | 557   | 36.3        | 6/7        | Completed:7               | **KEEP**              | 6/7 no_candidates is the DESIGNED v284 steady state                                                                                        |
| cost-telemetry-retention                | ops                          | 0 4 \* \* \*                         | 1.0           | 246   | 390   | 30.4        | 0/7        | Completed:7               | **KEEP**              |                                                                                                                                            |
| shopfront-clone-enforcement-execute     | clone-watch                  | 15 _/3 _ \* \*                       | 8.0           | 26    | 69    | 29.5        | 56/56      | Completed:56              | **PARK**              | 8×/day, 56/56 "FF_CLONE_ENFORCEMENT disabled" — event-only until the flag is on                                                            |
| clone-watch-auto-triage                 | clone-watch                  | 0 13 \* \* \*                        | 1.0           | 220   | 313   | 26.5        | 0/7        | Completed:7               | **RETIRE?**           | runs daily, has never logged a cost row — pre-empted by the retrieve lane; its bridge role moves to #1151                                  |
| billing-ingest-nightly                  | billing                      | 0 2 \* \* \*                         | 1.0           | 198   | 310   | 25.0        | 0/7        | Completed:7               | **KEEP**              |                                                                                                                                            |
| shopfront-nrd-daily-ingest              | clone-watch                  | 30 8 \* \* \*                        | 1.0           | 182   | 223   | 21.8        | 0/7        | Completed:7               | **KEEP**              |                                                                                                                                            |
| clone-watch-enrich-attribution          | clone-watch                  | 30 13 \* \* \*                       | 1.0           | 155   | 291   | 21.0        | 0/7        | Completed:7               | **KEEP**              |                                                                                                                                            |
| known-brands-discover                   | clone-watch                  | 0 6 \* \* \*                         | 1.0           | 166   | 185   | 19.2        | 7/7        | Completed:7               | **ADD-SKIP**          | 7/7 all_probed at 166s                                                                                                                     |
| scam-reports-backfill-embed             | analyze/embeddings           | 30 5 \* \* \*                        | 1.0           | 148   | 193   | 17.0        | 0/7        | Completed:7               | **KEEP**              |                                                                                                                                            |
| archive-shadows-retention               | ops                          | 0 5 \* \* \*                         | 1.0           | 154   | 213   | 16.8        | 0/7        | Completed:7               | **KEEP**              |                                                                                                                                            |
| shopfront-clone-notify-brand-prepare    | clone-watch                  | 30 9 \* \* \*                        | 1.0           | 134   | 173   | 16.2        | 7/7        | Completed:7               | **ADD-SKIP**          | 7/7 no_unbatched_rows at 134s (14 step sites for nothing)                                                                                  |
| pipeline-cluster-builder                | data-pipeline                | 0 4 \* \* \*                         | 1.0           | 148   | 164   | 14.1        | 7/7        | Completed:7               | **ADD-SKIP**          | 7/7 no-op at 148s                                                                                                                          |
| telco-events-retention                  | ops                          | 30 4 \* \* \*                        | 1.0           | 109   | 126   | 12.8        | 0/7        | Completed:7               | **KEEP**              |                                                                                                                                            |
| phone-footprint-retention               | phone-footprint (MOTHBALLED) | 15 3 \* \* \*                        | 1.0           | 109   | 166   | 12.4        | 0/7        | Completed:7               | **KEEP**              |                                                                                                                                            |
| feed-retention                          | news-intel                   | 30 2 \* \* \*                        | 1.0           | 49    | 133   | 8.3         | 0/7        | Completed:7               | **KEEP**              |                                                                                                                                            |
| reddit-processed-posts-retention        | reddit-intel                 | 45 3 \* \* \*                        | 1.0           | 69    | 97    | 8.1         | 0/7        | Completed:7               | **KEEP**              |                                                                                                                                            |
| reddit-brands-discover                  | reddit-intel                 | 0 7 \* \* 1                          | 0.1           | 472   | 472   | 7.9         | 0/1        | Completed:1               | **KEEP**              |                                                                                                                                            |
| shopfront-clone-reemergence-monitor     | clone-watch                  | 45 6 \* \* \*                        | 1.0           | 40    | 84    | 5.7         | 7/7        | Completed:7               | **PARK**              | 7/7 flag disabled                                                                                                                          |
| pipeline-staleness-check-wallets        | data-pipeline                | 20 3 \* \* \*                        | 1.0           | 48    | 62    | 5.7         | 0/7        | Completed:7               | **KEEP**              |                                                                                                                                            |
| brand-register-refresh                  | clone-watch                  | 30 3 \* \* \*                        | 1.0           | 38    | 62    | 5.0         | 7/7        | Completed:7               | **PARK**              | 7/7 flag_off                                                                                                                               |
| feed-sync-verified-scams                | news-intel                   | 0 7 \* \* 0                          | 0.1           | 163   | 163   | 2.7         | 0/1        | Completed:1               | **KEEP**              |                                                                                                                                            |
| feed-sync-user-reports                  | news-intel                   | 0 7 \* \* 0                          | 0.1           | 163   | 163   | 2.7         | 0/1        | Completed:1               | **KEEP**              |                                                                                                                                            |
| scam-report-embed                       | analyze/embeddings           | event                                | 0.1           | 155   | 155   | 2.6         | 0/1        | Completed:1               | **KEEP**              |                                                                                                                                            |
| shopfront-clone-notify-weaponised       | clone-watch                  | event                                | 0.6           | 37    | 38    | 2.0         | 0/4        | Completed:4               | **KEEP**              |                                                                                                                                            |
| analyze-completed-report                | analyze                      | event                                | 0.3           | 76    | 76    | 1.5         | 0/2        | Completed:2               | **KEEP**              |                                                                                                                                            |
| on-demand-url-enrich                    | analyze                      | event                                | 0.3           | 61    | 61    | 1.2         | 1/2        | Completed:2               | **KEEP**              |                                                                                                                                            |
| shopfront-clone-enforcement-plan        | clone-watch                  | event                                | 0.6           | 15    | 16    | 0.8         | 4/4        | Completed:4               | **KEEP**              |                                                                                                                                            |
| analyze-completed-brand                 | analyze                      | event                                | 0.3           | 32    | 32    | 0.7         | 0/2        | Completed:2               | **KEEP**              |                                                                                                                                            |
| analyze-completed-cost                  | analyze                      | event                                | 0.3           | 32    | 32    | 0.7         | 0/2        | Completed:2               | **KEEP**              |                                                                                                                                            |
| shopfront-clone-weekly-digest           | clone-watch                  | 0 10 \* \* 0                         | 0.1           | 36    | 36    | 0.6         | 1/1        | Completed:1               | **PARK**              | flag disabled                                                                                                                              |
| shopfront-clone-fp-cluster-digest       | clone-watch                  | 30 9 \* \* 0                         | 0.1           | 32    | 32    | 0.5         | 0/1        | Completed:1               | **KEEP**              |                                                                                                                                            |
| clone-watch-internal-digest             | clone-watch                  | 0 10 1 \* \*                         | 0             | –     | –     | 0           | –          | no runs in 7d             | MONTHLY               |                                                                                                                                            |
| shopfront-clone-notify-brand            | clone-watch                  | event:                               | 0             | –     | –     | 0           | –          | no runs in 7d             | DORMANT               |                                                                                                                                            |
| clone-watch-report-summary              | clone-watch                  | 0 11 1 \* \*                         | 0             | –     | –     | 0           | –          | no runs in 7d             | MONTHLY               |                                                                                                                                            |
| shopfront-clone-submit-netcraft         | clone-watch                  | event:                               | 0             | –     | –     | 0           | –          | no runs in 7d             | DORMANT               |                                                                                                                                            |
| shopfront-clone-urlscan-scan-one        | clone-watch                  | event:                               | 0             | –     | –     | 0           | –          | no runs in 7d             | DORMANT               |                                                                                                                                            |
| monthly-intel-blog                      | blog                         | 0 20 2 \* \*                         | 0             | –     | –     | 0           | –          | no runs in 7d             | MONTHLY               |                                                                                                                                            |
| report-onward-acma-email-spam           | onward-reporting             | event: report.onward.acma_email_spam | 0             | –     | –     | 0           | –          | no runs in 7d             | DORMANT               |                                                                                                                                            |
| report-onward-apwg                      | onward-reporting             | event: report.onward.apwg            | 0             | –     | –     | 0           | –          | no runs in 7d             | DORMANT               |                                                                                                                                            |
| report-onward-auto-report               | onward-reporting             | (parked — event-only)                | 0             | –     | –     | 0           | –          | no runs in 7d             | DORMANT               |                                                                                                                                            |
| report-onward-brand-abuse               | onward-reporting             | event: report.onward.brand_abuse     | 0             | –     | –     | 0           | –          | no runs in 7d             | DORMANT               |                                                                                                                                            |
| report-onward-openphish                 | onward-reporting             | event: report.onward.openphish       | 0             | –     | –     | 0           | –          | no runs in 7d             | DORMANT               |                                                                                                                                            |
| report-onward-markers                   | onward-reporting             | event:                               | 0             | –     | –     | 0           | –          | no runs in 7d             | DORMANT               |                                                                                                                                            |
| phone-footprint-pdf-render              | phone-footprint (MOTHBALLED) | event:                               | 0             | –     | –     | 0           | –          | no runs in 7d             | DORMANT               |                                                                                                                                            |
| phone-footprint-refresh-monitor         | phone-footprint (MOTHBALLED) | event:                               | 0             | –     | –     | 0           | –          | no runs in 7d             | DORMANT               |                                                                                                                                            |
| phone-footprint-vonage-backfill-pager   | phone-footprint (MOTHBALLED) | event:                               | 0             | –     | –     | 0           | –          | no runs in 7d             | DORMANT               |                                                                                                                                            |
| phone-footprint-vonage-backfill-monitor | phone-footprint (MOTHBALLED) | event:                               | 0             | –     | –     | 0           | –          | no runs in 7d             | DORMANT               |                                                                                                                                            |
| regulator-alert-push                    | push-alerts                  | (parked — event-only)                | 0             | –     | –     | 0           | –          | no runs in 7d             | DORMANT               |                                                                                                                                            |
| report-brand-stewardship                | brand-stewardship            | 0 9 1 \* \*                          | 0             | –     | –     | 0           | –          | no runs in 7d             | MONTHLY               |                                                                                                                                            |
| enrich-vulnerability-au-context         | vuln-intel                   | event: vulnerability.created         | 0             | –     | –     | 0           | –          | no runs in 7d             | DORMANT               |                                                                                                                                            |
| enrich-vulnerabilities-cron             | vuln-intel                   | (parked — event-only)                | 0             | –     | –     | 0           | –          | no runs in 7d             | DORMANT               |                                                                                                                                            |
| match-b2b-exposure                      | vuln-intel                   | event:                               | 0             | –     | –     | 0           | –          | no runs in 7d             | DORMANT               |                                                                                                                                            |
| scam-alert-push                         | push-alerts                  | (parked — event-only)                | 0             | –     | –     | 0           | –          | no runs in 7d             | DORMANT               |                                                                                                                                            |
| shop-signal-enrich                      | shop-signal                  | event:                               | 0             | –     | –     | 0           | –          | no runs in 7d             | DORMANT               |                                                                                                                                            |

## Proposed retire / park / skip list for #1152

> **Status 2026-09-24 (PR `inngest/park-dark-crons-and-fold-brakes`):** the five **Park**
> functions below are now event-only, each with an "At launch, restore `{ cron: … }`" note in
> its trigger comment (the phone claimer gained a manual event and will restore as a plain UTC
> cron — the `TZ=Australia/Sydney` form would have drifted onto 13:00 UTC at the 2026-10-04 DST
> change). `feedback-triage-refresh` went hourly → `50 */6 * * *`. Single-query brake steps were
> folded: the three `reddit-intel-*` `check-cost-brake` steps became un-stepped reads, and
> `clone-watch-enrich-attribution`'s `check-brake` rides inside `select-pending`.
> `pipeline-entity-enrichment`'s reap step folded into `fetch-pending-entities`. ≈ 34 runs/day
> and ≈ 25 steps/day. The preclassify brake fold waits on the batched pre-classifier's first
> verified run. Cadence cuts for the data-pipeline crons and the reddit cron halves are NOT done.

**Park (event-only, one-line change each; flag stays as the revive switch):**
`shopfront-clone-enforcement-execute` (8×/day dark), `shopfront-clone-reemergence-monitor`,
`brand-register-refresh`, `shopfront-clone-weekly-digest`, `phone-footprint-refresh-claimer`
(mothballed). ≈ 100 slot-min/wk, zero product risk — the flag already makes them no-ops.

**Add a no-op exit before the first step + move off `:00`:** `feedback-triage-refresh`
(hourly → event on feedback insert, or 4×/day), `pipeline-entity-enrichment`,
`pipeline-urlscan-enrichment`, `pipeline-risk-scorer`, `pipeline-cluster-builder`,
`competitor-intel-extract`, `known-brands-discover`, `shopfront-clone-notify-brand-prepare`,
and the cron halves of `reddit-intel-cluster` / `reddit-intel-embed` (28 runs/wk each, ~all
no-op beside their event-driven halves — one safety-net run/day). ≈ 650 slot-min/wk.

**Batch:** `shopfront-clone-haiku-preclassify` — 179 runs/wk × 2 steps for ~30 Haiku calls a
day. One batch run per ingest is the #1074 shape. ≈ 380 slot-min/wk.

**Fix (tickets on the map):** Voyage billing / acnc backfill; the four cancelling pipeline crons.

**Retire?** `clone-watch-auto-triage` once #1151 owns the bridge.

**Telegram digests are not Inngest.** `apps/web/vercel.json` carries 21 Vercel crons; the
Telegram surfaces are `cost-daily-check` (4×/day), `cost-weekly-digest`, `feedback-digest`,
`health-digest`, `alerting-canary`, plus three watchers — `pg-stuck-query-watchdog` (every 5 min),
`scraper-brake-alert` and `axiom-fleet-watch` (every 15 min) — ≈ 430 invocations/day between
the three. They cost Vercel invocations, not Inngest slots, so they do not relieve the 5-slot
pool; whether `cost-daily-check` + `health-digest` + `feedback-digest` collapse into one daily
page is a founder taste question for #1152, not an efficiency one.

If all of the above lands, the fleet's trigger→finish time falls from ~2,600 to roughly
**~900 slot-min/wk**, and the 5-slot Hobby pool stops being the binding constraint — which
answers the Inngest Pro fog item on the map: **not needed on this evidence.**
