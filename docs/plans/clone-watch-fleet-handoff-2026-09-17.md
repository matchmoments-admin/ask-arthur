# Clone Watch + Inngest fleet — handoff, 2026-09-17

For the next session(s) working map **#1143** to completion. Read this, then the map, then
claim ONE ticket. The map is canonical; this page is the operational residue that isn't on it.

## Where things stand (all verified against prod, 2026-09-17 ~01:40 UTC)

- **Prod is on `ebaea73a`** (#1157). Merged tonight, in order: #1142 (the two regressions that
  zeroed weaponisations), #1154 (fleet audit asset), #1157 (Netcraft "not yet" is a retry).
- **Clone watch is converting again.** Manual fire 20:55 UTC → 42 first-scans submitted →
  21:10 retrieve classified 40 → **2 weaponised + brand-notified** (`coinbase-account.info`,
  `sendbe.site`), the first since Sep 11. The first _unattended_ recheck (00:33 UTC) did
  50 rechecked / 47 submitted / 3 failed (was 0 / 0 / 50).
- **Netcraft-issue brake cleared**, 7 wrongly-dropped alerts re-deferred (`recheck_after`
  2026-09-18 01:30 UTC). Details: memory note `netcraft-not-yet-is-a-retry`.
- **Map #1060 closed**; #1143 charted with 10 tickets + 2 carried (#1071, #1074) + 2
  graduated from the audit (#1155, #1156). One decision recorded so far (fleet audit, #1146).

## Pending verification — do these BEFORE claiming a build ticket

| When (UTC)     | Check                                                                       | Expect                                                                                                            | Where it goes |
| -------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------- |
| Sep 17 09:00   | `cost_telemetry feature='shopfront_clone_urlscan' operation='submit_batch'` | `submitted > 0`; note the row's `created_at` — if still 09:03+, the `:00` pileup is real and the cron should move | #1144         |
| Sep 17 11:00   | `feature='shopfront_clone_netcraft_issue'` row                              | no autobrake; a "not yet" shows as `notYetDeferred`                                                               | #1148         |
| Sep 18 ≥ 01:30 | the 7 alerts (ids 690, 1876, 1899, 2845, 2931, 3151, 3160)                  | re-enter the reporter; `issue_reported_at` or a fresh deferral, never `post_4xx`                                  | #1148         |
| Sep 18–19      | the full §4a series in `docs/ops/clone-watch-config.md`                     | weekly `weaponised_at` non-zero; `unconverted` 0–2                                                                | **#1144**     |

## Recommended order for the frontier

1. **#1144 Recovery proof** — once 48h of runs exist (Sep 18–19). Unblocks #1153.
2. **#1156 Cancelling pipeline crons** — `staleness-check-ips` cancelled 7/7 for a week;
   `is_active` IP gating is stale _now_. The only open item that is data going wrong silently.
3. **#1151 Platform bridge** — 147 confirmed clones the consumer checker has never seen.
   Founder already decided "weaponised = enough"; build with a retraction path.
4. **#1145 Silent-zero detector** — would have paged both of this week's incidents a week early.
   Include: recheck lane folds 429 into `submit_failed` (split it); brake `set_at` not refreshed
   by the upsert (read `paused_until`).
5. **#1147, #1148, #1150** in any order (independent research).
6. **#1149** (discard the two stale brand emails, trace a fresh weaponisation end-to-end).
7. **#1071, #1074** carried; sequence #1074 after #1152 so batch-folding lands only on survivors.
8. **#1153** after #1144 + #1146 (recheck 6h → 3h) — founder-HITL.

**Founder-only, unblocked now:** #1152 (retire list — table is in
`docs/ops/inngest-fleet-audit-2026-09-16.md`), #1155 (Voyage payment method — a cron fails
daily until then), removing the old LinkedIn posts by hand (#1071).

## How to work here (things the tickets assume you know)

- **Prod SQL:** `pnpm --filter @askarthur/web tsx scripts/_query.ts --sql "…"` (untracked
  session script; Management API; split multi-subquery SELECTs). The Supabase MCP is not
  connected in this repo. `apps/web/scripts/_query.ts` executes writes too — it is not
  read-only despite its header; use it for repairs only via the same RPC the code would call.
- **Prod env:** `vercel env pull --environment=production --yes <scratchpad>/.env.prod`.
  Sensitive vars (`AXIOM_QUERY_TOKEN`, some `FF_*`) pull back EMPTY — absence of a value
  is not evidence the flag is off. Verify by deployed behaviour.
- **Which commit is prod on:** Vercel `get_deployment` → `meta.githubCommitSha`. Tonight's
  root cause was a PR one commit ahead of the local checkout; check before reading code.
- **Manual fires** (event key in `.env.prod`):
  `curl -X POST https://inn.gs/e/$INNGEST_EVENT_KEY -H 'Content-Type: application/json' -d '{"name":"<event>","data":{"source":"…"}}'`
  with `shopfront/clone.{lifecycle-recheck,urlscan-submit,urlscan-retrieve}.manual-trigger.v1`.
  Retrieve has a 10-min min-age on submissions; recheck has a 50-min cooldown; submit is
  throttled 40 runs/day. Firing a weaponisation-producing lane also fires `netcraft-issue`.
- **Run outcomes without Axiom:** `GET api.inngest.com/v1/events?name=inngest/function.{finished,failed,cancelled}&received_after=…&received_before=…`
  (signing key; ~51-row cap → split windows). `data.result` is the function's return value;
  `data.event.ts` is the trigger tick. The 7-day sweep script shape is in the audit doc's Method.
- **Runtime logs** on this Vercel plan retain ~1h. `cost_telemetry.metadata` is the durable
  record — every lane must log outcome counts there.
- **Verification rule** (every defect this week): query prod first, read code second; call the
  RPC to see the worklist, never reason from its WHERE clause; go-red every test by
  reinstating the bug.

## Traps to carry forward

- A worklist stamp/gate/ORDER BY change without a rotation test starves the worklist
  (`worklist-gate-starvation-rule`, third instance this week via a Codex PR whose test pinned
  the bug as correct).
- `spanningBudget` vs `budgetedStep`: a loop inside ONE `step.run` is bounded by the route's
  `maxDuration` and must use the in-step constructor; the spanning one measured from a cron
  tick expires before index 0 on the `:00` pileup.
- Vendor rejects: classify by body, not status; a ratio brake with no denominator floor trips
  on 1/1.
- "Elapsed since trigger" includes queue wait — a 240 s no-op is contention, not work; the fix
  is the check before the first step, not a bigger budget.

## Suggested skills

- `/wayfinder` (work-through mode, map #1143) for every ticket — claim first, one per session.
- `/diagnosing-bugs` for #1156 and anything the recovery proof turns up.
- `/tdd` for #1151 and #1145 (go-red is the acceptance criterion on this map).
- `/data-intensive-design` before touching `scam_entities` in #1151 (write outcome,
  idempotency, retraction).
- `/grilling` for #1152 / #1153 (founder-HITL).

Related memory notes: `honest-zero-telemetry-and-budget-constructor`, `netcraft-not-yet-is-a-retry`,
`worklist-gate-starvation-rule`, `inngest-slot-crunch-cancellations`, `mutually-unsatisfiable-constants`.
