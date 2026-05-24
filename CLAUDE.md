# Ask Arthur — Project Guide

Master reference for AI assistants and contributors working on this codebase. Start here, follow links for depth.

---

## Quick Reference

| What                                             | Where                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Living system map (start here)                   | [docs/system-map/README.md](./docs/system-map/README.md) — web surface, database, background workers, feature flags, data flows. Every route / table / cron / flag has exactly one home there.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Code standards & patterns                        | [CONVENTIONS.md](./CONVENTIONS.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Architecture vocabulary                          | [.claude/skills/improve-codebase-architecture/](./.claude/skills/improve-codebase-architecture/) — Module / Interface / Seam / Adapter language + deletion test. **Read [CONTEXT.md](./CONTEXT.md) (domain glossary) and any relevant [docs/adr/](./docs/adr/) entries before designing any new feature.** Use the skill via `/improve-codebase-architecture` for retrospective deepening reviews.                                                                                                                                                                                                                                                                                                                              |
| Design tokens & UI rules                         | [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Security & threat model                          | [SECURITY.md](./SECURITY.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Roadmap & status                                 | [ROADMAP.md](./ROADMAP.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Deferred features                                | [BACKLOG.md](./BACKLOG.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| OpenAPI spec                                     | [docs/openapi.yaml](./docs/openapi.yaml)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Phone Footprint — plan                           | [docs/plans/phone-footprint-v2.md](./docs/plans/phone-footprint-v2.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Phone Footprint — ops config                     | [docs/ops/phone-footprint-config.md](./docs/ops/phone-footprint-config.md) — env vars, feature flags, Stripe prices, vendor setup, UI integration points. **Check here first for any UI toggle, flag flip, or key integration question.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Breach Defence — plan                            | [docs/plans/breach-defence-suite.md](./docs/plans/breach-defence-suite.md) — 19-PR build sequence (F1–F11), migration renumbering (v80–v86), spec-vs-codebase corrections. **Currently paused after PR 2** (#46 + #47 shipped, schema live in prod, all flags OFF) — see §1b "Pause notes" before resuming. The detailed source spec lives in PR #46's description.                                                                                                                                                                                                                                                                                                                                                             |
| Reddit Intel — plan                              | [docs/plans/reddit-intel.md](./docs/plans/reddit-intel.md) — 13-brief narrative-extraction pipeline over the existing Reddit scrape (Sonnet 4.6 classifier + Voyage embeddings + greedy pgvector clustering + dashboard widget + weekly email + B2B `/api/v1/intel/*`). **Code-complete 2026-05-02**; weekly digest redesigned + public `/intel/themes/[slug]` deep-link page added in #124 (2026-05-06) — gated by `NEXT_PUBLIC_FF_REDDIT_INTEL_PUBLIC_PAGES` (default OFF). UTM tagging on outbound email/CTA links lives in `apps/web/lib/utm.ts` (first UTM convention in the codebase). Cost cap A\$10/day enforced via `feature_brakes.reddit_intel`; errors land in `cost_telemetry WHERE feature='reddit-intel-error'`. |
| Charity Check — ops config                       | [docs/ops/charity-check-config.md](./docs/ops/charity-check-config.md) — env vars, feature flags, GitHub Actions variables, scraper schedule, smoke-test checklist. v0.1+v0.2a code-complete + merged 2026-05-02; `acnc_charities` table populated (63,637 rows, weekly source / daily scraper). Consumer surface gated by `NEXT_PUBLIC_FF_CHARITY_CHECK` (default OFF) — flip on Vercel preview to drive `/charity-check`. v0.2c (PFRA + Scamwatch), v0.2d (behavioural micro-flow), v0.2e (main-checker hook), v0.2b (image OCR) tracked in BACKLOG.md → Charity Legitimacy Check.                                                                                                                                            |
| Voyage embeddings — ops config                   | [docs/ops/voyage-embeddings-config.md](./docs/ops/voyage-embeddings-config.md) — model env vars, B2B feature flags, dashboard toggles (zero-day retention, per-env API key split), backfill Inngest events for `acnc_charities` and `scam_reports`/`verified_scams`, smoke tests for `/api/v1/intel/search` and `/api/v1/scams/search`, cost monitoring queries, reindex policy. Voyage roadmap shipped 2026-05-04 (PRs #109/#110/#111/#112, migrations v87–v89).                                                                                                                                                                                                                                                               |
| Shop Signal — ops config                         | [docs/ops/shop-signal-config.md](./docs/ops/shop-signal-config.md) — APIVoid config, pricing tiers + cap derivation. Stage 0/0.5 shipped 2026-05-19 (#324/#325); `FF_SHOP_SIGNAL` flipped ON 2026-05-20 — 30-day measurement window open (closes ~2026-06-19, `docs/ops/shop-signal-measurement.md`). Stage 1 (#319/#320/#321) building live on the APIVoid free trial; day-31 is the APIVoid paid-tier renew decision, not a build gate. Plan: [docs/plans/shop-guard-v2.md](./docs/plans/shop-guard-v2.md).                                                                                                                                                                                                                   |
| Clone-detection — signal model + source layering | [docs/adr/0015-clone-detection-signal-model.md](./docs/adr/0015-clone-detection-signal-model.md) + [docs/adr/0016-clone-detection-source-layering.md](./docs/adr/0016-clone-detection-source-layering.md) — Phase A (#376) ships deterministic-only via `packages/shopfront-glue/`; CT firehose (#383) is Phase B; Voyage embeddings + Hetzner (#384) are Phase C / Layer-4. Supersedes the unreviewed Proactive Domain Monitor draft (not committed).                                                                                                                                                                                                                                                                          |
| Clone-watch MVP — plan + ops                     | [docs/plans/clone-watch-mvp.md](./docs/plans/clone-watch-mvp.md) — Layer 0 of ADR-0016 (pre-Stage-1 NRD lexical sweep against ~50 AU brands). S0E.1 shipped 2026-05-24 (v140 schema + matcher), S0E.2 shipped (Inngest fn + v141 RPC, gated `FF_SHOPFRONT_CLONE_WATCH` default OFF), S0E.3 shipped (public `/clone-watch` page, `noindex` for first 7 days until #371 v1 copy returns). Cost A\$0/mo — whoisds free tier. Cost-telemetry label `shopfront_clone_watch` (snake-case, distinct from Phase A's `shopfront_clone_scan`).                                                                                                                                                                                            |
| Pending manual setup                             | [docs/ops/pending-manual-setup.md](./docs/ops/pending-manual-setup.md) — dashboard toggles + third-party API tokens + GitHub secrets that the 2026-05-08 db-hygiene sweep shipped behind feature flags. Currently: HIBP leaked-password toggle (1 sec security WARN) + R2 DR bucket setup + first quarterly DR drill. Step-by-step instructions per item.                                                                                                                                                                                                                                                                                                                                                                       |
| News Intel feeds — ops                           | See [docs/system-map/background-workers.md#news-intel-scrapers--operational-note](./docs/system-map/background-workers.md#news-intel-scrapers--operational-note) — Scamwatch HTML, ACSC RSS, ASIC JSON narrative scrapers + retention + `cyber.gov.au` WAF workaround.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Grants & Funding — drafts                        | [docs/grants/](./docs/grants/) — application narratives. Currently: `aea-seed-narrative.md` (AEA Seed, blocked on UNSW/Parwada partnership). Active items in BACKLOG.md → `Grants & Funding`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Policy submissions — templates                   | [docs/policy/](./docs/policy/) — reusable submission skeletons. Currently: `spf-submission-template.md` (Treasury / ACCC / ACMA SPF subordinate-rules; sovereign-tech-advocate framing). Active filings + watch items in BACKLOG.md → `Policy & Regulatory Submissions`.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

> **Database hygiene note.** See [docs/system-map/database.md#hygiene-backlog](./docs/system-map/database.md#hygiene-backlog) for the deferred items from the 2026-04-23 advisor audit (177 unused indexes, RLS rewrites, partitioned shadows, Phase 1 commercial tables). Migration v78 cleared the P0 advisor ERRORs; everything else is tracked in `BACKLOG.md → Database Hygiene & SPF Readiness`.

## Agent skills

### Issue tracker

GitHub Issues (`gh` CLI) — `matchmoments-admin/ask-arthur`. See [`docs/agents/issue-tracker.md`](./docs/agents/issue-tracker.md).

### Triage labels

Five canonical labels per Matt Pocock's framework, used as-is (no remap): `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See [`docs/agents/triage-labels.md`](./docs/agents/triage-labels.md).

### Domain docs

Single-context — `CONTEXT.md` + `docs/adr/` + `docs/system-map/` at repo root. See [`docs/agents/domain.md`](./docs/agents/domain.md).

## What Is This?

Ask Arthur is an Australian scam detection platform. Users submit suspicious content (text, URLs, images) via web app, browser extension, mobile app, or chat bots. The platform uses Claude AI + threat intelligence feeds to return a verdict (SAFE / SUSPICIOUS / HIGH_RISK).

**Domain:** askarthur.au

## Project Structure

```
ask-arthur/
├── apps/
│   ├── web/                    # @askarthur/web — Next.js 16 (Turbopack, React 19)
│   ├── extension/              # @askarthur/extension — Chrome/Firefox (WXT, React 19)
│   └── mobile/                 # @askarthur/mobile — React Native (Expo 54)
│
├── packages/
│   ├── types/                  # @askarthur/types — Zod 4 schemas, TS interfaces
│   ├── supabase/               # @askarthur/supabase — Client factories (server/browser)
│   ├── utils/                  # @askarthur/utils — Logger, hash, rate-limit, feature-flags
│   ├── scam-engine/            # @askarthur/scam-engine — Claude analysis, pipeline, Inngest
│   ├── bot-core/               # @askarthur/bot-core — Bot formatters, webhook verify, queue
│   ├── extension-audit/        # @askarthur/extension-audit — Chrome extension security scanner
│   ├── mcp-audit/              # @askarthur/mcp-audit — MCP server + AI skill security scanner
│   └── breach-defence/         # @askarthur/breach-defence — AU Breach Index, DNS drift, typosquat, recovery playbooks
│
├── tooling/
│   └── typescript/             # @askarthur/tsconfig — Shared TS configs
│
├── pipeline/
│   └── scrapers/               # Python threat feed scrapers (16 feeds)
│
├── supabase/                   # Migration SQL files (v2–v62)
├── docs/                       # OpenAPI spec, setup guides, compliance
├── turbo.json                  # Turborepo task config
├── pnpm-workspace.yaml         # Workspace manifest
└── .npmrc                      # pnpm settings
```

## Essential Commands

```bash
# Build & test everything
pnpm turbo build
pnpm turbo test
pnpm turbo typecheck
pnpm turbo lint

# Run specific apps
pnpm --filter @askarthur/web dev
pnpm --filter @askarthur/extension dev
pnpm --filter @askarthur/mobile dev

# Run specific package tests
pnpm --filter @askarthur/bot-core test
pnpm --filter @askarthur/web test

# Python pipeline tests
cd pipeline/scrapers && python -m pytest tests/ -v
```

## Import Patterns

All cross-package imports use `@askarthur/*` (no hyphen):

```typescript
import type { AnalysisResult } from "@askarthur/types";
import { createServiceClient } from "@askarthur/supabase/server";
import { createAuthServerClient } from "@askarthur/supabase/server-auth";
import { createMiddlewareClient } from "@askarthur/supabase/middleware";
import { logger } from "@askarthur/utils/logger";
import { checkRateLimit } from "@askarthur/utils/rate-limit";
import { analyzeWithClaude } from "@askarthur/scam-engine/claude";
import { storeVerifiedScam } from "@askarthur/scam-engine/pipeline";
import { analyzeForBot } from "@askarthur/bot-core/analyze";
import { toTelegramMessage } from "@askarthur/bot-core/format-telegram";
import { TIER_LIMITS } from "@askarthur/types/billing";
import type { UnifiedScanResult } from "@askarthur/types/scanner";
import { scanExtension } from "@askarthur/extension-audit";
import { scanMcpServer, scanSkill } from "@askarthur/mcp-audit";
```

Within the web app, use `@/` for local imports:

```typescript
import { validateApiKey } from "@/lib/apiAuth";
```

## Key Technical Decisions

| Decision                | Choice                                                                                                                                                        | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package manager         | pnpm                                                                                                                                                          | Fast, strict, workspace support                                                                                                                                                                                                                                                                                                                                                                                              |
| Build orchestration     | Turborepo                                                                                                                                                     | Caching, parallel builds                                                                                                                                                                                                                                                                                                                                                                                                     |
| Web framework           | Next.js 16 (Turbopack)                                                                                                                                        | SSR, API routes, Vercel deployment                                                                                                                                                                                                                                                                                                                                                                                           |
| AI model                | Claude Haiku 4.5                                                                                                                                              | Fast, cost-effective for classification                                                                                                                                                                                                                                                                                                                                                                                      |
| Database                | Supabase (PostgreSQL)                                                                                                                                         | Managed, RPC support, auth                                                                                                                                                                                                                                                                                                                                                                                                   |
| Cache / Rate limit      | Upstash Redis                                                                                                                                                 | Serverless-compatible                                                                                                                                                                                                                                                                                                                                                                                                        |
| Extension framework     | WXT                                                                                                                                                           | Cross-browser, modern DX                                                                                                                                                                                                                                                                                                                                                                                                     |
| Mobile framework        | Expo 54                                                                                                                                                       | Cross-platform, OTA updates                                                                                                                                                                                                                                                                                                                                                                                                  |
| Bot formatting          | Per-platform formatters                                                                                                                                       | Telegram HTML, WhatsApp markdown, Slack Block Kit, Messenger plain text                                                                                                                                                                                                                                                                                                                                                      |
| Background jobs         | Inngest                                                                                                                                                       | Event-driven, cron, fan-out                                                                                                                                                                                                                                                                                                                                                                                                  |
| Analytics               | Plausible                                                                                                                                                     | Privacy-first, no cookies                                                                                                                                                                                                                                                                                                                                                                                                    |
| Email                   | Resend + React Email                                                                                                                                          | Modern transactional email                                                                                                                                                                                                                                                                                                                                                                                                   |
| Billing                 | Stripe                                                                                                                                                        | Direct billing, Stripe Tax for AU GST                                                                                                                                                                                                                                                                                                                                                                                        |
| Bot queue dispatch      | Supabase Database Webhook (pg_net on `bot_message_queue` INSERT) + 10-min safety sweeper                                                                      | Event-driven, avoids polling cost; pg_net is unmetered on Supabase Pro                                                                                                                                                                                                                                                                                                                                                       |
| Cost observability      | `cost_telemetry` table (v62) + `logCost()` helper + `/admin/costs` dashboard + Telegram digests                                                               | Per-call AI/paid-API spend tagged by feature/provider; daily threshold alerts + weekly WoW digest                                                                                                                                                                                                                                                                                                                            |
| Operational safety nets | `pg-stuck-query-watchdog` Vercel cron (`*/5 * * * *`) + middleware/`requireAuth` 3-5s `Promise.race` timeouts (apps/web/middleware.ts + apps/web/lib/auth.ts) | Born from incident 2026-05-09. Watchdog Telegram-pages on any non-VACUUM backend running ≥10 min; auto-terminates at 60 min when `PG_WATCHDOG_AUTO_TERMINATE=true`. Auth timeouts mean a degraded Supabase Auth degrades only protected pages, not the whole site. Hot tables (write-frequent + heavily-indexed): `acnc_charities`, `scam_reports`, `verified_scams`, `feedback_triage_queue`, `feed_items`, `scam_entities` |

## Critical Rules

### Never Do

- Use `npm` or `yarn` (pnpm only)
- Import with `@ask-arthur/*` (correct: `@askarthur/*`, no hyphen)
- Reference `packages/config/` (doesn't exist — shared TS config is at `tooling/typescript/`)
- Use `ssr: false` in `next/dynamic` within Server Components
- Store raw user content or PII in the database
- Use `unsafe-eval` in CSP
- Fail-open rate limiter in production
- Skip webhook signature verification for bot endpoints
- Commit `.env` files or API keys
- **Use `SET statement_timeout = 0`** (or `SET LOCAL statement_timeout = 0`) anywhere — Python scrapers, PL/pgSQL functions, migrations. Incident 2026-05-09: this exact pattern allowed a single ACNC tail UPDATE to hang for 20 hours and take the whole site down. If a query needs more than the 2-min pooler default, **chunk it and cap timeout at a real value** (e.g. `'300s'`). The right safety net is a chunked retryable loop + a finite cap, not "no cap"
- **Bare-`await` `supabase.auth.getUser()` in `apps/web/middleware.ts`** — middleware has a 25s Vercel cap; hitting it returns 504 `MIDDLEWARE_INVOCATION_TIMEOUT` for **every** request, not just authed ones. Always wrap in `Promise.race` with a 3s budget; on timeout, treat the request as anonymous and let route-protection logic redirect protected paths to login. Same rule for `apps/web/lib/auth.ts` `getUser()` (5s budget, throws `AuthUnavailableError`)
- **Run a single UPDATE/DELETE/UPSERT against >5K rows in one statement on a hot write-frequent table** (`acnc_charities`, `scam_reports`, `verified_scams`, `feedback_triage_queue`, `feed_items`, `scam_entities`). Always chunk via `WHERE pk = ANY(chunk_array)` of size ≤5K with try/except + commit per chunk so a single chunk failure doesn't poison the run
- **Add a vector / HNSW / large GIN index directly to a write-frequent table.** Every UPDATE on the table — even if the indexed column didn't change — has to consider the index, which dirties index pages and burns Disk IO budget. If embeddings are needed, put them on a 1:1 sibling table (the `acnc_charity_embeddings` pattern in BACKLOG.md → Charity Legitimacy Check; the existing `verified_scams` / `scam_reports` split in v87–v89). The HNSW lives on the read-only sibling, the daily writes happen on the lean parent

### Always Do

- Validate external input with Zod schemas
- Use timing-safe comparisons for secret checks
- Scrub PII before storing scam data
- Use `x-real-ip` as primary IP source (Vercel-provided)
- Return structured JSON errors from API routes
- Use `import type` for type-only imports
- Run `pnpm turbo build` to verify changes don't break the build
- Write descriptive Git commit messages that explain technical decisions (not just "fix bug") — these serve as contemporaneous R&D documentation for RDTI claims
- When solving a non-obvious technical problem, note the hypothesis, approach, and outcome in the commit message body — this evidences "technical uncertainty" and "new knowledge generated"
- Before designing any new feature, read [CONTEXT.md](./CONTEXT.md) and any [docs/adr/](./docs/adr/) entries that touch the area; use the vocabulary in [.claude/skills/improve-codebase-architecture/LANGUAGE.md](./.claude/skills/improve-codebase-architecture/LANGUAGE.md) (Module / Interface / Seam / Adapter — **not** "service" or "boundary") in design discussions. The only exempt changes are non-features: typo fixes, dependency bumps, comment-only edits, and pure formatting
- Apply the deletion test before adding any new wrapper module: would deleting it concentrate complexity (it's earning its keep) or just move it (it's a pass-through)? Pass-through wrappers should be inlined rather than added
- When a design decision is hard to reverse, surprising without context, AND the result of a real trade-off, offer to record it as an ADR in `docs/adr/` per [.claude/skills/grill-with-docs/ADR-FORMAT.md](./.claude/skills/grill-with-docs/ADR-FORMAT.md). When a new domain term emerges, add it to `CONTEXT.md` inline rather than coining a fresh synonym
- **For any new long-running write loop** (scraper, retention sweep, backfill, large UPDATE/DELETE): cap `statement_timeout` at a real value (`'300s'` is the established convention), chunk at ≤5K rows/iteration, wrap each chunk in try/except with rollback, log per-chunk progress with row counts. The `pipeline/scrapers/acnc_register.py` chunked TOUCH_LAST_SEEN_SQL pattern is the reference shape after PR #187
- **For any new auth-dependent code path** (middleware, route handler, server-component layout): wrap external Supabase auth calls with `Promise.race` + a finite timeout (3s in middleware, 5s in route handlers/layouts). Define a clean failure: anonymous fallback for public pages, redirect to `/login?reason=auth_unavailable` for protected layouts (matches session-expiry UX), 503 + `Retry-After` for APIs. The `apps/web/middleware.ts` `withTimeout` helper + `apps/web/lib/auth.ts` `AuthUnavailableError` are the reference shapes
- **For any new Inngest function or Vercel `/api/cron/*` route**: the work it does should complete in <5 min on a healthy DB. Anything that _could_ exceed 10 min will trigger the `pg-stuck-query-watchdog` Telegram page. Either chunk the work or document the expected duration in the function's header comment so future investigators know it's intentional. Cron functions that run ACROSS hot tables (`acnc_charities`, `scam_reports`, `feed_items`, etc.) must use the chunking pattern above
- **Before adding any new large index** (HNSW, large GIN trigram, BRIN over wide ranges) to an existing table that takes daily writes: check the table's current index footprint with `SELECT pg_size_pretty(pg_indexes_size('public.<table>'))`, compare to `pg_relation_size`. If the new index would push the index-to-data ratio above ~5:1, OR the index is bigger than 100 MB, put it on a 1:1 sibling table instead. The Disk IO Budget on Supabase compute tiers depletes fastest from index page dirties, not table writes
- **Before flipping any consumer feature flag from default-OFF to ON** (e.g. `NEXT_PUBLIC_FF_CHARITY_CHECK`, `NEXT_PUBLIC_FF_PHONE_INTEL`, `NEXT_PUBLIC_FF_DEEPFAKE`): re-run `mcp__supabase__get_advisors` (security + performance), and run the Disk-IO-budget query (`SELECT … FROM extensions.pg_stat_statements ORDER BY shared_blks_read+shared_blks_written DESC LIMIT 25`). The first time real traffic hits a feature is the wrong time to discover its read pattern blew the IO budget

## Deployment

| Platform  | Target                 | Config                                                                                                                                                                                                        |
| --------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web app   | Vercel                 | Root: `apps/web`, Build: `cd ../.. && pnpm turbo build --filter=@askarthur/web`                                                                                                                               |
| Extension | Chrome Web Store       | Minimal v1.0.0: `pnpm --filter @askarthur/extension zip`. Full-featured v1.0.1 (with Facebook ads): `WXT_FACEBOOK_ADS=true pnpm --filter @askarthur/extension zip`. New host permissions → 1–3 day re-review. |
| Mobile    | App Store / Play Store | EAS Build via Expo                                                                                                                                                                                            |
| Pipeline  | GitHub Actions         | Scheduled cron, gated by `ENABLE_SCRAPER`                                                                                                                                                                     |
| Bots      | Vercel (webhooks)      | Webhook URLs registered per platform                                                                                                                                                                          |

### Standard ship workflow (code + schema)

The ordering below exists to avoid the DB-ahead-of-code skew that leaves
production using new tables before the code that reads them ships, or vice
versa. Follow it for any change that touches SQL and TypeScript together.

**Start every new piece of work on a fresh branch off `main`.** Multiple
concurrent agents (Claude sessions, lint-staged hooks, editor extensions)
can all touch the working tree and the branch pointer mid-session; without
an isolated branch, one agent's stash/reset can silently clobber another
agent's in-flight edits or land a commit on the wrong branch. Before any
code change:

```bash
git fetch origin && git checkout main && git pull --ff-only
git checkout -b <scope>/<short-task-name>   # e.g. phone-footprint/sprint-2
```

Do NOT piggyback work onto someone else's feature branch, and do NOT
continue committing on a branch you inherited from the previous session
without verifying `git branch --show-current` first. Costs of a mis-placed
commit are high — cherry-picking out of a stranger's branch is tedious and
sometimes lossy if a subsequent rebase has rewritten hashes.

1. **Typecheck locally** — `pnpm turbo typecheck`. Also `pytest` under
   `pipeline/scrapers/` if the change touches Python.
2. **Stage explicit files** — never `git add -A` (the repo has several in-progress
   trees like `apps/web/app/ai-statement/`, `for-business/`, that are not
   meant for your commit).
3. **Commit with a HEREDOC message** — include WHY (R&D documentation), reference
   any migration versions touched, and the `Co-Authored-By: Claude Opus 4.7 (1M context)` trailer.
4. **Push to a feature branch** — never push directly to `main`. If the branch
   has fallen behind `main`, prefer `git rebase main` over a merge commit:
   rebasing keeps the file tree linear so Turbo remote-cache hits from `main`'s
   already-built tasks carry over cleanly to the next preview build.
5. **Apply migrations to the Supabase prod project** via
   `mcp__supabase__apply_migration` on project `rquomhcgnodxzkhokwni`.
   Migrations should be idempotent (`CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF
EXISTS ... CREATE POLICY ...`, etc.) so re-running is safe.

   **PL/pgSQL function gotchas — verified bites in prod (2026-05-06):**
   - When a function has `RETURNS TABLE (col_name …)`, an unqualified
     `col_name` inside the body resolves to the OUT-parameter variable,
     NOT a table or CTE column. Add `#variable_conflict use_column`
     immediately after `AS $$` to flip this default. Without it, an
     unqualified `select id from cte` in the body raises
     `ERROR 42702: column reference "id" is ambiguous` at function-call
     time, never at CREATE FUNCTION time.
   - `SET search_path = ''` hides extension operators like pgvector's
     `<=>`. Use `SET search_path = public, pg_catalog` for SECURITY
     INVOKER functions that depend on extension-provided operators;
     reserve the empty form for SECURITY DEFINER functions where
     unqualified-name exploitation is the actual threat model.
   - Both bites surface as immediate exceptions on the first call,
     regardless of input data — which is what
     `packages/scam-engine/src/__tests__/rpcs.smoke.test.ts` is for.
     Run it with `SUPABASE_INTEGRATION_TEST_URL` +
     `SUPABASE_INTEGRATION_TEST_SERVICE_KEY` set against a preview
     branch after applying any migration that touches a function body.

6. **Check advisors** — `mcp__supabase__get_advisors` (type: security and performance).
   New ERRORs introduced by the migration must be fixed before merging the PR;
   pre-existing ERRORs can be documented in `ROADMAP.md` and deferred.
7. **Open or update a PR** — `gh pr create --base main --head <branch>` (or
   `gh pr edit <n> --title/--body` if one exists). Body should list migration
   versions touched and whether they're already applied, plus a post-merge
   verification checklist.
8. **Wait for Vercel preview** — the PR check `Vercel` must be green. A failing
   preview means the merge will break production. The preview build also
   populates the Turbo remote cache for every task in this PR's file tree;
   because squash-merging preserves that tree, the post-merge production deploy
   on `main` replays those cache entries instead of rebuilding from scratch.
9. **Merge with `gh pr merge <n> --squash --delete-branch=false`**. Use
   `--admin` _only_ when CI is red for reasons demonstrably unrelated to the
   PR (e.g., pre-existing flaky tests that are also red on `main`); flag this
   explicitly in the PR body before merging. Note that `--admin` skips the
   preview build, so the remote cache is not warmed and the production deploy
   that follows will be a full cold rebuild — use sparingly.
10. **Verify prod deploy** — `gh run list --branch main --limit 1` confirms the
    Vercel deploy kicked off. Smoke-test the touched surfaces on prod.

**Migrations that require special handling** — destructive, table-rewriting, or
long-running (>1 min) migrations should be run during a maintenance window and
documented with an operator runbook (see `docs/partitioning-runbook.md` for the
template). Never auto-apply these via the MCP.

**Rollback plan** — every migration must be idempotent-re-applyable OR ship
alongside a documented reverse script. For archive-to-cold-table patterns, the
reverse is `INSERT ... SELECT` from the archive back to the hot table.

## Environment Variables

45+ env vars defined in `turbo.json` `globalEnv`. The full grouped inventory — Supabase, AI, Redis, R2, Email, Bots, Extension, Stripe, Inngest, third-party APIs, cost brakes, operational gates — lives at [docs/system-map/feature-flags.md#environment-variables](./docs/system-map/feature-flags.md#environment-variables).

Two server-only flags worth knowing without opening that page:

- **`FF_ANALYZE_INNGEST_WEB`** — when `true`, `/api/analyze` emits `analyze.completed.v1` and durable Inngest consumers take over `scam_reports` / brand alerts / cost telemetry writes. When unset or `false`, the legacy `waitUntil` path runs. Canary separately from other flags.
- **`PG_WATCHDOG_AUTO_TERMINATE`** — when `true`, the `pg-stuck-query-watchdog` cron auto-terminates non-VACUUM backends running ≥60 min. Born from incident 2026-05-09.

**Cost brakes:** `DAILY_COST_THRESHOLD_USD` (default `2`), `VULN_AU_ENRICHMENT_CAP_USD` (`5`), `REDDIT_INTEL_CAP_USD` (`10`), `PHONE_FOOTPRINT_CAP_USD` (`5`), `CHARITY_CHECK_CAP_USD` (`5`), `SHOP_SIGNAL_CAP_USD` (`15`). Use bare numbers — `parseFloat("$10")` is `NaN` and silently disables the brake.

### Analyze request correlation

Clients can send an `Idempotency-Key` header on `/api/analyze`; the server echoes it as `X-Request-Id`, threads it into the Inngest event id, and persists it as `scam_reports.idempotency_key` (v73). Replay-safe via `create_scam_report` RPC `ON CONFLICT`. Full flow in [docs/system-map/data-flows.md#1-analyze-pipeline--apianalyze](./docs/system-map/data-flows.md#1-analyze-pipeline--apianalyze).
