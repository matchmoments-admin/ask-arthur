# supabase/ — local guide

Scoped guidance for the top-level `supabase/` directory — versioned migration SQL, edge functions, and schema source-of-truth. Read this in addition to the [root CLAUDE.md](../../CLAUDE.md).

## What this directory owns

- **Versioned migration SQL** — `migration-v<N>-<slug>.sql` files (currently v2 through v142+). Apply with `mcp__supabase__apply_migration` against project `rquomhcgnodxzkhokwni`.
- **Edge functions** — `supabase/functions/` (deployed via Supabase CLI / MCP).
- **Schema-derived assets** — the generated `packages/types/src/db.generated.ts` is regenerated against this schema after every applied migration.

## What it doesn't own

- **Client factories.** See [`packages/supabase/CLAUDE.md`](../packages/supabase/CLAUDE.md).
- **The `Database` TypeScript type.** Lives in `packages/types/src/db.generated.ts`. Regenerated, not authored.
- **Migration runners / orchestration.** Migrations are applied manually via the Supabase MCP per the root CLAUDE.md ship workflow (§5). There is no `npm migrate` here.

## Critical rules

### 1. Never edit a merged migration

Once a `migration-v<N>-<slug>.sql` file has been applied to production and merged to `main`, it is immutable. Schema drift is fixed by adding a NEW migration (`v<N+k>-fix-<slug>.sql`) that adjusts the world forward. Editing a past file makes the prod schema diverge from the file tree silently.

### 2. Every new table gets an RLS policy

`CREATE TABLE public.foo (...)` requires a paired `CREATE POLICY` in the same migration (or a later one that ships in the same PR). Unprotected tables that survive into prod are an incident waiting to happen.

The advisor will surface this — `mcp__supabase__get_advisors` reports tables without RLS as ERROR. Fix before merging.

### 3. Destructive operations require an ADR reference

`DROP TABLE`, `ALTER TABLE ... DROP COLUMN`, `TRUNCATE` — any of these in a migration must include a comment block referencing the ADR (or PR description block) that justifies the destruction. The reverse path must also be documented (archive table + INSERT … SELECT back, or "no reverse — feature deleted").

### 4. SECURITY DEFINER + `SET search_path` rules

- `SECURITY INVOKER` functions that depend on extension operators (pgvector's `<=>`, pg_trgm, etc.): use `SET search_path = public, pg_catalog`. The empty form `''` hides extension operators and the function will fail at call time.
- `SECURITY DEFINER` functions: use `SET search_path = ''` and fully qualify every reference (the threat model is unqualified-name exploitation by a low-privilege caller).
- `RETURNS TABLE (col_name ...)` functions: add `#variable_conflict use_column` immediately after `AS $$`. Without it, unqualified column refs in the body resolve to OUT parameters and raise `42702: column reference is ambiguous` at call time.

These bites are covered by `packages/scam-engine/src/__tests__/rpcs.smoke.test.ts` — run against a preview branch after applying any migration that changes a function body.

### 5. Long-running migrations are not auto-applied

Migrations that rewrite tables, take >1 min, or hold locks on a hot table must be scheduled with a maintenance window and shipped alongside an operator runbook (template: `docs/partitioning-runbook.md`). Never use `mcp__supabase__apply_migration` for these — they go through the dashboard with a watching operator.

### 6. Hot tables — chunk all bulk writes

`acnc_charities`, `scam_reports`, `verified_scams`, `feedback_triage_queue`, `feed_items`, `scam_entities`. Any UPDATE/DELETE/UPSERT against >5K rows on these tables must be chunked at ≤5K rows/iteration with a finite `statement_timeout`. Reference: incident 2026-05-09; pattern in `pipeline/scrapers/acnc_register.py`.

## Naming convention

```
migration-v<N>-<kebab-case-slug>.sql
```

- `<N>` is monotonic; check existing max with `ls supabase/migration-v*.sql | sort -V | tail -1`.
- `<slug>` should describe the intent, not the mechanism. `migration-v140-clone-watch-schema.sql`, not `migration-v140-create-tables.sql`.
- Idempotent constructs (`CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS ... CREATE POLICY ...`) are preferred so re-running is safe.

## Scoped commands

There is no `pnpm` task here — migration application is via Supabase MCP. The most relevant commands live in the root CLAUDE.md Standard ship workflow (§5).

To list applied migrations on prod: `mcp__supabase__list_migrations` against project `rquomhcgnodxzkhokwni`.

## Gotchas

- **The `db-migration.sh` advisory reviewer currently matches the path `supabase/migrations/*`** but actual files live at `supabase/migration-v*.sql`. The reviewer's checks (statement_timeout=0, unchunked hot-table writes, HNSW on parent, etc.) currently do not fire on real edits. Tracked as a follow-up — see [`.claude/README.md`](../.claude/README.md).
- **`functions/` is for Supabase edge functions, NOT Inngest functions.** Inngest lives in `packages/scam-engine/src/inngest/` and `apps/web/app/api/inngest/functions/`.
- **The migration tree is sequential, not branched.** If two PRs both add `v143-...`, the second to merge needs to bump to `v144-...`.

## Where things live

| Looking for                                    | Where                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| Embeddings policy (sibling tables for HNSW)    | [`docs/adr/0005-pgvector-index-policy.md`](../docs/adr/0005-pgvector-index-policy.md) |
| Incident 2026-05-09 hot-table chunking pattern | `pipeline/scrapers/acnc_register.py`                                                  |
| RPC smoke test (run after function migrations) | `packages/scam-engine/src/__tests__/rpcs.smoke.test.ts`                               |
| Standard ship workflow                         | Root [`CLAUDE.md`](../CLAUDE.md) §Deployment                                          |
