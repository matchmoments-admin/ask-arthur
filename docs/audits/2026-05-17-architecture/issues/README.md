# Ask Arthur — drafted issues from architecture audit

Drafted 2026-05-17 from the three architecture diagrams (system, schema, ingestion flows). Each file is a complete issue body plus the `gh issue create` command to publish it.

**Status:** drafts only. Not yet on GitHub. User has work in flight in other chats — no branches/PRs/issue-pushes until they say it's safe.

| #   | Severity | Title                                                                           | Action type          | gh command file                          |
| --- | -------- | ------------------------------------------------------------------------------- | -------------------- | ---------------------------------------- |
| 01  | **P1**   | Enable Supabase Auth "Prevent use of leaked passwords" (HIBP)                   | ops · ~30 sec        | `01-p1-hibp-toggle.md`                   |
| 02  | **P2**   | Configure R2 DR bucket + secrets to unblock nightly `pg_dump`                   | ops · ~30 min        | `02-p2-r2-dr-bucket.md`                  |
| 03  | **P2**   | Negotiate Hive AI pricing contract and set `PRICING.HIVE_AI_USD_PER_IMAGE`      | commercial · ops     | `03-p2-hive-ai-pricing.md`               |
| 04  | **P2**   | Capture Facebook-feed HTML fixtures + regression tests for `analyze-ad`         | code                 | `04-p2-extension-fb-regression.md`       |
| 05  | **P3**   | Add `logCost()` to `getSimilarReports` + `getRelevantThemes` (Voyage gap)       | code · 1 PR          | `05-p3-voyage-cost-telemetry-gap.md`     |
| 06  | **P3**   | First quarterly DR drill on 2026-07-01 — author `apps/web/scripts/smoke.ts`     | ops · code           | `06-p3-dr-drill-first-run.md`            |
| 07  | **P3**   | RLS rewrite debt audit on ~10 remaining tables (multi-permissive consolidation) | code · DB            | `07-p3-rls-rewrite-debt.md`              |
| 08  | **P3**   | 177 unused indexes — schedule drop sweep (advisor backlog from 2026-04-23)      | DB · maint window    | `08-p3-unused-indexes-sweep.md`          |
| 09  | **P3**   | Audit `match_b2b_exposure` Inngest function for cost-telemetry coverage         | code · investigation | `09-p3-match-b2b-exposure-cost-audit.md` |

## Label scheme proposed

Each issue uses:

- **Severity label**: `severity:p1`, `severity:p2`, `severity:p3` (create these in repo if not present)
- **Triage label** (existing): `ready-for-agent` (code change, well-scoped) or `ready-for-human` (ops action, judgement call)
- **Domain label** (optional): `domain:auth`, `domain:db`, `domain:dr`, `domain:cost-telemetry`, `domain:extension`, `domain:deepfake`

Create severity labels first (idempotent):

```bash
gh label create severity:p1 --color B91C1C --description "P1 — high (next sprint)" -R matchmoments-admin/ask-arthur 2>/dev/null || true
gh label create severity:p2 --color D97706 --description "P2 — medium (this quarter)" -R matchmoments-admin/ask-arthur 2>/dev/null || true
gh label create severity:p3 --color 6B7280 --description "P3 — low / hygiene" -R matchmoments-admin/ask-arthur 2>/dev/null || true
```

## When ready to publish

Run each issue's `gh issue create` command from its file. They are independent — push them one at a time or in batches.

P0 rules from CLAUDE.md (statement_timeout, Promise.race auth) are **already enacted as code-review rules** in the Critical Rules section and don't need standalone issues — they're enforced by PR #246 (auth wrap) and PR #187 (chunked ACNC). Tracking those as documentation/lint-rule reinforcement would be a separate hygiene PR; not drafted here.
