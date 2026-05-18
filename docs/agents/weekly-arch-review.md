# Weekly Architecture Review routine

**What:** A read-only deepening review of one module per week, filed as a GitHub issue. Source of truth for the claude.ai/code project prompt — keep this file and the project prompt in sync.

**Cadence:** Weekly. Generated on Sunday UTC.

**Output shape:** One issue per run, labelled `needs-triage` + `architecture-review`. Title format: `Weekly arch review (week N): <module>`. Items are read-only triage input — the human triages and converts any actionable item into a separate `ready-for-agent` issue.

**Reference run:** [#285](https://github.com/matchmoments-admin/ask-arthur/issues/285) (week 20, 2026-05-17 — first run; follow-up plan at [`docs/plans/arch-review-week20-followup.md`](../plans/arch-review-week20-followup.md)).

---

## Module rotation

Weeks cycle through this list. The routine computes the slot deterministically from the ISO week number: `slot = (week_num % 6)`. Using ISO week (not "weeks since N") means the rotation is stable across restarts and missed runs.

| Slot | Module under review                                          |
| ---- | ------------------------------------------------------------ |
| 0    | `packages/scam-engine`                                       |
| 1    | `apps/web/app/api` (route handlers)                          |
| 2    | `apps/web/app` (RSC pages — exclude `api/` subtree)          |
| 3    | `packages/breach-defence`                                    |
| 4    | `pipeline/scrapers`                                          |
| 5    | `packages/bot-core` + `packages/utils` (both, as one review) |

If the chosen path doesn't exist on the current `main`, abort and send a Telegram with the error. Skip a slot only if the module hasn't changed since the previous sweep, and declare the skip in the issue body so reviewers know it wasn't an omission.

**Future slot candidates** _(not in rotation today; add when they earn the leverage)_: `apps/extension` + `apps/mobile`; SQL migrations + RPCs since the last sweep; `packages/types` + `packages/supabase`.

---

## Pre-flight (do these before drafting findings)

1. **Read context:** `CLAUDE.md` ("Critical Rules" + "Always Do" + "Never Do"), `CONTEXT.md`, any `docs/adr/*.md` that touches this week's module. State at the top of the issue: "CONTEXT.md terms: ..., ADRs read: ... (or none applicable)."
2. **Carry-over check:** `gh issue list --label architecture-review --state open` and diff against this run. If a finding recurs from a prior week with no action, prefix with `(carried from week N)` rather than re-writing it fresh.
3. **Backlog cross-reference:** Grep `BACKLOG.md` and `docs/plans/` for each planned finding's keyword. If a match exists, note inline: `Already tracked: BACKLOG.md L42` and de-prioritise (LOW).
4. **Stale-triage sweep:** Close any `architecture-review` + `needs-triage` issue older than 21 days as `wontfix` with comment `Stale — re-surface if still relevant`.
5. **Confirm rotation:** State the slot number and module under review; if skipping, say so and why.

---

## Finding schema

Each finding has:

- **Title** (one line).
- **Effort:** `S` (≤½ day) / `M` (½–2 days) / `L` (>2 days).
- **Severity:** `HIGH` / `MED` / `LOW`.
- **Body:** What's wrong, where (file path + line numbers), what to do, and the deletion-test justification (would the change concentrate complexity or just move it?).
- **Sharpens** _(optional)_: Which CONTEXT.md domain term(s) this clarifies. Omit if pure hygiene — don't write `(none)`.
- **Threat-model check** _(conditional)_: Required if the finding touches auth, session, billing, or PII paths. One line: `Threat-model check: <safe / see SECURITY.md §X>`.
- **Ops-safety check** _(conditional)_: Required if the finding introduces SQL functions, scrapers, or crons. One line: `Ops-safety check: <complies / see CLAUDE.md §Y>`.

---

## Drafting rules

1. **Cap findings at 7.** If you find more, file the top 7 (highest severity × leverage) and add a closing note: `N additional items deferred to week N+1`.
2. **Verify propagation claims.** If a finding says "wrapping X propagates to function Y", run `grep -rn 'function <Y>' <path>` first. If >1 match exists, qualify by import path (e.g. `requireAdmin from lib/auth.ts`, not the one from `lib/adminAuth.ts`).
3. **Concrete file + line numbers, always.** No "consider refactoring the dashboard area" — cite the specific function in the specific file.
4. **Don't propose changes that violate `CLAUDE.md` "Never Do".** (`SET statement_timeout = 0`, vector indexes on hot tables, bare-await `getUser()` in middleware, etc.) If the finding requires such a pattern, redesign it before filing.
5. **Don't act, don't open PRs.** The routine is read-only. The human triages.

---

## Footer (preserve exactly)

```
*Generated <ISO timestamp> by Claude Code Routine "Weekly Architecture Review".
This issue is read-only deepening input — triage and convert any item you want
to act on into a separate `ready-for-agent` issue.*
```

---

## Labels applied

- `needs-triage` (canonical Pocock framework label — see [`triage-labels.md`](./triage-labels.md))
- `architecture-review` (custom — distinguishes routine output from human-filed issues)

Do NOT apply `ready-for-agent` to the routine's own output. Findings become ready for agent work only after a human triages them into a follow-up issue.

---

## Issue body template

```markdown
## Module reviewed

`<path>` — week N of <year>

## Context refreshed

- CONTEXT.md terms: <list>
- ADRs read: <list, or "none applicable">
- Carry-overs from prior weeks: <list issue numbers, or "none">
- Stale-triage sweep: <N issues closed as wontfix, or "0 stale">

## Deepening opportunities (ranked by leverage)

### 1. <Title> · <S|M|L> · <HIGH|MED|LOW>

<body>

**Sharpens:** <domain term> | _omit if pure hygiene_
**Threat-model check:** <line> | _omit if no auth/session/billing/PII touch_
**Ops-safety check:** <line> | _omit if no SQL/scraper/cron_

### 2. ...

---

_Generated <ISO timestamp> by Claude Code Routine "Weekly Architecture Review". This issue is read-only deepening input — triage and convert any item you want to act on into a separate `ready-for-agent` issue._
```

---

## When the routine prompt changes

1. Edit this file first.
2. Open a PR. Reviewers can see the diff against the previous version.
3. After merge, copy-paste the relevant sections into the claude.ai/code project prompt.

This way the routine's behaviour is reviewable, recoverable, and discoverable from the repo.
