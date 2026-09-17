# Clone Watch + fleet — review handoff for the 2026-09-17 fixes

For whoever reviews (or continues) the work done on map **#1143** in the 2026-09-17 session.
Sequel to `clone-watch-fleet-handoff-2026-09-17.md` (PR #1158, the pre-session state). Everything
below was queried on prod, not inferred from code; where a claim is about prod state the query and
time are given so it can be re-run.

## What shipped (in merge order)

| PR    | Ticket          | State                      | Migration      | One-line                                                                                                                                                     |
| ----- | --------------- | -------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #1159 | #1156           | merged 04:39 UTC           | v308 (applied) | Batched, index-driven staleness RPCs + one Staleness Sweep module; enrichment fan-out 21 → 2 boundaries; embed 4 → 2; crons off the 03–04 UTC scraper window |
| #1161 | #1156 follow-up | merged 06:05 UTC           | v310 (applied) | The in-body `SET LOCAL statement_timeout` was decorative; moved to the function-level clause                                                                 |
| #1160 | #1151           | merged 06:12 UTC           | v309 (applied) | Platform Entity bridge: weaponised clones → `scam_entities` + `scam_urls`, retraction, worklist consumer; 149 backfilled                                     |
| #1163 | #1145           | **open, green**            | —              | Silent-zero detector as Check 4 of `health-digest`                                                                                                           |
| #1164 | #1144           | **open, green**            | —              | Saved query set for the recovery proof (interim posted; final Sep 18–19). Block 1b refined 18:40 UTC — see §4                                                |
| #1166 | #1145 follow-up | **open, stacked on #1163** | —              | Every roster lane writes one outcome row per run — without it the detector's `absent` pages on ~half of quiet days (§3)                                      |

New tickets: **#1162** (six more functions with the decorative timeout form). Map #1143 has two new
decision lines and two fog items resolved; one new fog item (the web checker reads no local threat table).

## How to review each fix — what to try to break

### 1. Staleness sweeps (#1159 + #1161)

The two-part story matters: #1159 fixed the query plans and the contention; the first real run then
died for a third reason (#1161). A reviewer should hold both in mind.

- **The IP plan.** `EXPLAIN (ANALYZE) SELECT id FROM scam_ips WHERE is_active AND last_seen_in_feed
IS NOT NULL AND last_seen_in_feed < now() - interval '7 days' AND confidence_level NOT IN
('high','confirmed') ORDER BY last_seen_in_feed LIMIT 5000` must show `Index Scan using
idx_scam_ips_staleness`. With `ORDER BY id` it was a full pkey walk (34.5 s warm, 1,130,781 rows
  removed by filter). Measured 04:20 UTC: 1.0 s idle, 10.4 s during the bulk-mirror landing.
- **The collision.** `SELECT to_char(last_seen_in_feed,'MM-DD HH24') h, count(*) FROM scam_urls
WHERE last_seen_in_feed > now() - interval '3 days' GROUP BY 1 ORDER BY 1` — the 03–04 UTC hour
  carries 84K–136K rows. That is the tier-12h GHA tick (00:00) landing 1–4 h late. The staleness
  crons now sit at 05:40 / 05:50 / 06:05; if the mirror ever lands later than 05:30 the collision
  returns — the sweep would then take longer but each batch commits on its own, so it degrades
  to "drains over two ticks", not to "rolls back".
- **The timeout (the surprising one).** Run the probe yourself before trusting the sentence:
  create a SECURITY DEFINER fn whose body is `SET LOCAL statement_timeout='60s'; PERFORM
pg_sleep(12)`, call it through PostgREST with the service key (NOT through `_query.ts`, which is
  the `postgres` role and has no cap) → `57014` at 8 s. Same fn with the clause `SET
statement_timeout='60s'` on the CREATE → completes. `pg_proc.proconfig` for the three
  `mark_stale_*` functions now shows `statement_timeout=90s`. Drop the probe afterwards.
- **The module.** `packages/scam-engine/src/inngest/staleness-sweep.ts`: the budget is checked
  BEFORE each batch; the loop never throws for out-of-time (`drained:false` instead). Go-red:
  move the `expired()` check after `runBatch` → 2 tests fail. Each cron file keeps its own
  `STALENESS_WALL_CLOCK_MS` literal beside `createFunction` and declares
  `inngest-finish-budget: 1 boundaries` — the finish-floor and max-duration guards read those.
- **What is NOT yet proven:** the IP sweep completing on v310. It ran once on v308 (05:50, died at
  9 s ×4 → cancelled) and has not run on v310. The RPC is a 2 s no-op right now (`stale_pending 0`),
  so a manual call proves nothing. **The proof is the Sep 18 05:50 run**: `inngest-runs.sh
"pipeline-staleness-check" 2026-09-18T05:35:00Z 2026-09-18T06:10:00Z` → all three `finished` with
  a non-null `result` and no `cancelled`.
- **enrichment-fanout:** finish 13 m → 5 m by the floor formula (2 × 30 + 150 + 60 = 270 s). A
  domain whose write throws is stamped `failed` (worklist-gate-starvation-rule) — check
  `SELECT count(*) FROM scam_urls WHERE enrichment_status='failed' AND enrichment_attempted_at >
'2026-09-17'` stays small; a spike means the lookups themselves started throwing.
- **feed-items-embed:** cost row now bound to the step that spent it. If a run is cut off
  (`cutOff > 0` in the return), unwritten rows re-select next tick (`embedding IS NULL`).

### 2. Platform bridge (#1160)

- **The premise correction is the thing to check, not the code.** `apps/web/app/api/extension/
url-check/route.ts:69-95` reads `scam_urls` by `normalized_url`; `packages/scam-engine/src/
safebrowsing.ts:216` (`checkURLReputation`) is GSB + VirusTotal only; `analyze-core.ts` calls
  nothing local. If you find a local-table read on the analyze verdict path, the map's new fog item
  is wrong and the bridge should be re-scoped.
- **Prod state after the backfill (06:18 UTC):** `SELECT count(*) FROM
list_clone_alerts_pending_platform_entity(500)` → 0; `submitted_to ? 'platform_entity'` → 149;
  `scam_entities` with `'clone_watch' = ANY(feed_sources)` → 149 domain + 73 ip; `scam_urls
feed_sources @> '{clone_watch}'` → 149, all `is_active`, `confidence_level='high'`.
- **Things a reviewer might reasonably push back on:**
  - `confidence_level='high'` on the URL row (all 503K feed rows are `low`). Rationale in v309's
    header: it is the "HIGH_RISK from Claude" bar and what exempts the row from the 7-day sweep.
    If you disagree, the alternative is `staleness_exempt` on the `clone_watch` feed row — but
    that exempts by SOLE source and would not survive a second feed touching the row.
  - `report_count` untouched and `legal_basis` left at `public_interest_research_unverified`.
    Deliberate: a machine observation is not a report and is not human-verified.
  - Retraction deletes the entity row only when `clone_watch` is its sole source AND no
    `report_entity_links` row points at it. Go-red for the worklist: add
    `if (row.triage_status !== null) continue;` to the consumer loop → the tp_actioned test fails.
  - The consumer never reads `event.data` (the #1107 cron-payload trap). Its trigger is a wake-up.
- **Induced spend to watch:** 73 new IP entities enter `pipeline-entity-enrichment` (30/run,
  AbuseIPDB free tier) over the next ~3 runs. `cost_telemetry WHERE feature LIKE '%entity%' AND
created_at > '2026-09-17'`.
- **Manual reverse:** `SELECT retract_clone_platform_entity(<alert_id>)`. Documented in
  `docs/ops/clone-watch-config.md` → "Platform Entity bridge".

### 3. Silent-zero detector (#1163, open)

- `apps/web/lib/laneHealth.ts` `LANE_SHAPES` is the roster. The digest fetches by roster feature
  list over 72 h (limit 1000 — PostgREST's hard cap, `rowCap.test.ts` caught the original 2000)
  and a lane with no row is `absent`. Try: remove a lane's rows from the fixture → it must page.
- The two incident rows are the fixtures (`units 75 / submitted 0 / rate_limited 0`;
  `pool 200 / rechecked 0 / submit_failed 50`). Three go-red cases are in the test header.
- Ran against prod at 06:40 UTC: 149 rows, 9 lanes, one finding — `netcraft-issue: braked`
  from the Sep 16 autobrake row. **Today's 11:00 UTC `issue_report` row should carry
  `braked:false`** (#1157 merged 01:40); if it still says `braked:true`, that is #1148's problem,
  not the detector's.
- **The review found a hole in `absent` (fixed in #1166, stacked on #1163 — merge both before
  trusting Check 4).** `absent` assumes one row per run, but every daily roster lane had a
  quiet-day early return that wrote NO row: recheck `nothing_due`, submit `no_gated_candidates`
  (when `dormant=0`), issue `nothing_pending` / `daily_cap_reached`, resubmit
  `none_pending_or_cap` / `all_dead` / bulk-submit failure (only the `-error` feature), reconcile
  `groups.length===0`. Prod Sep 4–16: resubmit row-less on 4 of 13 days, issue on 3 of 13 → the
  digest would have paged "not running" on **7 of 13 days** for lanes that ran fine. Confirmed
  live on Sep 17 from the Inngest run record (not inferred): issue 11:00 → `nothing_pending`,
  resubmit 13:00 → `none_pending_or_cap`, neither wrote a row. #1166 adds a `units 0` +
  `metadata.reason` row to each quiet path, awaited in its own `step.run`; every quiet shape was
  checked against the predicates (resubmit `all_dead` pages only if the deferral itself failed —
  which is the v252 starvation; reconcile's quiet row deliberately counts toward `uuids=0 ×3`).
  Skip-paths (flag / brake / cooldown / no DB) still write nothing on purpose.
- **A second nuance the same fix resolves:** `braked` is read from the latest row's metadata, but
  the brake lives in `feature_brakes`. After the operator cleared the Sep 16 brake (01:30 UTC),
  the latest issue row still said `braked:true` — and stays that way until a run writes a row.
  With #1166 the next quiet run writes `braked:false`. Until then it is a stale finding, not a
  detector bug.
- **Tonight's 22:00 UTC row will therefore be wrong in two known ways if #1166 has not deployed:**
  `absent:shopfront-clone-netcraft-resubmit` (last row Sep 16 13:03 → 33h) and
  `braked:shopfront-clone-netcraft-issue` (stale). The first honest read of Check 4 is the 22:00
  run after #1166 is on prod AND each lane has had one run.
- What it cannot see: twelve lanes log no per-run cost row (listed in the module header). That is
  deliberate — a predicate over rows that never exist is a guard that reads as protection. The
  roster lanes now honour "one outcome row per run"; the twelve remain the graduated ticket.
- Telegram stays behind `FF_LEGACY_DIGEST_TELEGRAM`; the delivery-log row carries
  `lanes_checked: 9` either way. First real run: **22:00 UTC** — `SELECT * FROM alert_deliveries
WHERE alerter='health-digest' ORDER BY created_at DESC LIMIT 1` should show it.

### 4. Recovery proof (#1164, open; #1144 stays open until Sep 18–19)

`apps/web/scripts/sql/recovery-proof-1144.sql`, one block per `_query.ts --sql` (the invocation is
`pnpm --filter @askarthur/web exec tsx …` — without `exec` pnpm looks for a script named `tsx`).
Interim (+10 h) is on the ticket. The reviewer question is whether the five blocks answer the
ticket's five questions — block 1b in particular CALLS `list_clone_alerts_for_recheck(200,6,168)`
rather than reading its WHERE.

**Block 1b was refined during review.** As first written it counted every dead-400 row in the
worklist and implied 0; on Sep 17 it read **79**, all stamped Aug 29 – Sep 3 — rows re-presenting
after their 168h window BY DESIGN. The invariant is "a dead row stamped inside 168h is not in the
worklist": `dead_400_restamped_but_present`, which read **0**. The block now reports both and says
so in its comment. Do not read the informational count as a failure on Sep 18–19.

## Time-gated checks still open (UTC)

| When                | Check                                                                  | Expect                                                                                                                                                                                                                               | Where                |
| ------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| ~~Sep 17 09:10~~ ✅ | submit newest row                                                      | **PASSED** — `2026-09-17 09:05:19`, `units 75 / submitted 41 / submit_failed 34 / rate_limited 0`, unattended                                                                                                                        | #1144                |
| ~~Sep 17 11:10~~ ⚠  | issue newest row                                                       | **NO ROW** — the run finished `reason: nothing_pending` (Inngest record, 11:03:48), which writes nothing until #1166. Not a #1148 failure; the 7 un-stamped alerts are deferred to Sep 18 01:30. Re-check after the Sep 18 11:00 run | #1148 / #1145        |
| Sep 17 22:00        | `alert_deliveries` health-digest row                                   | `lanes_checked: 9`; EXPECT a false `absent:…netcraft-resubmit` + stale `braked:…netcraft-issue` unless #1166 deployed first (§3) — the honest read is the next night                                                                 | #1145                |
| Sep 18 11:00–13:30  | `cost_telemetry` rows for the issue (11:00) and resubmit (13:00) lanes | one row each even if quiet, carrying `metadata.reason`, `units 0` — the first unattended proof of #1166                                                                                                                              | #1145                |
| Sep 18 05:40–06:10  | the three staleness runs via `inngest-runs.sh`                         | all `finished`, non-null `result`, `drained:true`; zero `cancelled`                                                                                                                                                                  | #1156 / #1161        |
| Sep 18 ≥ 01:30      | the 7 un-stamped alerts (690, 1876, 1899, 2845, 2931, 3151, 3160)      | re-enter the reporter                                                                                                                                                                                                                | #1148                |
| Sep 18–19           | `recovery-proof-1144.sql` blocks 1–5                                   | weekly `weaponised_at` non-zero, `unconverted` 0–2, mixed recheck split, zero cancelled                                                                                                                                              | **#1144 resolution** |

## Traps from this session (add to the ones in the previous handoff)

- **"Works by hand, dies from Inngest" → check which ROLE each path uses first.** `_query.ts` is
  `postgres` (no statement cap); supabase-js is `authenticator` → 8 s. An RPC's in-body timeout is
  not a timeout. Memory: `in-body-statement-timeout-is-decorative`.
- **A fix's first unattended run is the test, not the manual call.** The IP sweep passed every
  EXPLAIN, the manual drain and the smoke suite, and still died — because none of those went
  through PostgREST.
- **The structured-field error log is what made #1161 diagnosable in the 1-hour Vercel window.**
  `String(error)` on a PostgrestError is `[object Object]`. The `stalenessRpcBatch` adapter exists
  so that lesson lives in one place.
- **A ticket's premise can be wrong about which table a surface reads.** #1151 said `scam_entities`
  reaches the extension; it does not. Read the consumer route before designing the write.
- **PostgREST caps `.limit()` at 1000** and `rowCap.test.ts` enforces it — asking for 2000 is a
  silent truncation, not an error.
- **Rebase with `--autostash`** when the tree carries an unrelated unstaged edit
  (`evals/README.md` is one; it is not part of any of these PRs).

## Frontier after this session (map #1143)

Merge order for the open set: #1164 → #1163 then #1166 (stacked — retarget to `main` and
`rebase --onto` after #1163 squashes; it will NOT auto-retarget) → this handoff.

Unclaimed: #1147 · #1148 · #1149 · #1150 · #1162 (new) · #1071 · #1074; #1152 / #1153 / #1155 are
founder-gated. Suggested next: **#1162** first (six RPCs silently capped at 8 s — `upsert_clone_alerts_batch`
is the NRD ingest write path), then #1148 once the 11:00 and Sep 18 checks are in.

## Prod access reminders

Same as the previous handoff: `_query.ts` for SQL (Management API, `postgres` role — see the trap
above), `vercel env pull --environment=production` for keys, `scratchpad/inngest-runs.sh <fn-substring>
<after> <before>` for run outcomes, `curl -X POST https://inn.gs/e/$INNGEST_EVENT_KEY` for manual
fires (`shopfront/clone.feed-platform.manual-trigger.v1` is the new one; 50/fire).
