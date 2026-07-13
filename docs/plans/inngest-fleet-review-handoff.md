# Inngest fleet review — completion handoff (2026-07-13)

The 73-function Inngest operational review (`docs/plans/inngest-fleet-review.md`)
is **complete**: every finding fixed and every A–D decision item implemented,
all merged to `main` and live in production. This is the handoff for the next
session — current state, verified smoke tests, and the follow-ups that remain.

## Everything shipped (all merged + deployed)

| PR   | What                                                             | Verified in prod                                                 |
| ---- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| #717 | P1 reddit-cluster anti-runaway guards + alarm                    | runaway theme contained at 2263 (not growing)                    |
| #718 | onward-skipped ×4 → 1 multi-trigger fn                           | mapping-lock test                                                |
| #719 | phone-footprint reclaim + known-brands header                    | `.or()` reclaim 200-OK on live PostgREST                         |
| #720 | ct-monitor false-claim fix + zero-cert warn                      | —                                                                |
| #721 | verified_scams steady-state embed cron                           | live drain 39→0 (fresh rows re-drain nightly)                    |
| #722 | onward queued-row convergence (mark failed + re-drive)           | enum contract confirmed                                          |
| #723 | enrichment-fanout newest-first + backlog warn                    | 78 urls enriched/24h; backward index scan                        |
| #724 | review record doc                                                | —                                                                |
| #725 | **retire** meta-brp stub + ct-monitor                            | 0 crtsh_monitor rows; both deregistered                          |
| #726 | D2 report_count gate 3→2 (query half)                            | —                                                                |
| #727 | C onward loss/PII micro-question                                 | HTTP: loss+pii=true adds reportcyber+idcare                      |
| #728 | D1 retention-bundling convention (keep separate)                 | —                                                                |
| #729 | C/D status record                                                | —                                                                |
| #730 | **D3** on-demand URL enrich (consumer of analyze.completed.v1)   | **live: checked uplandsum.com → pending→completed w/ WHOIS+SSL** |
| #731 | v225 — D2 schema half (promote-trigger + index + backfill at ≥2) | 6 entities now in the enrichment worklist                        |
| #732 | v226 — harden the trigger's search_path (clears advisor WARN)    | `proconfig: search_path=""`                                      |

**Migrations applied to prod:** v225, v226. No other schema changes.

## Current prod state (verified 2026-07-13)

Site HTTP 200. verified_scams unembedded ≈ 0 (fresh rows drain via the 05:30
cron). urls enriched last-24h = 78. D2 worklist = 6 entities. D3 = working
end-to-end. ct-monitor / meta-brp fully gone. reddit runaway contained.

## Open follow-ups (for the next work)

> **2026-07-13 follow-up session progress** — items 3 + 4 CLOSED, item 1 now
> has a ready-to-run runbook, plus a WHOIS telemetry gap fixed. Status inline below.

1. **P1 reddit historical rebuild (deferred DATA op) — RUNBOOK READY, execution
   still deferred.** #717 stops the 2263-member theme absorbing new posts, but
   those 2263 posts stay mislabeled. The full maintenance-window procedure is now
   written and its read-only queries smoke-tested against prod:
   **[`docs/ops/reddit-intel-theme-rebuild.md`](../ops/reddit-intel-theme-rebuild.md)**
   (snapshot → single-statement reset via FK cascades → serial oldest-first cohort
   replay through the guarded clusterer → inline naming → verify → rollback). The
   clusterer also got a `concurrency: { limit: 1 }` ceiling so the replay can't
   race the theme table. Execution stays deferred to a maintenance window with an
   operator watching (per `supabase/CLAUDE.md` #5). Still confirm over the next ~3
   daily cohorts that NEW themes form (the `single-attractor collapse signature`
   Axiom warn stays silent).

2. **Onward reporting launch (product decision — UNCHANGED).** C (#727) + #722 +
   #718 make the onward flow launch-ready, but the whole feature is gated
   `NEXT_PUBLIC_FF_ONWARD_REPORTING` (OFF) — `onward_report_log` is still empty.
   Launching (flip the flag + surface the picker in `ResultCard`) is the BACKLOG
   "P1 onward-reporting" item. Not an engineering task — left for the product call.

3. **D2 chain validation — ✅ VALIDATED (2026-07-13).** The chain fired end-to-end:
   `cost_telemetry` for `urlscan-enrichment` went **0 → 1** and `twilio-lookup`
   logged a row **the same day**, i.e. the entity→urlscan path ran and paid APIs
   billed. The 6 pending entities drained (now 0 pending, `completed` 11 → 17).
   Note: `entity-enrichment` shows 0 cost rows all-time and that is **expected** —
   `pipeline-entity-enrichment` never calls `logCost` directly; each paid helper
   (twilio/ipqs/abuseipdb/ct/safebrowsing) logs under its **own** feature tag.

4. **Doc hygiene — ✅ DONE (2026-07-13).** `background-workers.md` header fixed
   `38 → 75` and corrected to explain the count is the sum of two registered
   arrays (`inngestFunctions` 29 + `appFunctions` 46), not one file. The
   pre-existing `rls_enabled_no_policy` INFO advisors (analytics_events,
   scam_entities, scam_reports, …) remain on the documented DB-hygiene backlog —
   not introduced here.

5. **WHOIS free-quota telemetry — ✅ SHIPPED (2026-07-13, newly found).** WHOIS
   (`whoisjson.com`, **1,000/month free cap**) is driven by the D2/D3 chain,
   entity-enrichment, and the user-facing persona-check route but logged nothing —
   the cap's consumption was invisible (the same "no cost signal → invisible"
   failure mode as the reddit naming call). `lookupWhois` now emits a
   `feature='whois'` `cost_telemetry` row (units 1, $0) per successful billable
   response. **SSL + HIBP still uninstrumented** — SSL is a free TLS handshake
   (no quota, telemetry would be noise); HIBP is paid but flag-gated and not
   currently firing. Both logged to BACKLOG for a decision, not shipped here.

## Deliberately not done

- **D3 caps at 200 rows/domain/check** (`.limit(200)`) — a checked high-volume
  shared host (google.com = 7,120 pending rows) enriches ≤200 per check by design.
- **ct-monitor/meta-brp are retired, not rebuildable-in-place** — `getCtMonitorConfig`
  (+ 9 tests) kept in `@askarthur/shopfront-glue` as a rebuild kit.

## Where a fresh session should start

Read `docs/plans/inngest-fleet-review.md` (the full review + per-item decision
record) + this handoff. Both are self-contained. The fleet is healthy and within
the 50K/mo step-run budget; the review's operational lessons are codified in the
root `CLAUDE.md` "multi-stage background pipeline" rule.
