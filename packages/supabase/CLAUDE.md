# packages/supabase — local guide

Scoped guidance for the Supabase client factories. Read this in addition to the [root CLAUDE.md](../../CLAUDE.md).

## What this package owns

- **Client factories** — `server.ts`, `server-auth.ts`, `browser.ts`, `middleware.ts`.
- **Re-exports** — `index.ts` exposes the four factories used across the monorepo.

## What it doesn't own

- **The `Database` type.** Generated from the Supabase schema; lives in `@askarthur/types/db.generated.ts`. Re-export from here only if needed.
- **Auth flow logic.** Sign-in/sign-out, session refresh, RLS predicates live in `apps/web/lib/auth.ts` and route-level code.
- **Migrations.** See [`supabase/CLAUDE.md`](../../supabase/CLAUDE.md) at the top of the repo.

## Critical rule: who is allowed to call `createServiceClient`

`createServiceClient` in `server.ts` returns a service-role client that **bypasses RLS**. It is the single most dangerous primitive in the codebase.

**Allowed callers (worker / non-user-session tier):**

- `apps/web/app/api/**` — every existing API route. Tenant isolation here is via `api_key_id` (B2B `/v1/*`), the Vercel cron schedule (`/cron/*`), the Inngest function gate (`/inngest/functions/*`), or by design — no user session is involved (public report endpoints, the waitlist).
- `packages/scam-engine/**` — durable Inngest workers and helpers.
- `packages/supabase/**` — the factory itself.
- `pipeline/scrapers/**` — Python scrapers (use the `supabase-py` service client; same rule).

**Forbidden callers (request-context tier):**

- Server components, pages, layouts (`*.tsx` under `apps/web/app/` outside `api/`).
- `apps/web/middleware.ts`.
- `apps/web/lib/**` — request-context utilities. Use `createServerClient` (RLS-bearing) instead.
- Any other `packages/**/*` outside the allowed two.

If you reach for `createServiceClient` outside the allowed tiers, stop and ask. The `rls-and-tenant-isolation.sh` advisory reviewer (PostToolUse) flags violations with `BLOCK_RECOMMENDED` severity.

> **Note on the current state.** The "all routes under `apps/web/app/api/**` are allowed" rule reflects the codebase as of 2026-05-25, not an ideal future state. Some of those routes could in principle use `createServerClient` instead and rely on RLS — the audit to evaluate that is tracked separately. The reviewer's job is to prevent NEW additions in the _forbidden_ tier, not to retrofit the historical state.

## Decision tree: which factory should I call?

| Caller surface                                   | Factory                      | RLS?   | Notes                                                                                           |
| ------------------------------------------------ | ---------------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| Server component / server action / route handler | `createServerClient`         | Yes    | Reads the user's session from cookies                                                           |
| Browser component                                | `createBrowserClient`        | Yes    | Public anon key only; never put the service-role key in the client bundle                       |
| Auth-aware route handler (login, signup)         | `createAuthServerClient`     | Yes    | Variant of `createServerClient` with extra cookie handling for auth flows                       |
| Next.js middleware                               | `createMiddlewareClient`     | Yes    | Handles cookie refresh; must run before auth checks                                             |
| Durable worker (Inngest function, cron)          | `createServiceClient`        | **No** | Service-role; bypasses RLS; only legitimate use is cross-tenant background work                 |
| Python scraper                                   | `supabase-py` w/ service key | **No** | Same rule as `createServiceClient`; chunked writes only on hot tables (see incident 2026-05-09) |

## Public API surface (key exports)

| Export                   | From                              | Purpose                                               |
| ------------------------ | --------------------------------- | ----------------------------------------------------- |
| `createServerClient`     | `@askarthur/supabase/server`      | RLS-bearing server client (cookies → session)         |
| `createAuthServerClient` | `@askarthur/supabase/server-auth` | Same as above with auth-flow cookie handling          |
| `createBrowserClient`    | `@askarthur/supabase/browser`     | RLS-bearing client-side client                        |
| `createMiddlewareClient` | `@askarthur/supabase/middleware`  | Cookie-refresh-aware middleware client                |
| `createServiceClient`    | `@askarthur/supabase/server`      | Service-role; **restricted callers only** (see above) |

## Scoped commands

```bash
pnpm --filter @askarthur/supabase typecheck
```

This package has no test suite — it's thin factories. Coverage comes from consumer packages.

## Gotchas

- **`createServerClient` in middleware will silently fail to refresh cookies.** Use `createMiddlewareClient` in middleware specifically.
- **`createServiceClient()` returns `null` when env vars are missing.** Callers must null-check. Deliberate, to keep tests passing without a service key — but it turns a missing key into a runtime no-op rather than a startup error.
- **Auth `getUser()` calls need a timeout.** See `apps/web/middleware.ts` `withTimeout` and `apps/web/lib/auth.ts` `AuthUnavailableError` — born from incident 2026-05-09.

## Where things live

| Looking for              | Where                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `Database` type          | `packages/types/src/db.generated.ts`                                                                   |
| Auth timeout helpers     | `apps/web/middleware.ts`, `apps/web/lib/auth.ts`                                                       |
| RLS policy convention    | grep `CREATE POLICY` under `supabase/migration-v*.sql`                                                 |
| Service-role audit query | `grep -rn "createServiceClient" apps/ packages/` — every result outside the allowed tiers is a finding |
