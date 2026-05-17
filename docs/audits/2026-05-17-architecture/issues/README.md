# Ask Arthur — drafted issues from architecture audit

Drafted 2026-05-17 from the three architecture diagrams (system, schema, ingestion flows). Each draft file contains the complete issue body plus the `gh issue create` command used to publish it.

**Status:** published to GitHub as issues #260–#268 on 2026-05-17. Live tracker is on the issue links below. The draft files are retained for the audit record — edits and conversation should land on the GitHub issues, not the drafts.

| #   | Severity | Issue                                                               | Title                                                                           | Status                         | Notes                                                                                   |
| --- | -------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------- |
| 01  | **P1**   | [#260](https://github.com/matchmoments-admin/ask-arthur/issues/260) | Enable Supabase Auth "Prevent use of leaked passwords" (HIBP)                   | open                           | Ops · ~30 sec dashboard toggle                                                          |
| 02  | **P2**   | [#261](https://github.com/matchmoments-admin/ask-arthur/issues/261) | Configure R2 DR bucket + secrets to unblock nightly `pg_dump`                   | open                           | Ops · ~30 min · blocks #265                                                             |
| 03  | **P2**   | [#262](https://github.com/matchmoments-admin/ask-arthur/issues/262) | Negotiate Hive AI pricing contract and set `PRICING.HIVE_AI_USD_PER_IMAGE`      | open                           | Commercial → ~15 min code                                                               |
| 04  | **P2**   | [#263](https://github.com/matchmoments-admin/ask-arthur/issues/263) | Capture Facebook-feed HTML fixtures + regression tests for `analyze-ad`         | open                           | ~1 day code · deferred until Hive contract closes                                       |
| 05  | **P3**   | [#264](https://github.com/matchmoments-admin/ask-arthur/issues/264) | Add `logCost()` to `getSimilarReports` + `getRelevantThemes` (Voyage gap)       | **closed 2026-05-17**          | Shipped in PR #269 (commit `a29f59d`) bundled with #268                                 |
| 06  | **P3**   | [#265](https://github.com/matchmoments-admin/ask-arthur/issues/265) | First quarterly DR drill on 2026-07-01 — author `apps/web/scripts/smoke.ts`     | open                           | Blocked on #261                                                                         |
| 07  | **P3**   | [#266](https://github.com/matchmoments-admin/ask-arthur/issues/266) | RLS rewrite debt audit on ~10 remaining tables (multi-permissive consolidation) | open                           | ~1 day · Wave-3 candidate                                                               |
| 08  | **P3**   | [#267](https://github.com/matchmoments-admin/ask-arthur/issues/267) | 177 unused indexes — schedule drop sweep (advisor backlog from 2026-04-23)      | open                           | Half day + maintenance window                                                           |
| 09  | **P3**   | [#268](https://github.com/matchmoments-admin/ask-arthur/issues/268) | Audit `match_b2b_exposure` Inngest function for cost-telemetry coverage         | **closed 2026-05-17** as no-op | Function is pure DB / in-process semver; no LLM or paid-API calls. Confirmed in PR #269 |

## Rollout plan in flight

Per the constraint-driven plan (zero existing-functionality impact, minimum build cost), execution order is:

| Wave    | Issues      | When                         | Status                 |
| ------- | ----------- | ---------------------------- | ---------------------- |
| 1       | #260        | today                        | open (awaiting toggle) |
| 2       | #264 + #268 | 2026-05-17                   | **shipped** in PR #269 |
| 3       | #266        | this week                    | open                   |
| 4a/4b   | #261 → #265 | next ops slot (target 07-01) | open                   |
| 5       | #262        | after Hive contract closes   | open                   |
| Backlog | #263, #267  | gated per above              | open                   |

## Label scheme (now live in repo)

Each issue uses:

- **Severity label**: `severity:p1`, `severity:p2`, `severity:p3`
- **Triage label**: `ready-for-agent` (code change, well-scoped) or `ready-for-human` (ops action, judgement call)
- **Domain label** (where applicable): `domain:auth`, `domain:db`, `domain:dr`, `domain:cost-telemetry`, `domain:extension`, `domain:deepfake`
- **Topic label** (where applicable): `security`, `ops`, `testing`

All twelve labels were created on 2026-05-17 via `gh label create` against `matchmoments-admin/ask-arthur`.

## What was intentionally NOT filed

P0 rules from CLAUDE.md (`statement_timeout`, `Promise.race` auth) are already enacted as code-review rules in the Critical Rules section. Enforced in PR #246 (auth wrap) and PR #187 (chunked ACNC). Documenting them as lint-rule reinforcement would be a separate hygiene PR; not drafted here.
