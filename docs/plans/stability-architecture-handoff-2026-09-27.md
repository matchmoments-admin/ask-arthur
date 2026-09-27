# Handoff: stability pass + architecture pass (2026-09-27)

Read this before proposing any of the architecture work below again. Every
verdict here was checked against `origin/main` and prod on 2026-09-27.

## The trap that shaped this document

The architecture plan approved that morning said every claim had been
"verified against the tree". The tree it used was the shared main checkout,
which sat on a feature branch **73 commits behind `origin/main`**. Two of its
four PRs were already built. Re-verify any plan in a fresh worktree off
`origin/main`:

```bash
git fetch origin && git worktree add --detach .claude/worktrees/<n> origin/main
```

Line numbers that a plan cites and that no longer match are the fastest tell.

## Stability pass (merged)

| PR    | What                                                                                                  |
| ----- | ----------------------------------------------------------------------------------------------------- |
| #1267 | `pipeline-enrichment-fanout` backlog gauge: `count:"exact"` (7.8 s vs the 8 s cap) → `"planned"`      |
| #1268 | `acnc-charity-backfill-embed` parked (Voyage 429 on 100% of runs); `inngestParkedLanes.test.ts` added |
| #1269 | crt.sh leg deleted; its timeout was adding +8 `no_ct_certificates` risk to every enriched domain      |
| #1272 | Docs: HIBP / Paddle / DR decisions, four drifted claims                                               |
| #1273 | `costBrakeRegistry.test.ts` memoised (5.9 s → 0.8 s), which removed a flaky required check            |

## Architecture pass: what was actually done

| PR    | What                                                                                                                                                                                                                                                                              |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1274 | `feed-items-embed` parked. Its vector's only reader is the B2B intel search, and `api_keys` has 0 rows. Restore when the first key exists.                                                                                                                                        |
| #1275 | FP brand denylist: the SQL copies are drift-tested. The test checks the **latest** CREATE FUNCTION body per function; only 2 live carriers exist, not the 9 migration files that mention the list.                                                                                |
| #1276 | Brake policy per call site. Paid or outbound background Lanes use `isFeatureBrakedOrUnknown` (fail-closed). Fail-open `isFeatureBraked` is allowed only at the user-facing sites listed in `brakeReadPolicy.test.ts`. The last 5 hand-rolled `feature_brakes` reads were deleted. |
| #1277 | `laneRanWithin(sb, lane, ms)`: the Lane cooldowns read the roster feature instead of a hand-typed string.                                                                                                                                                                         |
| v339  | `clone_lifecycle_transitions` plus a log-only trigger, and health-digest check 5 (`lifecycle_off_spec`). **Applied to prod 2026-09-27**, and proven with a rolled-back probe (`2308 detected->monitoring direct_update`).                                                         |

## Verdicts: do not re-propose without new evidence

- **"One brake read, failure policy in the Interface" (old PR B).** Shipped in
  #1179 (`brakeState`). The remaining per-call-site work was #1276.
- **"Lane run envelope + nine blind Lanes" (old PR D).** 7 of the 9 already
  write Outcome Rows and use `laneGate()`. The other 3
  (`notify-weaponised`, `enforcement-plan`, `urlscan-scan-one`) are exempt with
  reasons in `laneRoster.test.ts`. Once #1277 removed the cooldown string, a
  full envelope would have 2 callers and fails the deletion test.
- **`runAnalysisCore` drift ("extension and bot users never see clone-watch").**
  Mostly false.
  - Weaponised clones escalate on every surface, through shared First-party
    URL Reputation (`FF_ANALYZE_FIRST_PARTY_URLS`).
  - The web-only piece is the confirmed-but-not-weaponised citation
    (`FF_ANALYZE_CLONE_CITATION`, on). `clone_citation_shown` has 0 events,
    ever.
  - 30-day traffic: 15 web analyses, 2 bot, 0 extension.
  - `lookupCloneAlert` could move to scam-engine trivially; its dependencies
    are Supabase, `shopfront-glue` and `logCost`.
  - **Revisit only if extension or bot volume grows.**
- **Clone Alert lifecycle ("encoded six times").** Half done.
  - `lifecycle.ts` is the spec, with 2 real importers.
  - `NO_DOWNGRADE_STATES` is SQL-parity tested.
  - The `alert_state` sync is a table CHECK (v288).
  - What was missing was any record of which moves actually happen; v339 adds
    it.
  - **Decide on routing the SQL writers through one transition RPC only after
    about 2 weeks of `lifecycle_off_spec` data.** If it stays empty, the
    spec and the writers agree, and the RPC isn't worth building.
- **Two `logCost` Modules.** Forced by dependency direction: one Interface,
  two Adapters. Not a defect.
- **Not worth doing at all:**
  - the report-card fold/IO split
  - `twilioLookup.ts`-style re-exports
  - `resolve-brand.ts`
  - the small copy/constant Modules
- **Already deep, and the model for the rest:** `step-budget`, `lane-outcome`,
  `laneHealth`, `clone-cohort`.

## Open items

1. **Time-gated checks on the stability fixes, not yet done:**
   - 12:35 UTC: `pipeline-enrichment-fanout` completes and returns
     `backlogEstimate ≈ 252,970`.
   - 13:30 UTC: `clone-watch-enrich-attribution` logs no crt.sh error.
2. **After #1274 deploys:** `PUT /api/inngest` must return `"modified":true`,
   and there must be no `feed-items-embed` run at the next `:20` tick.
3. **CI:** the `ci.yml` step timeout (8 min) kills cold-cache runs. Their
   duration has never been measured, so any new number is a guess. Raise the
   step and job timeouts and say "unmeasured" in the comment.
4. **Founder actions:**
   - Add a Voyage payment method (about $0 at this volume; stops the
     `reddit-intel-embed` timeouts).
   - Set `VERCEL_AUTOMATION_BYPASS_SECRET`; it unblocks the e2e verdict gate
     and any measurement of `FF_RAG_THEMES`.
   - Delete `NEXT_PUBLIC_FF_CT_LOOKUP`, `HIBP_API_KEY` and the 8 `PADDLE_*`
     vars from Vercel.
   - Decide whether Reddit Intel is worth $32 in Anthropic spend with 1
     subscriber, and whether `FF_RAG_THEMES` should stay on before it is
     measured.
5. **Around 2026-10-11:** read two weeks of `lifecycle_off_spec` from the
   health-digest delivery log, or query `clone_lifecycle_transitions`
   directly, then make the lifecycle RPC decision above.

```sql
select from_state, to_state, writer, count(*)
from clone_lifecycle_transitions
group by 1, 2, 3
order by 4 desc;
```
