# Safety rails — the elaborated patterns

CLAUDE.md keeps the 5 critical rules terse. This doc has the **why** + the **reference shape** for each, plus the elaborated "always do" patterns that don't fit in CLAUDE.md's per-turn budget.

---

## 1. Never `SET statement_timeout = 0`

Never set `statement_timeout = 0` (or `SET LOCAL statement_timeout = 0`) anywhere — Python scrapers, PL/pgSQL functions, migrations.

**Why:** Incident 2026-05-09. This exact pattern allowed a single ACNC tail UPDATE to hang for 20 hours and take the whole site down.

**How to apply:** If a query needs more than the 2-min pooler default, **chunk it and cap timeout at a real value** (e.g. `'300s'`). The right safety net is a chunked retryable loop + a finite cap, not "no cap." The `pipeline/scrapers/acnc_register.py` chunked `TOUCH_LAST_SEEN_SQL` pattern is the reference shape after PR #187.

---

## 2. Always `Promise.race` `auth.getUser()` in middleware + route handlers

**Why:** Middleware has a 25s Vercel cap; bare-`await` `supabase.auth.getUser()` in `apps/web/middleware.ts` returns 504 `MIDDLEWARE_INVOCATION_TIMEOUT` for **every** request, not just authed ones, when Supabase Auth is degraded.

**How to apply:**

- **Middleware** (3s budget): wrap in `Promise.race`; on timeout, treat the request as anonymous and let route-protection logic redirect protected paths to login.
- **Route handlers / server-component layouts** (5s budget): wrap the same way; throw `AuthUnavailableError` on timeout. Define a clean failure: anonymous fallback for public pages, redirect to `/login?reason=auth_unavailable` for protected layouts (matches session-expiry UX), 503 + `Retry-After` for APIs.

Reference shapes: `apps/web/middleware.ts` `withTimeout` helper + `apps/web/lib/auth.ts` `AuthUnavailableError`.

---

## 3. Always chunk writes >5K rows on hot tables

Never run a single UPDATE/DELETE/UPSERT against >5K rows in one statement on a hot write-frequent table:

`acnc_charities`, `scam_reports`, `verified_scams`, `feedback_triage_queue`, `feed_items`, `scam_entities`.

**How to apply:** chunk via `WHERE pk = ANY(chunk_array)` of size ≤5K with try/except + commit per chunk so a single chunk failure doesn't poison the run. The `pipeline/scrapers/acnc_register.py` chunked TOUCH_LAST_SEEN_SQL pattern is the reference shape after PR #187.

---

## 4. Never put a large index on a write-frequent table

Never add a vector / HNSW / large GIN index directly to a write-frequent table.

**Why:** Every UPDATE on the table — even if the indexed column didn't change — has to consider the index, which dirties index pages and burns Disk IO budget. Disk IO Budget on Supabase compute tiers depletes fastest from index page dirties, not table writes.

**How to apply:** if embeddings are needed, put them on a 1:1 sibling table — see the `acnc_charity_embeddings` pattern in BACKLOG.md → Charity Legitimacy Check; the existing `verified_scams` / `scam_reports` split in v87–v89. The HNSW lives on the read-only sibling, the daily writes happen on the lean parent.

**Pre-launch check:** before adding any new large index (HNSW, large GIN trigram, BRIN over wide ranges) to an existing table that takes daily writes, check the table's current index footprint with `SELECT pg_size_pretty(pg_indexes_size('public.<table>'))`, compare to `pg_relation_size`. If the new index would push the index-to-data ratio above ~5:1, OR the index is bigger than 100 MB, put it on a 1:1 sibling table instead.

---

## 5. Always cut a fresh branch off `main` before any code edit

**Why:** Multiple concurrent agents (Claude sessions, lint-staged hooks, editor extensions) can all touch the working tree and the branch pointer mid-session; without an isolated branch, one agent's stash/reset can silently clobber another agent's in-flight edits or land a commit on the wrong branch.

**How to apply:**

```bash
git fetch origin && git checkout main && git pull --ff-only
git checkout -b <scope>/<short-task-name>
```

Verify with `git branch --show-current` before any edit. Don't piggyback work onto someone else's feature branch. Don't continue committing on a branch you inherited from the previous session.

Enforced by `.claude/hooks/branch-check.sh` for AI agents.

---

## Elaborated "always do" patterns

### For any new long-running write loop

(scraper, retention sweep, backfill, large UPDATE/DELETE)

- Cap `statement_timeout` at a real value (`'300s'` is the established convention)
- Chunk at ≤5K rows/iteration
- Wrap each chunk in try/except with rollback
- Log per-chunk progress with row counts

Reference shape: `pipeline/scrapers/acnc_register.py` chunked `TOUCH_LAST_SEEN_SQL` pattern after PR #187.

### For any new auth-dependent code path

(middleware, route handler, server-component layout)

Wrap external Supabase auth calls with `Promise.race` + a finite timeout (3s in middleware, 5s in route handlers/layouts). Define a clean failure:

- Anonymous fallback for public pages
- Redirect to `/login?reason=auth_unavailable` for protected layouts (matches session-expiry UX)
- 503 + `Retry-After` for APIs

Reference shapes: `apps/web/middleware.ts` `withTimeout` + `apps/web/lib/auth.ts` `AuthUnavailableError`.

### For any new Inngest function or Vercel `/api/cron/*` route

The work it does should complete in <5 min on a healthy DB. Anything that _could_ exceed 10 min will trigger the `pg-stuck-query-watchdog` Telegram page. Either chunk the work or document the expected duration in the function's header comment so future investigators know it's intentional. Cron functions that run ACROSS hot tables (`acnc_charities`, `scam_reports`, `feed_items`, etc.) must use the chunking pattern above.

### Before flipping any consumer feature flag from default-OFF to ON

(e.g. `NEXT_PUBLIC_FF_CHARITY_CHECK`, `NEXT_PUBLIC_FF_PHONE_INTEL`, `NEXT_PUBLIC_FF_DEEPFAKE`)

Re-run `mcp__supabase__get_advisors` (security + performance), and run the Disk-IO-budget query:

```sql
SELECT … FROM extensions.pg_stat_statements ORDER BY shared_blks_read+shared_blks_written DESC LIMIT 25
```

The first time real traffic hits a feature is the wrong time to discover its read pattern blew the IO budget.
