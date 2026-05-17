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

---

## Launch rollout (filed 2026-05-17)

Five consumer-facing surfaces are gated behind feature flags today. Each is a separate launch effort with its own dependency profile; ordered cheap-first/vendor-last to match the same constraint (zero existing-functionality impact, minimum build cost) that governed the audit-issue rollout above.

| Wave | Issue                                                               | Surface                       | Flag                                       | Build cost to flip       | Key gate                                                                                                                       |
| ---- | ------------------------------------------------------------------- | ----------------------------- | ------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| L1   | [#271](https://github.com/matchmoments-admin/ask-arthur/issues/271) | `/scam-feed` + `/scam-map`    | `NEXT_PUBLIC_FF_SCAM_FEED`                 | ~10 min ops + smoke      | None — flip and smoke                                                                                                          |
| L2   | [#272](https://github.com/matchmoments-admin/ask-arthur/issues/272) | `/intel/themes/[slug]`        | `NEXT_PUBLIC_FF_REDDIT_INTEL_PUBLIC_PAGES` | ~30 min (sitemap + flip) | Add dynamic sitemap before flip so crawlers discover                                                                           |
| L3   | [#273](https://github.com/matchmoments-admin/ask-arthur/issues/273) | `/charity-check`              | `NEXT_PUBLIC_FF_CHARITY_CHECK`             | ~45 min ops              | Build HNSW on `acnc_charity_embeddings` via Supabase SQL Editor (10–15 min) before flip                                        |
| L4   | [#274](https://github.com/matchmoments-admin/ask-arthur/issues/274) | `/sim-swap-check` (paid)      | `FF_TELSTRA_SIM_SWAP_ENABLED` + …          | Vendor + legal dependent | Telstra credentials, 4 Stripe SKUs, APP 3.5/3.6 legal review                                                                   |
| L5   | [#275](https://github.com/matchmoments-admin/ask-arthur/issues/275) | `/phone-footprint` (consumer) | `NEXT_PUBLIC_FF_PHONE_FOOTPRINT_CONSUMER`  | Multi-week               | 7 Stripe SKUs · privacy v2 + APP 1.7 (**hard deadline 10 Dec 2026**) · Vonage DPA · `PHONE_FOOTPRINT_PEPPER` · retention crons |

L1–L3 are independent of one another and can ship in any order (or all in the same session). L4 and L5 carry external-dependency tails and start tracking immediately rather than waiting on L1–L3 to land.

### Architecture-diagram chip housekeeping

The chips on the three diagrams in [`../`](../) reflected the audit's point-in-time view of 2026-05-17. Status today:

| Chip                                          | Diagram                  | Status                                                              |
| --------------------------------------------- | ------------------------ | ------------------------------------------------------------------- |
| P3 · 2 retrievers (cost-telemetry gap)        | system + ingestion-flows | **closed** — PR #269 (commit `a29f59d`); issues #264 + #268         |
| Cost-telemetry-gaps panel (CLASSIFY-vs-EMBED) | ingestion-flows          | **closed** — same PR; gap was exactly #264 + #268                   |
| P0 · Promise.race (middleware/auth)           | system                   | enforced via PR #246 + CLAUDE.md Critical Rule; no issue            |
| P0 · never SET timeout=0                      | db-schema (hygiene cell) | enforced via PR #187 + CLAUDE.md Critical Rule; no issue            |
| P1 · HIBP toggle OFF                          | db-schema (identity)     | tracked as #260; awaiting your Supabase dashboard toggle            |
| P2 · Hive AI pricing pending                  | db-schema (deepfake)     | tracked as #262; awaiting commercial close                          |
| P3 · RLS rewrite                              | db-schema (hygiene cell) | tracked as #266; Wave-3 of the audit-issue rollout                  |
| Three rule cards (long writes / cost / 5min)  | ingestion-flows          | all CLAUDE.md Critical Rules — `Always Do` / `Never Do` enforcement |

Diagrams themselves stay frozen as the 2026-05-17 snapshot per the regeneration story documented in [`../README.md`](../README.md). The next audit copy refreshes the chips.
