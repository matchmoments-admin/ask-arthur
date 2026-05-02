# Ask Arthur — Project Guide

Master reference for AI assistants and contributors working on this codebase. Start here, follow links for depth.

---

## Quick Reference

| What                           | Where                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Architecture & data flows      | [ARCHITECTURE.md](./ARCHITECTURE.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Code standards & patterns      | [CONVENTIONS.md](./CONVENTIONS.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Architecture vocabulary        | [.claude/skills/improve-codebase-architecture/](./.claude/skills/improve-codebase-architecture/) — Module / Interface / Seam / Adapter language + deletion test. **Read [CONTEXT.md](./CONTEXT.md) (domain glossary) and any relevant [docs/adr/](./docs/adr/) entries before designing any new feature.** Use the skill via `/improve-codebase-architecture` for retrospective deepening reviews.                                                                                                                                                                                   |
| Design tokens & UI rules       | [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Security & threat model        | [SECURITY.md](./SECURITY.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Roadmap & status               | [ROADMAP.md](./ROADMAP.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Deferred features              | [BACKLOG.md](./BACKLOG.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| OpenAPI spec                   | [docs/openapi.yaml](./docs/openapi.yaml)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Phone Footprint — plan         | [docs/plans/phone-footprint-v2.md](./docs/plans/phone-footprint-v2.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Phone Footprint — ops config   | [docs/ops/phone-footprint-config.md](./docs/ops/phone-footprint-config.md) — env vars, feature flags, Stripe prices, vendor setup, UI integration points. **Check here first for any UI toggle, flag flip, or key integration question.**                                                                                                                                                                                                                                                                                                                                            |
| Breach Defence — plan          | [docs/plans/breach-defence-suite.md](./docs/plans/breach-defence-suite.md) — 19-PR build sequence (F1–F11), migration renumbering (v80–v86), spec-vs-codebase corrections. **Currently paused after PR 2** (#46 + #47 shipped, schema live in prod, all flags OFF) — see §1b "Pause notes" before resuming. The detailed source spec lives in PR #46's description.                                                                                                                                                                                                                  |
| Reddit Intel — plan            | [docs/plans/reddit-intel.md](./docs/plans/reddit-intel.md) — 13-brief narrative-extraction pipeline over the existing Reddit scrape (Sonnet 4.6 classifier + Voyage embeddings + greedy pgvector clustering + dashboard widget + weekly email + B2B `/api/v1/intel/*`). **Code-complete 2026-05-02**, all 14 PRs in main, gated by `FF_REDDIT_INTEL_INGEST` etc. Cost cap A\$10/day enforced via `feature_brakes.reddit_intel`; errors land in `cost_telemetry WHERE feature='reddit-intel-error'`.                                                                                  |
| Charity Check — ops config     | [docs/ops/charity-check-config.md](./docs/ops/charity-check-config.md) — env vars, feature flags, GitHub Actions variables, scraper schedule, smoke-test checklist. v0.1+v0.2a code-complete + merged 2026-05-02; `acnc_charities` table populated (63,637 rows, weekly source / daily scraper). Consumer surface gated by `NEXT_PUBLIC_FF_CHARITY_CHECK` (default OFF) — flip on Vercel preview to drive `/charity-check`. v0.2c (PFRA + Scamwatch), v0.2d (behavioural micro-flow), v0.2e (main-checker hook), v0.2b (image OCR) tracked in BACKLOG.md → Charity Legitimacy Check. |
| Grants & Funding — drafts      | [docs/grants/](./docs/grants/) — application narratives. Currently: `aea-seed-narrative.md` (AEA Seed, blocked on UNSW/Parwada partnership). Active items in BACKLOG.md → `Grants & Funding`.                                                                                                                                                                                                                                                                                                                                                                                        |
| Policy submissions — templates | [docs/policy/](./docs/policy/) — reusable submission skeletons. Currently: `spf-submission-template.md` (Treasury / ACCC / ACMA SPF subordinate-rules; sovereign-tech-advocate framing). Active filings + watch items in BACKLOG.md → `Policy & Regulatory Submissions`.                                                                                                                                                                                                                                                                                                             |

> **Database hygiene note.** BACKLOG.md → `Database Hygiene & SPF Readiness`
> tracks the deferred items from the 2026-04-23 advisor audit: 177 unused
> indexes, 21 empty partitioned shadows, 16 `USING (true)` RLS rewrites,
> multiple-permissive-policy consolidation, `pg_trgm` extension relocation,
> and the Phase 1 commercial tables (`cases`, `audit_log`, `evidence`,
> `spf_principle_events`, `api_usage_log` partitioning, webhook ledger,
> tenant residency). Migration v78 clears the P0 advisor ERRORs only —
> everything else lives there.

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

| Decision            | Choice                                                                                          | Rationale                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Package manager     | pnpm                                                                                            | Fast, strict, workspace support                                                                   |
| Build orchestration | Turborepo                                                                                       | Caching, parallel builds                                                                          |
| Web framework       | Next.js 16 (Turbopack)                                                                          | SSR, API routes, Vercel deployment                                                                |
| AI model            | Claude Haiku 4.5                                                                                | Fast, cost-effective for classification                                                           |
| Database            | Supabase (PostgreSQL)                                                                           | Managed, RPC support, auth                                                                        |
| Cache / Rate limit  | Upstash Redis                                                                                   | Serverless-compatible                                                                             |
| Extension framework | WXT                                                                                             | Cross-browser, modern DX                                                                          |
| Mobile framework    | Expo 54                                                                                         | Cross-platform, OTA updates                                                                       |
| Bot formatting      | Per-platform formatters                                                                         | Telegram HTML, WhatsApp markdown, Slack Block Kit, Messenger plain text                           |
| Background jobs     | Inngest                                                                                         | Event-driven, cron, fan-out                                                                       |
| Analytics           | Plausible                                                                                       | Privacy-first, no cookies                                                                         |
| Email               | Resend + React Email                                                                            | Modern transactional email                                                                        |
| Billing             | Stripe                                                                                          | Direct billing, Stripe Tax for AU GST                                                             |
| Bot queue dispatch  | Supabase Database Webhook (pg_net on `bot_message_queue` INSERT) + 10-min safety sweeper        | Event-driven, avoids polling cost; pg_net is unmetered on Supabase Pro                            |
| Cost observability  | `cost_telemetry` table (v62) + `logCost()` helper + `/admin/costs` dashboard + Telegram digests | Per-call AI/paid-API spend tagged by feature/provider; daily threshold alerts + weekly WoW digest |

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

45+ env vars defined in `turbo.json` `globalEnv`. Key groups:

- **Supabase**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_*`
- **AI**: `ANTHROPIC_API_KEY`
- **Redis**: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- **Storage**: `R2_*` (Cloudflare R2)
- **Email**: `RESEND_API_KEY`
- **Bots**: `TELEGRAM_*`, `WHATSAPP_*`, `SLACK_*`, `MESSENGER_*`
- **Extension**: `WXT_INBOXSDK_APP_ID`, `WXT_TURNSTILE_BRIDGE_URL` (optional local-dev override — defaults to `https://askarthur.au/extension-turnstile`), `WXT_FACEBOOK_ADS` (build-time flag for Facebook ad scanning content scripts), `WXT_URL_GUARD`, `WXT_SITE_AUDIT` (other extension feature flags)
- **Turnstile (extension registration bot-gate)**: `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
- **Admin**: `ADMIN_SECRET`
- **Billing**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_STRIPE_PRO_MONTHLY`, `NEXT_PUBLIC_STRIPE_PRO_ANNUAL`, `NEXT_PUBLIC_STRIPE_BUSINESS_MONTHLY`, `NEXT_PUBLIC_STRIPE_BUSINESS_ANNUAL`
- **Auth / feature flags**: `NEXT_PUBLIC_FF_AUTH`, `NEXT_PUBLIC_FF_FACEBOOK_ADS` (server-side gate matching WXT_FACEBOOK_ADS), `NEXT_PUBLIC_FF_MEDIA_ANALYSIS`, `NEXT_PUBLIC_FF_DEEPFAKE`, `NEXT_PUBLIC_FF_PHONE_INTEL` (see `packages/utils/src/feature-flags.ts` for the full list)
- **Analyze pipeline (Phase 2)**: `FF_ANALYZE_INNGEST_WEB` (server-side, no `NEXT_PUBLIC_` prefix). When `true`, `/api/analyze` emits `analyze.completed.v1` and durable Inngest consumers take over scam_reports / brand alerts / cost telemetry writes. When unset or `false`, the legacy waitUntil path runs. Canary separately from other flags.
- **Inngest**: `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` (existing; used by both the cron fans and the Phase 2 analyze consumers)
- **External APIs**: `SAFE_BROWSING_API_KEY`, `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN`, `OPENAI_API_KEY` (Whisper), `HIVE_API_KEY` (Facebook ad image scanning — pricing contract required), `REALITY_DEFENDER_API_KEY` + `RESEMBLE_AI_API_TOKEN` (deepfake detection), `ABN_LOOKUP_GUID` (ABR Web Services)
- **Bot webhook dispatch**: `SUPABASE_WEBHOOK_SECRET` (HMAC secret on `bot_message_queue` INSERT trigger — see `/api/bot-webhook/route.ts`)
- **Cost alerts**: `TELEGRAM_ADMIN_CHAT_ID` (personal chat ID via @userinfobot), `DAILY_COST_THRESHOLD_USD` (default 2)
- **Per-feature cost brakes**: `VULN_AU_ENRICHMENT_CAP_USD` (default 5), `REDDIT_INTEL_CAP_USD` (default 10), `PHONE_FOOTPRINT_CAP_USD` (default 5). When today's per-feature spend exceeds the cap, `cost-daily-check` upserts a `feature_brakes` row and the function early-returns until `paused_until` expires (24h). Phone Footprint sums Vonage `telco_api_usage` + `cost_telemetry`-tagged `phone_footprint`; the others read from `cost_telemetry` only. **Use bare numbers** (`5`, `10`) — non-numeric values silently disable the brake because `parseFloat("$10")` is `NaN`.

### Analyze request correlation

Clients submitting to `/api/analyze` can send an `Idempotency-Key` header (Stripe-style, ULID or any 8-255 char alphanumeric/dash/underscore). The server echoes it back as `X-Request-Id`, threads it into the Inngest event id, and persists it as `scam_reports.idempotency_key` (v73 migration). Replaying the same request with the same key is safe — the `create_scam_report` RPC's `ON CONFLICT` clause returns the original row id without inserting. Absent the header, the server generates a ULID and returns it for client-side correlation.
