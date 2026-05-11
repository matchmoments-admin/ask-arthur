# Ask Arthur — Project Guide

Master reference for AI assistants and contributors. Start here, follow links for depth.

## What Is This?

Ask Arthur is an Australian scam detection platform. Users submit suspicious content (text, URLs, images) via web app, browser extension, mobile app, or chat bots. The platform uses Claude AI + threat intelligence feeds to return a verdict (SAFE / SUSPICIOUS / HIGH_RISK).

**Domain:** askarthur.au

## Tech stack

pnpm + Turborepo · Next.js 16 (Turbopack) + React 19 · TypeScript 5 strict · Supabase Postgres · Upstash Redis · Inngest (background jobs) · Resend (email) · Stripe + Stripe Tax · Vercel (deploy) · GitHub Actions (Python pipeline cron). AI: **Claude Haiku 4.5** for user-facing scan classification, Sonnet 4.6 for the Reddit-Intel daily classifier. WXT (extension) · Expo 54 (mobile).

Operational details (cost telemetry, ops safety nets, queue dispatch, full tech-decisions table) → [ARCHITECTURE.md](./ARCHITECTURE.md).

## Quick Reference

| What                                                                                   | Where                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Architecture & data flows                                                              | [ARCHITECTURE.md](./ARCHITECTURE.md)                                                                                                                                                                         |
| Code standards, commands, import patterns                                              | [CONVENTIONS.md](./CONVENTIONS.md)                                                                                                                                                                           |
| Architecture vocabulary (Module / Interface / Seam / Adapter)                          | [.claude/skills/improve-codebase-architecture/](./.claude/skills/improve-codebase-architecture/) — read [CONTEXT.md](./CONTEXT.md) and any [docs/adr/](./docs/adr/) entries before designing any new feature |
| Design tokens & UI rules                                                               | [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md)                                                                                                                                                                       |
| Security & threat model                                                                | [SECURITY.md](./SECURITY.md)                                                                                                                                                                                 |
| Roadmap & status                                                                       | [ROADMAP.md](./ROADMAP.md)                                                                                                                                                                                   |
| Deferred features (incl. database hygiene followups from the 2026-04-23 advisor audit) | [BACKLOG.md](./BACKLOG.md)                                                                                                                                                                                   |
| OpenAPI spec                                                                           | [docs/openapi.yaml](./docs/openapi.yaml)                                                                                                                                                                     |
| **Standard ship workflow (the 10 steps + PL/pgSQL gotchas)**                           | [docs/ops/ship-workflow.md](./docs/ops/ship-workflow.md)                                                                                                                                                     |
| **Environment variables (45+ vars, grouped)**                                          | [docs/ops/env-vars.md](./docs/ops/env-vars.md)                                                                                                                                                               |
| **Deployment targets**                                                                 | [docs/ops/deployment.md](./docs/ops/deployment.md)                                                                                                                                                           |
| **Safety rails — elaborated patterns + reference shapes**                              | [docs/safety-rails.md](./docs/safety-rails.md)                                                                                                                                                               |
| Phone Footprint — plan + ops                                                           | [docs/plans/phone-footprint-v2.md](./docs/plans/phone-footprint-v2.md) + [docs/ops/phone-footprint-config.md](./docs/ops/phone-footprint-config.md)                                                          |
| Breach Defence — plan (paused after PR 2; see §1b before resuming)                     | [docs/plans/breach-defence-suite.md](./docs/plans/breach-defence-suite.md)                                                                                                                                   |
| Reddit Intel — plan                                                                    | [docs/plans/reddit-intel.md](./docs/plans/reddit-intel.md)                                                                                                                                                   |
| Charity Check — ops                                                                    | [docs/ops/charity-check-config.md](./docs/ops/charity-check-config.md)                                                                                                                                       |
| Voyage embeddings — ops                                                                | [docs/ops/voyage-embeddings-config.md](./docs/ops/voyage-embeddings-config.md)                                                                                                                               |
| News Intel feeds — ops                                                                 | [docs/ops/news-intel-feeds.md](./docs/ops/news-intel-feeds.md)                                                                                                                                               |
| Pending manual setup (HIBP, R2 DR, DR drill)                                           | [docs/ops/pending-manual-setup.md](./docs/ops/pending-manual-setup.md)                                                                                                                                       |
| Grants & policy submissions                                                            | [docs/grants/](./docs/grants/) + [docs/policy/](./docs/policy/)                                                                                                                                              |

## Critical Rules — load-bearing, terse

The five that have either caused outages or that AI agents get wrong by default. Full reasoning + reference shapes in [docs/safety-rails.md](./docs/safety-rails.md).

1. **Never `SET statement_timeout = 0`** anywhere. Cap at a real value (`'300s'`) and chunk. Caused the 2026-05-09 site-down incident.
2. **Always `Promise.race` `auth.getUser()`** in middleware (3s) and route handlers / layouts (5s). Bare-await on a slow Supabase Auth returns 504 for _every_ request, not just authed ones.
3. **Always chunk writes >5K rows on hot tables** (`acnc_charities`, `scam_reports`, `verified_scams`, `feedback_triage_queue`, `feed_items`, `scam_entities`). `WHERE pk = ANY(chunk_array)` of size ≤5K with try/except per chunk.
4. **Never put a large index on a write-frequent table** — use a 1:1 sibling table for HNSW / large GIN / wide-range BRIN. Every UPDATE dirties the index even if the indexed column didn't change.
5. **Always cut a fresh branch off `main`** before any code edit. Verify `git branch --show-current` first. Enforced by `.claude/hooks/branch-check.sh`.

### Other don'ts (project hygiene)

- Use `npm` or `yarn` (pnpm only)
- Import with `@ask-arthur/*` (correct: `@askarthur/*`, no hyphen)
- Reference `packages/config/` (doesn't exist — TS config is at `tooling/typescript/`)
- Use `ssr: false` in `next/dynamic` within Server Components
- Store raw user content or PII in the database
- Use `unsafe-eval` in CSP
- Fail-open rate limiter in production
- Skip webhook signature verification for bot endpoints
- Commit `.env` files or API keys

### Other always-dos

- Validate external input with Zod schemas; use `import type` for type-only imports
- Use timing-safe comparisons for secret checks
- Scrub PII before storing scam data
- Use `x-real-ip` as primary IP source (Vercel-provided)
- Write descriptive commit messages with hypothesis / approach / outcome — these serve as contemporaneous R&D evidence for RDTI claims
- Apply the deletion test before adding any wrapper module: would deletion concentrate complexity (it earns its keep), or just move it (inline it instead)?
- Record hard-to-reverse design decisions as ADRs in [docs/adr/](./docs/adr/) per [.claude/skills/grill-with-docs/ADR-FORMAT.md](./.claude/skills/grill-with-docs/ADR-FORMAT.md). When a new domain term emerges, add it to [CONTEXT.md](./CONTEXT.md) inline rather than coining a fresh synonym
- Before designing any new feature, read [CONTEXT.md](./CONTEXT.md) and any relevant [docs/adr/](./docs/adr/) entries; use Module / Interface / Seam / Adapter vocabulary (not "service" or "boundary"). Exempt: typo fixes, dependency bumps, comment-only edits, formatting

For the elaborated "for any new long-running write loop / auth-dependent path / Inngest function / large index / consumer flag flip" patterns, see [docs/safety-rails.md](./docs/safety-rails.md).
