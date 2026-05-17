# Arch review (week 20) — follow-up plan

**Source issue:** [#285 — Weekly arch review (week 20): apps/web/app (RSC pages)](https://github.com/matchmoments-admin/ask-arthur/issues/285)
**Routine:** Claude Code Routine "Weekly Architecture Review" (first run, 2026-05-17)
**Goal:** Land the 6 deepening opportunities with zero regression to current behaviour.
**Drafted:** 2026-05-18

---

## What changed vs the previous session's plan

The prior session produced a 6-PR plan (PRs #1–#6, with #5 + #6 split into sub-PRs). It is largely correct. This document keeps that shape but:

1. **Bundles PR #1 (dynamic-route React.cache) into PR #2 (auth/org React.cache).** Both are 1-line `React.cache` wraps at a definition site, both are request-scoped, both ship the same first-time pattern into the codebase. One PR, one review, one rollback boundary.
2. **Corrects the PR #2 propagation claim.** `apps/web/lib/auth.ts:136` exports `requireAdmin`, but **none of the `app/admin/*` pages use it** — they all use a separately-defined `requireAdmin` in `apps/web/lib/adminAuth.ts` (HMAC cookie auth, no Supabase round-trip). So caching `getUser()` only helps `app/app/*` pages, not admin. Adjust the PR description so a reviewer can predict the actual log delta.
3. **Folds a CLAUDE.md compliance check into PR #4** (no `SET statement_timeout = 0`, hot-table awareness — `feedback_triage_queue` is on the hot-tables list).
4. **Defers PR #6c** (the big type-substitution sweep) until after PR #4 ships, so the generated types include the new RPC return shape.

---

## PR queue (re-numbered for clarity)

### PR 1 — `React.cache` hot-path loaders (bundles prior PR #1 + #2)

**Issue items addressed:** #285 item 1 (M, HIGH) + item 2 (S, HIGH)
**Effort:** S (5 wrap sites, ~5 lines + 2 test files)
**Blast radius:** `apps/web/app/intel/themes/[slug]`, `apps/web/app/report/[domain]`, `apps/web/app/scan/result/[token]`, `apps/web/app/app/*` (the 8 confirmed re-callers).

**Edits:**

| File                                           | Function                               | Reason                                                                                                          |
| ---------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `apps/web/lib/auth.ts:39`                      | wrap `getUser()` in `React.cache`      | `app/app/layout.tsx` + each child page calls it → cuts 1 of 2 JWT validations per page-after-layout             |
| `apps/web/lib/org.ts:42`                       | wrap `getOrg(userId)` in `React.cache` | `requireOrg`/`requireOrgRole`/`requireOrgPermission` all dispatch to it → cuts the duplicate `get_user_org` RPC |
| `apps/web/app/intel/themes/[slug]/page.tsx:53` | wrap `loadTheme(slug)`                 | Called from `generateMetadata` (line 100) and default export (line 137)                                         |
| `apps/web/app/report/[domain]/page.tsx:15`     | wrap `getLatestAuditByDomain(domain)`  | Called at lines 49 and 86                                                                                       |
| `apps/web/app/scan/result/[token]/page.tsx:22` | wrap `getScanByToken(token)`           | Called at lines 39 and 63                                                                                       |

**PR description must include:**

- "First use of `React.cache` in this codebase — confirms request-scoped behaviour. Cache is cleared between requests; no cross-request leak risk."
- "Does NOT change `apps/web/lib/adminAuth.ts:requireAdmin` (HMAC cookie path), so admin pages are unchanged."
- "Cached errors re-throw identically — `AuthUnavailableError` and `NEXT_REDIRECT` semantics are preserved."

**Regression risk:** None. `React.cache` stores promises (resolved + rejected) keyed by argument identity per request. `getUser()` takes no args (single result per request) and `getOrg(userId)` is called with the same `user.id` string throughout a request (the layout fetches the user once, child pages receive it via `requireAuth()`/`requireOrg()` which both call `getUser()` first — now deduplicated).

**Validation:**

- `pnpm turbo typecheck`
- Local dev: enable Supabase query logging, navigate `/app`, `/app/team`, `/app/compliance` → expect 1 `getUser` + 1 `get_user_org` per page, not 2 of each.
- Local dev: navigate `/intel/themes/<any-slug>` → expect 1 `loadTheme` Supabase call, not 2.
- Vercel preview: same smoke loop signed in.

**Rollback:** Revert the commit. No DB, no schema, no flag.

---

### PR 2 — `lib/featureGate.ts` helper (prior PR #3)

**Issue item:** #285 item 4 (S, MED)
**Effort:** S (new ~30-line module + ~10 inline-call migrations + test file)
**Blast radius:** Charity Check page, Phone Footprint consumer page, Scam Feed page, Reddit Intel public pages, billing/signup/login redirects.

**New module:** `apps/web/lib/featureGate.ts`

```ts
import "server-only";
import { notFound, redirect } from "next/navigation";
import { featureFlags } from "@askarthur/utils/feature-flags";

export function gateOrNotFound(flag: keyof typeof featureFlags): void {
  if (!featureFlags[flag]) notFound();
}

export function gateOrRedirect(
  flag: keyof typeof featureFlags,
  to: string,
): void {
  if (!featureFlags[flag]) redirect(to);
}
```

**Migration scope:** ~10 page-level `if (!featureFlags.X) notFound()` / `redirect()` call sites identified by the routine. Inline-JSX style (`{featureFlags.X && <Panel />}`) is a different concern (partial render, not route gate) — **do not touch** in this PR.

**Tests:** `apps/web/lib/__tests__/featureGate.test.ts` covers both shapes with env-mocked flag values (off → throws `NEXT_NOT_FOUND` / `NEXT_REDIRECT`; on → no-op).

**Regression risk:** None — pure refactor preserving the existing `notFound()` / `redirect()` semantics on a per-page basis. CI catches any missed call site.

**Validation:** Toggle each touched flag OFF in `.env.local` → confirm 404/redirect on the matching route. `pnpm turbo test --filter=@askarthur/web`.

**Rollback:** Revert.

---

### PR 3 — Move admin/health loaders into `lib/dashboard/admin-health.ts` (prior PR #5a)

**Issue item:** #285 item 3 (M, HIGH) — first slice of 3.
**Effort:** S (mechanical extraction, ~5 functions, +1 test file)
**Blast radius:** `apps/web/app/admin/health/page.tsx` only.

Move `getQueueCounts`, `getOldestPendingMinutes`, `getRecentFeedRuns`, `getArchiveStats`, `getStripeEventStats` from `admin/health/page.tsx:25-91` into `apps/web/lib/dashboard/admin-health.ts`. Page becomes a thin renderer.

**Tests:** Add `__tests__/admin-health.test.ts` covering happy path + `createServiceClient() === null` fallback.

**Regression risk:** None (code motion). Page render output must be byte-identical.

**Validation:** `pnpm turbo build`, `pnpm turbo test`, manual smoke on `/admin/health` (signed-in via HMAC cookie).

**Rollback:** Revert.

---

### PR 4 — `get_feedback_triage_summary` RPC + page refactor (prior PR #4)

**Issue item:** #285 item 6 (M, LOW)
**Effort:** M (new migration + RPC + page rewrite)
**Blast radius:** `apps/web/app/admin/feedback/page.tsx` + new SQL migration.

**Migration:** `supabase/migration-v100-get-feedback-triage-summary.sql`

- Function: `get_feedback_triage_summary(p_filter text, p_limit int) RETURNS jsonb`
- Returns `{rows: jsonb, total: int, counts: {false_positive, false_negative, user_reported}}`.
- **`RETURNS jsonb`** (not `RETURNS TABLE`) — side-steps the OUT-parameter shadowing trap documented in CLAUDE.md under "PL/pgSQL function gotchas (verified bites in prod 2026-05-06)".
- `SET search_path = public, pg_catalog` — established convention.
- `SECURITY INVOKER` (admin role at session level, no escalation needed).
- Idempotent (`CREATE OR REPLACE FUNCTION ...`).

**CLAUDE.md compliance checklist for this PR:**

- No `SET statement_timeout = 0` — function is a read-only aggregation, completes well under default 2-min pooler limit.
- Hot-table awareness — `feedback_triage_queue` is on the hot-tables list, but this RPC is **read-only**, so the chunked-write rule doesn't apply. It does _reduce_ read load by one round-trip.
- Run `packages/scam-engine/src/__tests__/rpcs.smoke.test.ts` against a Supabase preview branch after applying.
- `mcp__supabase__get_advisors` (security + performance) — must not introduce new ERRORs.

**Page refactor:** `apps/web/app/admin/feedback/page.tsx` replaces lines 42-75 (three queries) with one `supabase.rpc("get_feedback_triage_summary", { p_filter: filter, p_limit: 100 })` call. `TriageRow` interface stays (will be replaced in PR 6).

**Regression risk:** Low. Compare row payloads from old 3-query path vs new RPC against a `feedback_triage_queue` snapshot before merging.

**Validation:** Apply migration via `mcp__supabase__apply_migration` on `rquomhcgnodxzkhokwni`. Smoke-test `/admin/feedback?filter=top|false_positive|false_negative|user_reported`. Check `/admin/feedback` load time (currently bottlenecked by the third "full MV scan" query).

**Rollback:** Migration is non-destructive (`CREATE OR REPLACE FUNCTION`). Revert the page change to restore the 3-query path; the function can remain unused or be dropped in a follow-up.

---

### PR 5 — Move scam-feed + scam-map + about loaders into `lib/` (prior PR #5b)

**Issue item:** #285 item 3 — second slice.
**Effort:** M (5 functions, extend existing `lib/feed.ts`, new `lib/dashboard/public-stats.ts`, tests)
**Blast radius:** `apps/web/app/scam-feed/page.tsx`, `apps/web/app/scam-map/page.tsx`, `apps/web/app/about/page.tsx`.

Move `getInitialFeed`, `getPinnedRegulatorAlerts` into `apps/web/lib/feed.ts`. Move `getWorldStats`, `getChartData`, `loadStats` into a new `apps/web/lib/dashboard/public-stats.ts`.

**Tests:** Each new function gets a `__tests__/` companion.

**Regression risk:** None (code motion).

**Validation:** Same as PR 3 — build green, tests green, byte-identical render.

**Rollback:** Revert.

---

### PR 6 — Move remaining dynamic-route + per-page loaders (prior PR #5c)

**Issue item:** #285 item 3 — third slice.
**Effort:** M (~8 functions across 6 pages, tests)
**Blast radius:** `intel/themes/[slug]`, `report/[domain]`, `scan/result/[token]`, plus `getCheckTimeSeries`/`getAlerts`/`getRecentScans`/`getQuarantineRows` from their parent pages.

**Important sequencing note:** PR 1 added `React.cache(loadTheme)` etc. _in the page files_. This PR moves them to `lib/` modules — keep the `React.cache` wrap at the new definition site, don't unwrap and re-wrap at the callsite.

**Validation:** Same as PR 3 + manually verify React.cache wrap still in effect after move (re-run the `/intel/themes/<slug>` 1-call check from PR 1's validation).

**Rollback:** Revert.

---

### PR 7 — Generated Supabase types pipeline + pilot (prior PR #6a)

**Issue item:** #285 item 5 (L, MED) — first slice.
**Effort:** M (new build script + 1 pilot migration)
**Blast radius:** `packages/types/` + 1 file (`apps/web/app/admin/feedback/page.tsx`).

- Add `pnpm --filter @askarthur/types gen:db` script wrapping `supabase gen types typescript --project-id rquomhcgnodxzkhokwni > packages/types/src/db.generated.ts`.
- Re-export `Database`, `Tables<>`, `Enums<>` from `packages/types/src/index.ts`.
- Document regeneration cadence in `docs/system-map/database.md`: "Regenerate after every migration that adds or renames a column on a public table. Commit the generated file (do NOT `.gitignore`)."
- **Pilot migration:** replace the `TriageRow` interface in `admin/feedback/page.tsx:7-29` with `Tables<'feedback_triage_queue'>`. One file. Confirms the round-trip works.

**Why this is staged after PR 4:** PR 4 introduces a new RPC return shape. Regenerating types after PR 4 captures it in the same generation.

**Regression risk:** Medium for the CLI pipeline (CI must see the committed file; pnpm workspace must resolve it). Low for the pilot type swap (`pnpm turbo typecheck` is the gate).

**Validation:** `pnpm --filter @askarthur/types gen:db && git status` shows a single new file. `pnpm turbo typecheck` green. Pilot page renders identical output.

**Rollback:** Delete `db.generated.ts`, revert the pilot file, drop the script. No DB change.

---

### PR 8 — Migrate duplicate row types to `Tables<>` (prior PR #6b)

**Issue item:** #285 item 5 — second slice.
**Effort:** S (4 type-pairs, type-only changes)
**Blast radius:** The duplicate pairs flagged by the routine — `ReviewRow`, `BrandAlert`, `DailyRow`, `MonitorRow`.

**Validation:** `pnpm turbo typecheck` green. Diff each touched file to confirm pure type substitution.

---

### PR 9 — Migrate remaining row types, area-by-area (prior PR #6c)

**Issue item:** #285 item 5 — third slice.
**Effort:** L (50+ types across `admin/`, `intel/`, `marketing/`, `app/`)
**Recommendation:** One sub-PR per area (4 sub-PRs total) so a reviewer can isolate failures.

**Watchpoint:** Local interfaces sometimes narrow nullability (e.g. `string` locally but `string | null` in DB). Those will surface as new type errors and require **real fixes**, not `as` casts — log them as TODOs if you want to defer the fix to a follow-up.

---

## Suggested execution order

```
PR 1 (cache)                 → ship first, smallest, validates the pattern
PR 2 (featureGate helper)    → ship in parallel, independent
PR 3 (admin/health extract)  → ship in parallel, independent
PR 4 (feedback RPC)          → ship after advisors green
PR 5 (scam-feed extract)     → ship in parallel with PR 4
PR 6 (remaining extracts)    → after PR 1 (preserves cache wraps)
PR 7 (types pipeline)        → after PR 4 (captures new RPC shape)
PR 8 (duplicate types)       → after PR 7
PR 9a-d (area sweeps)        → after PR 8
```

Total: 9 PRs (12 with PR 9's 4 sub-PRs). The first 5 are parallelisable across the queue.

---

## Items intentionally NOT done

- **Don't touch the inline-JSX feature-flag pattern** (`{featureFlags.X && <Panel />}` in `app/app/threats/page.tsx:20` etc.) in PR 2 — different concern (partial render, not route gate).
- **Don't wrap `requireOrg` / `requireOrgRole` / `requireOrgPermission` themselves with `React.cache`** — they have `redirect()` side-effects, and wrapping the leaf functions (`getUser`, `getOrg`) is sufficient.
- **Don't bundle PRs 3 / 5 / 6** (the loader extractions) — code motion is mechanical but a 21-function PR is too big to diff confidently.
- **Don't auto-apply PR 4's migration** until advisors are green on a preview Supabase branch first.

---

# Weekly Architecture Review routine — first-run critique

The routine produced #285 on 2026-05-17 with no obvious flaws in _content_. The critique below is about the _routine itself_, so future weeks improve.

## What went well

1. **Concrete file paths + line numbers throughout** — every finding is actionable, no "consider refactoring" hand-waving.
2. **Severity (HIGH/MED/LOW) × effort (S/M/L) tagging on every item** — natural triage signal.
3. **CONTEXT.md vocabulary discipline** — each finding declares which domain term it "Sharpens" (or "none — pure hygiene"), matching the CLAUDE.md instruction to use the Module / Interface / Seam / Adapter language.
4. **Read ADRs and declared the result** ("ADRs read: none applicable") — accountability for the discovery step.
5. **Did NOT auto-act** — produced a read-only `needs-triage` issue and explicitly told the human "convert any item you want to act on into a separate `ready-for-agent` issue." Correct under the Pocock triage framework.
6. **Applied both canonical labels** (`needs-triage` + `architecture-review`) — discoverable in `gh issue list`.
7. **Footer signature with timestamp + routine name** — provenance is unambiguous.

## What to sharpen for week 21+

1. **The routine definition isn't in the repo.** It lives in claude.ai/code project settings. If you tweak the prompt next week, last week's prompt is unrecoverable. **Fix:** add `docs/agents/weekly-arch-review.md` mirroring the project prompt; reference it as the source of truth and copy-paste into claude.ai/code when it changes. Bonus: PRs that change the prompt go through review.

2. **No backlog cross-reference.** Item 5 (generated Supabase types) and item 4 (featureGate helper) may already be in `BACKLOG.md` or a `docs/plans/*.md`. If they are, surfacing them again is noise. **Fix:** add a step to the routine: "Before writing each finding, grep `BACKLOG.md` + `docs/plans/` for keywords; if a match exists, note it inline (`Already tracked: BACKLOG.md L42`) and de-prioritise."

3. **No delta detection.** Week 21's review of the same module will surface the same items unless the work has shipped. **Fix:** add a step: "Before drafting, `gh issue list --label architecture-review --state open` and explicitly diff against the previous week's findings. If an item recurs, prefix it with `(carried from week N)` rather than re-writing it fresh."

4. **No module-rotation strategy declared.** Week 20 covered `apps/web/app`. Without a rotation plan, week 21 = same module = duplicates. **Fix:** declare a rotation in `docs/agents/weekly-arch-review.md`:
   - Week N+0: `apps/web/app` (RSC pages, no `api/`)
   - Week N+1: `apps/web/app/api` (route handlers)
   - Week N+2: `packages/scam-engine`
   - Week N+3: `packages/bot-core`
   - Week N+4: `apps/extension` + `apps/mobile`
   - Week N+5: `pipeline/scrapers`
   - Week N+6: SQL migrations + RPCs since last sweep
   - then loop

5. **`Sharpens: (none — pure hygiene)` is a smell.** Items 1 and 6 both have it. If the schema requires a domain-term mapping for every finding, hygiene items shouldn't share the schema — drop the field for them, or make it optional and only populate when meaningful. Otherwise reviewers learn to skim past it.

6. **No issue-cap.** 6 items is fine; 20 wouldn't be triageable in one sitting. **Fix:** "Cap findings at 7 per issue. If you find more, file the top 7 and note `N additional items deferred to week N+1`."

7. **No SLA on the resulting `needs-triage` label.** After 4 weeks, you'll have 24 items at `needs-triage` from the routine alone. **Fix:** add a "Stale triage sweep" Inngest cron OR a manual step in the routine: "Before drafting this week's issue, close any `architecture-review` + `needs-triage` issue older than 21 days as `wontfix` with comment `Stale — re-surface if still relevant`."

8. **Drift-prone claims like "this propagates to requireAdmin".** The routine wrote that for item 1, but two `requireAdmin` functions exist (one Supabase, one HMAC). **Fix:** add a step: "When claiming a change propagates to a named function, run `grep -rn 'function <name>' apps/web/lib/` and list every match. If >1 exists, qualify which one you mean by import path."

9. **No threat-model crosswalk.** Item 1 caches auth state — worth a one-line cross-check against `SECURITY.md` to confirm request-scoped caching doesn't violate any session-handling rule. (It doesn't, here.) **Fix:** add a step: "For findings that touch auth, session, billing, or PII paths, append a one-line `Threat-model check: <safe / see SECURITY.md §X>` to the finding."

10. **No "operational safety net" crosswalk.** Item 6 proposes a new RPC. CLAUDE.md has a specific section on hot tables (`feedback_triage_queue` is on it) and a `pg-stuck-query-watchdog` cron. The routine didn't mention either — fine here (read-only aggregation) but the lens needs to be active. **Fix:** add a step: "For findings that introduce SQL functions / scrapers / crons, check the work against CLAUDE.md's 'Never Do' and 'Always Do' lists and append `Ops-safety check: <complies | see <section>>`."

## Proposed routine prompt diff (high-level)

The routine prompt at claude.ai/code should add, in order:

```
Before drafting findings:
1. Read CONTEXT.md, applicable docs/adr/*.md, and CLAUDE.md "Critical Rules".
2. List the module under review and confirm it matches this week's rotation
   in docs/agents/weekly-arch-review.md.
3. `gh issue list --label architecture-review --state open` to find carry-overs.
4. grep BACKLOG.md + docs/plans/ for any keywords that match planned findings.
5. Sweep stale `architecture-review` + `needs-triage` issues older than 21 days
   → close as wontfix with comment `Stale — re-surface if still relevant`.

When writing each finding:
- If a propagation claim names a function, verify only one such function
  exists; otherwise qualify by import path.
- If the finding touches auth/session/billing/PII, add `Threat-model check:`.
- If it introduces SQL/scraper/cron, add `Ops-safety check:`.
- Cap findings at 7. Defer the rest.

Footer (preserve as-is): timestamp, routine name, "read-only triage input".
```

Materialise these into `docs/agents/weekly-arch-review.md` as the canonical spec, and copy-sync to the claude.ai/code project prompt.
