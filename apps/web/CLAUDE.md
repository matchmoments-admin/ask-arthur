# apps/web — local guide

Scoped guidance for the Next.js consumer/B2B web app. Read this in addition to the [root CLAUDE.md](../../CLAUDE.md) when working in this directory.

The root file covers cross-package conventions, critical rules, and the standard ship workflow. This file covers what's specific to `apps/web/`.

## Layout

```
app/
├── (auth)/                # /login, /signup, /forgot-password
├── (marketing)/           # public marketing pages
├── admin/                 # admin dashboards — HMAC token OR Supabase admin role
├── api/                   # 130+ REST handlers (Node runtime by default)
│   ├── analyze/           # the core scam-analysis route
│   ├── persona-check/     # phishing-persona analysis
│   ├── v1/                # B2B endpoints (API-key gated, tier-throttled)
│   ├── webhooks/          # bot platforms + Stripe
│   ├── cron/              # Vercel cron handlers
│   ├── inngest/           # Durable consumers for analyze.completed.v1
│   └── ...
├── app/                   # authenticated consumer pages
│   ├── page.tsx           # main user dashboard
│   ├── billing/           # Stripe portal entry
│   ├── reports/, threats/ # user's own analyses (separate sibling routes)
│   └── ...
├── banking/, telco/, digital-platforms/   # SPF sector landing pages
├── blog/                  # MDX blog posts
├── charity-check/, clone-watch/, phone-footprint/  # consumer surfaces (FF-gated)
└── ...

components/                # React components (mix of server + client)
lib/                       # Local-only utilities (use @/lib/...)
  ├── auth.ts              # getUser() / requireAuth() with Promise.race
  ├── apiAuth.ts           # B2B API-key validation
  ├── stripe.ts            # Stripe client + getOrCreateStripeCustomer
  └── ...
__tests__/                 # vitest, mocks the @askarthur/* packages
middleware.ts              # Auth wrapping (Promise.race 3s), bot routing
emails/                    # React Email templates
```

## Scoped commands

Prefer scoped commands over `pnpm turbo *` when working in `apps/web/` — turbo runs every package and burns context on irrelevant output.

```bash
pnpm --filter @askarthur/web dev          # local dev server
pnpm --filter @askarthur/web build        # production build
pnpm --filter @askarthur/web typecheck    # tsc --noEmit
pnpm --filter @askarthur/web lint         # eslint
pnpm --filter @askarthur/web test         # vitest run
pnpm --filter @askarthur/web test path/to/file.test.ts  # single test
```

Only fall back to `pnpm turbo build` (no filter) when verifying cross-package impact — e.g. you changed an export in `packages/types` and want every consumer rebuilt.

## App-specific rules

- **Server components can't use `ssr: false` in `next/dynamic`** — that flag only works in client components. If you need a client-only bundle, mark the importer `"use client"` first.
- **Middleware auth is `Promise.race`-wrapped at 3s** — see `middleware.ts`. New auth-dependent code in this dir follows the same pattern via `getUser()` from `@/lib/auth` (5s budget, throws `AuthUnavailableError`). Reference shape in `app/api/family/route.ts`.
- **API responses use structured JSON errors** — `NextResponse.json({ error: 'snake_case_code' }, { status })`. Don't return HTML or plain text.
- **B2B API routes go under `app/api/v1/`** — validated via `validateApiKey()` from `@/lib/apiAuth`. The validator handles rate-limit + tier-limit + telemetry; don't re-implement.
- **Cron routes live at `app/api/cron/*`** — wired to Vercel's `vercel.json`. Hold them under 5 min on a healthy DB or the `pg-stuck-query-watchdog` will page. Chunk hot-table work at ≤5K rows/iteration.
- **Stripe customer-mapping is `user_profiles.stripe_customer_id` (v57)** — populated server-side by `getOrCreateStripeCustomer()` in `lib/stripe.ts`. The webhook handler cross-checks ownership against this. Don't trust `metadata.user_id` from Stripe events without verifying.
- **A sentence asserting a control must name what enforces it.** This repo's most-repeated defect is prose describing a guard no code runs — the privacy and trust pages described infrastructure we don't have (`c393be8`); `packages/charity-check/src/ocr-lanyard.ts:11` says Vision spend is "covered by the existing `feature_brakes.charity_check` $5/day cap" while that key has zero readers; `docs/inngest-brakes.md` listed two functions as missing brakes that both have them. So when a change adds or edits a claim that something is capped, gated, enforced, scheduled, rotated, backed up, or kept fresh, put the enforcing `file:line` in the PR body beside the claim — the `isFeatureBraked()` call, the workflow `if:`, the migration, the `vercel.json` cron entry. If the claim is about **production state** (a row count, a flag value, a freshness window, a job that runs), paste the query output and the date you ran it; never infer prod state from the code that would produce it, which is the exact step that produced all three examples. If you can produce neither, the sentence is a plan — move it to `ROADMAP.md`/`BACKLOG.md` or write it as "not yet enforced", in the same commit. A named enforcer that turns out to be wrong gets caught by the next reader; an unnamed one stops the next reader looking.

## Recommended local tooling

- **TypeScript LSP** — `/plugin install typescript-lsp@anthropics-claude-code` enables real type diagnostics and cross-package go-to-definition for the Claude Code session. High leverage in an 18-package monorepo with strict TS; per-developer choice (not committed config). Requires `typescript-language-server` available — installed via `pnpm install` at the workspace root.

> The Zod 4 / Next 16 / React 19 drift hazards live in [`.claude/skills/grill-with-docs/STACK-PINS.md`](../../.claude/skills/grill-with-docs/STACK-PINS.md). Read that first if a session involves any of those libraries.

## Common pitfalls

- `next/link` to a route that doesn't exist returns 404 at runtime, not build time — verify the path matches `app/<route>/page.tsx` or `app/(group)/<route>/page.tsx`.
- `revalidatePath` and `revalidateTag` need to be called from a Server Action or Route Handler — calling from a Server Component throws.
- The `(auth)` and `(marketing)` route groups don't appear in URLs — `app/(auth)/login/page.tsx` serves `/login`.
- `useFormState` from `react-dom` is the canonical Server Action ↔ client form bridge; the older `useFormStatus` only works inside `<form>` children.

## Where things live

| Looking for                     | Where                                                                                                                                                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All routes (web + API)          | [`docs/system-map/web-surface.md`](../../docs/system-map/web-surface.md)                                                                                                                                          |
| Feature flag inventory          | [`docs/system-map/feature-flags.md`](../../docs/system-map/feature-flags.md)                                                                                                                                      |
| The 6 canonical data flows      | [`docs/system-map/data-flows.md`](../../docs/system-map/data-flows.md)                                                                                                                                            |
| Inngest functions + Vercel cron | [`docs/system-map/background-workers.md`](../../docs/system-map/background-workers.md)                                                                                                                            |
| DB schema                       | [`docs/system-map/database.md`](../../docs/system-map/database.md) — has a table/RPC count, but it has drifted from prod before (read "121 tables, 71 RPCs" for months while prod had 159 and 177) and isn't re-verified on every edit. Query prod when the number matters. |
