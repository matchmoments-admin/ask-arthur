# Standard ship workflow (code + schema)

The ordering below exists to avoid the DB-ahead-of-code skew that leaves
production using new tables before the code that reads them ships, or vice
versa. Follow it for any change that touches SQL and TypeScript together.

## Branch first — every time

**Start every new piece of work on a fresh branch off `main`.** Multiple
concurrent agents (Claude sessions, lint-staged hooks, editor extensions)
can all touch the working tree and the branch pointer mid-session; without
an isolated branch, one agent's stash/reset can silently clobber another
agent's in-flight edits or land a commit on the wrong branch.

```bash
git fetch origin && git checkout main && git pull --ff-only
git checkout -b <scope>/<short-task-name>   # e.g. phone-footprint/sprint-2
```

Do NOT piggyback work onto someone else's feature branch, and do NOT
continue committing on a branch you inherited from the previous session
without verifying `git branch --show-current` first. Costs of a mis-placed
commit are high — cherry-picking out of a stranger's branch is tedious and
sometimes lossy if a subsequent rebase has rewritten hashes.

Enforced for AI agents by `.claude/hooks/branch-check.sh`.

## The 10 steps

1. **Typecheck locally** — `pnpm turbo typecheck`. Also `pytest` under
   `pipeline/scrapers/` if the change touches Python.
2. **Stage explicit files** — never `git add -A` (the repo has several
   in-progress trees like `apps/web/app/ai-statement/`, `for-business/`, that
   are not meant for your commit).
3. **Commit with a HEREDOC message** — include WHY (R&D documentation),
   reference any migration versions touched, and the
   `Co-Authored-By: Claude Opus 4.7 (1M context)` trailer.
4. **Push to a feature branch** — never push directly to `main`. If the
   branch has fallen behind `main`, prefer `git rebase main` over a merge
   commit: rebasing keeps the file tree linear so Turbo remote-cache hits
   from `main`'s already-built tasks carry over cleanly to the next preview
   build.
5. **Apply migrations to the Supabase prod project** via
   `mcp__supabase__apply_migration` on project `rquomhcgnodxzkhokwni`.
   Migrations should be idempotent (`CREATE TABLE IF NOT EXISTS`,
   `DROP POLICY IF EXISTS ... CREATE POLICY ...`, etc.) so re-running is
   safe. See **PL/pgSQL function gotchas** below before adding any new
   function body.
6. **Check advisors** — `mcp__supabase__get_advisors` (type: security and
   performance). New ERRORs introduced by the migration must be fixed before
   merging the PR; pre-existing ERRORs can be documented in `ROADMAP.md` and
   deferred.
7. **Open or update a PR** — `gh pr create --base main --head <branch>` (or
   `gh pr edit <n> --title/--body` if one exists). Body should list
   migration versions touched and whether they're already applied, plus a
   post-merge verification checklist.
8. **Wait for Vercel preview** — the PR check `Vercel` must be green. A
   failing preview means the merge will break production. The preview build
   also populates the Turbo remote cache for every task in this PR's file
   tree; because squash-merging preserves that tree, the post-merge
   production deploy on `main` replays those cache entries instead of
   rebuilding from scratch.
9. **Merge with `gh pr merge <n> --squash --delete-branch=false`**. Use
   `--admin` _only_ when CI is red for reasons demonstrably unrelated to the
   PR (e.g., pre-existing flaky tests that are also red on `main`); flag
   this explicitly in the PR body before merging. `--admin` skips the
   preview build, so the remote cache is not warmed and the production
   deploy that follows will be a full cold rebuild — use sparingly.
10. **Verify prod deploy** — `gh run list --branch main --limit 1` confirms
    the Vercel deploy kicked off. Smoke-test the touched surfaces on prod.

## PL/pgSQL function gotchas (verified bites in prod 2026-05-06)

- When a function has `RETURNS TABLE (col_name …)`, an unqualified
  `col_name` inside the body resolves to the OUT-parameter variable, NOT a
  table or CTE column. Add `#variable_conflict use_column` immediately
  after `AS $$` to flip this default. Without it, an unqualified `select id
from cte` in the body raises `ERROR 42702: column reference "id" is
ambiguous` at function-call time, never at CREATE FUNCTION time.
- `SET search_path = ''` hides extension operators like pgvector's `<=>`.
  Use `SET search_path = public, pg_catalog` for SECURITY INVOKER functions
  that depend on extension-provided operators; reserve the empty form for
  SECURITY DEFINER functions where unqualified-name exploitation is the
  actual threat model.
- Both bites surface as immediate exceptions on the first call, regardless
  of input data — which is what
  `packages/scam-engine/src/__tests__/rpcs.smoke.test.ts` is for. Run it
  with `SUPABASE_INTEGRATION_TEST_URL` + `SUPABASE_INTEGRATION_TEST_SERVICE_KEY`
  set against a preview branch after applying any migration that touches a
  function body.

## Migrations that require special handling

Destructive, table-rewriting, or long-running (>1 min) migrations should be
run during a maintenance window and documented with an operator runbook (see
`docs/partitioning-runbook.md` for the template). Never auto-apply these via
the MCP.

## Rollback plan

Every migration must be idempotent-re-applyable OR ship alongside a
documented reverse script. For archive-to-cold-table patterns, the reverse
is `INSERT ... SELECT` from the archive back to the hot table.

## Analyze request correlation (Idempotency-Key)

Clients submitting to `/api/analyze` can send an `Idempotency-Key` header
(Stripe-style, ULID or any 8-255 char alphanumeric/dash/underscore). The
server echoes it back as `X-Request-Id`, threads it into the Inngest event
id, and persists it as `scam_reports.idempotency_key` (v73 migration).
Replaying the same request with the same key is safe — the
`create_scam_report` RPC's `ON CONFLICT` clause returns the original row id
without inserting. Absent the header, the server generates a ULID and
returns it for client-side correlation.
