# Handoff — clone-watch end-to-end deepening, review and fixes (2026-09-22 → 09-24)

Start here to continue the review and testing. Everything below is merged to
`main` and live in prod unless marked OPEN. Numbers are prod query output with
the time they were taken.

## 1. What shipped (17 PRs, migrations v314–v320, all applied)

| PR           | What                                                                                                                                                             | Migration |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| #1176        | Netcraft per-URL verdict + Netcraft's own clock persisted; calibration instrument unfrozen; registrar-abuse field fix                                            | v314      |
| #1177        | One Attribution reader (`lib/clone-watch/attribution.ts`); Platform Entity projection trigger; SQL threshold defaults 0.4; lifecycle rules load-bearing          | v315      |
| #1178        | First-party threat URLs in the analyze verdict (`packages/scam-engine/src/first-party-url-reputation.ts`)                                                        | —         |
| #1179        | Lane ledger complete: real-id roster, `laneRoster.test.ts` coverage, `enabled()` gates, `brakeState` fail-open/closed, `recordLaneError`                         | —         |
| #1180        | Clone takedowns through `onward_report_log` (ADR-0018 amendment)                                                                                                 | v318      |
| #1181        | Monthly per-brand store frozen once published; stewardship event-chained (ADR-0020 amendment)                                                                    | v319      |
| #1182        | Netcraft report Module; submit-netcraft lane deleted; reconcile batched + unchanged-verdict backoff                                                              | v316      |
| #1183        | DNS precheck before urlscan; recheck stale backoff; retrieve budget fix + 5 ticks/day; feed-platform debounce                                                    | v317      |
| #1184        | `FF_ANALYZE_FIRST_PARTY_URLS` ON in prod (Disk-IO + EXPLAIN + advisors checked)                                                                                  | —         |
| #1185        | "Who is squatting your brand" table on `/clone-report/[token]`                                                                                                   | —         |
| #1186        | Review PR A: health digest fetch windows (no false "absent"), honest squat statuses, public copy ("time to blocklisting"), `.au` CoverageNote everywhere         | —         |
| #1187        | Review PR C: extension url-check + analyze-ad through the first-party module (fixed "high" vs "HIGH" warning bug); stale docs                                    | —         |
| #1188        | Review PR B: projection safe casts, DNS verdicts (`resolvesToHost`), onward send ids + atomic claim, cap fails closed + excludes Netcraft, worklist errors throw | v320      |
| #1189        | Checkout guard: feed rows only + verified first-party signal; `clone_netcraft_auto` kill-switch                                                                  | —         |
| #1190        | Pre-classifier batched; reconcile health absence-only; `dns_skipped` counter                                                                                     | —         |
| #1191, #1192 | Hotfixes: batch size 5, batch timeout 30s (Inngest plan ceilings — the resync had been rejected)                                                                 | —         |

Plans/decisions: `docs/plans/clone-watch-deepening-2026-09-23.md`,
`docs/plans/clone-watch-review-fixes-2026-09-23.md`,
`docs/plans/preclassify-batch-events-2026-09-23.md`; ADR-0018/0020/0025 amendments.

## 2. State at handoff (2026-09-23 21:45 UTC)

- Every lane ran on the new code on 09-23 and wrote its Outcome Row; **0 error
  rows in 30 h**; first-party lookup errors 0.
- First at-volume Jev run (08:30 UTC 09-23): 26/26 `jev-1.13.0`, $0.0012, 0 anthropic.
- DNS precheck: 79 `dns_no_host_precheck` stamps (+3 legacy `dns_nxdomain_precheck`).
- Inngest resync after #1192: `{"message":"Successfully registered","modified":true}`.
- August brand-stewardship batch exists (28 reports / 148 clone brands), statuses
  now honest on the share page — **awaiting founder approval** in /admin/brand-stewardship.

## 3. Verify next (not yet exercised at volume)

1. **Batched pre-classifier, 08:30 UTC 09-24** — expect ~6 batch Outcome Rows and ~25 `classify` rows, all typesafe:
   ```sql
   select operation, count(*), sum(units)::int from cost_telemetry
   where feature='shopfront_clone_preclassify' and created_at > now() - interval '3 hours' group by 1;
   select model_id, count(*) from clone_watch_classifications where classified_at > now() - interval '3 hours' group by 1;
   ```
   Batch rows carry `{alerts, classified, failed, unreached, invalid, mode}`; `failed>0` → that alert's `_error` row names the cause and it is re-fanned next day.
2. **Health digest (daily)** — first nights on `laneFetchPlan()` (two windows), `enabled()` gates, brake-before-absence, reconcile absence-only. It should NOT report report-summary / stewardship / fp-cluster as absent.
3. **09:00 submit** — `dns_skipped` now separate from `submit_failed` in `shopfront_clone_urlscan/submit_batch` metadata.
4. **22:00 reconcile** — `unfetched=0, errors=0`; `uuids` may legitimately be 0.
5. **1 Oct** — first monthly run on the frozen store: `clone-watch-report-summary` writes + freezes September, emits `clone-watch/monthly-store.written.v1`, stewardship prepares from the store. Check the `clone_watch_report_summary/monthly_snapshot` and `brand_stewardship/monthly_prepare` rows.

## 4. OPEN

- **Founder decisions:** approve the 28 August reports; enforcement flags (`FF_CLONE_ENFORCEMENT`, `FF_CLONE_ENFORCE_AUTO_BLOCKLIST`, `FF_ONWARD_APWG` — v318/v320 made the send path safe).
- **`.au` sourcing (#772)** — bank counts remain generic-TLD lower bounds (disclosed everywhere via `CoverageNote`).
- **Registrar coverage** — 59% → climbing ~60/day via enrichment of unscanned rows (35-day window).
- **fp-cluster-digest has no input** — no FP triage since 09-04 while ~868 alerts pend; decide whether auto-parked rows count as FP or retire the lane.
- **`cost-daily-check/route.ts`** still filters the dead feature `shopfront_clone_submit_netcraft` (harmless).
- **Preclassify batch size** is capped at 5 by the Inngest plan; a plan upgrade could raise it (change the named constant; `inngestBatchLimit.test.ts` guards it).

## 5. Traps (cost real time this session)

- **Inngest plan limits are enforced only at SYNC** (batch ≤ 5, timeout ≤ 30 s; one rejected fn fails the WHOLE app sync, one limit reported per attempt). After any Inngest config change: `curl -X PUT https://askarthur.au/api/inngest` and read the body.
- netcraft-auto's manual event is `shopfront/clone.netcraft-auto.producer.manual-trigger.v1` (`.producer.`) — a wrong name is accepted and runs nothing.
- Google Fonts fetch flakes fail Vercel/CI builds: `gh run rerun <id> --failed`, or `vercel redeploy <the HEAD commit's dpl>`.
- Env-only changes need a PR with `[build]` in the commit (Vercel ignore-step).
- Brand-facing labels: a "fallback for old rows" must test _field absent_, not _field unknown_ (the squat-table "Live site" overstatement).
- Prod query tooling: `apps/web/scripts/_query.ts` (read) and `_apply-migration.ts` (untracked, main checkout).
