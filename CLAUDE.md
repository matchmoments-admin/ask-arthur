# Ask Arthur — Project Guide

Master reference for AI assistants and contributors working on this codebase. Start here, follow links for depth.

---

## Quick Reference

| What | Where |
|------|-------|
| Architecture & data flows | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| Code standards & patterns | [CONVENTIONS.md](./CONVENTIONS.md) |
| Design tokens & UI rules | [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) |
| Security & threat model | [SECURITY.md](./SECURITY.md) |
| Roadmap & status | [ROADMAP.md](./ROADMAP.md) |
| Deferred features | [BACKLOG.md](./BACKLOG.md) |
| OpenAPI spec | [docs/openapi.yaml](./docs/openapi.yaml) |

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
│   └── bot-core/               # @askarthur/bot-core — Bot formatters, webhook verify, queue
│
├── tooling/
│   └── typescript/             # @askarthur/tsconfig — Shared TS configs
│
├── pipeline/
│   └── scrapers/               # Python threat feed scrapers (14 feeds)
│
├── supabase/                   # Migration SQL files (v2–v19)
├── docs/                       # OpenAPI spec, setup guides
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
import { logger } from "@askarthur/utils/logger";
import { checkRateLimit } from "@askarthur/utils/rate-limit";
import { analyzeWithClaude } from "@askarthur/scam-engine/claude";
import { storeVerifiedScam } from "@askarthur/scam-engine/pipeline";
import { analyzeForBot } from "@askarthur/bot-core/analyze";
import { toTelegramMessage } from "@askarthur/bot-core/format-telegram";
import { TIER_LIMITS } from "@askarthur/types/billing";
```

Within the web app, use `@/` for local imports:

```typescript
import { validateApiKey } from "@/lib/apiAuth";
```

## Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Package manager | pnpm | Fast, strict, workspace support |
| Build orchestration | Turborepo | Caching, parallel builds |
| Web framework | Next.js 16 (Turbopack) | SSR, API routes, Vercel deployment |
| AI model | Claude Haiku 4.5 | Fast, cost-effective for classification |
| Database | Supabase (PostgreSQL) | Managed, RPC support, auth |
| Cache / Rate limit | Upstash Redis | Serverless-compatible |
| Extension framework | WXT | Cross-browser, modern DX |
| Mobile framework | Expo 54 | Cross-platform, OTA updates |
| Bot formatting | Per-platform formatters | Telegram HTML, WhatsApp markdown, Slack Block Kit, Messenger plain text |
| Background jobs | Inngest | Event-driven, cron, fan-out |
| Analytics | Plausible | Privacy-first, no cookies |
| Email | Resend + React Email | Modern transactional email |
| Billing | Paddle | Merchant-of-record, handles tax/compliance |

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

## Deployment

| Platform | Target | Config |
|----------|--------|--------|
| Web app | Vercel | Root: `apps/web`, Build: `cd ../.. && pnpm turbo build --filter=@askarthur/web` |
| Extension | Chrome Web Store | `pnpm --filter @askarthur/extension build && zip` |
| Mobile | App Store / Play Store | EAS Build via Expo |
| Pipeline | GitHub Actions | Scheduled cron, gated by `ENABLE_SCRAPER` |
| Bots | Vercel (webhooks) | Webhook URLs registered per platform |

## Environment Variables

45+ env vars defined in `turbo.json` `globalEnv`. Key groups:

- **Supabase**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_*`
- **AI**: `ANTHROPIC_API_KEY`
- **Redis**: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- **Storage**: `R2_*` (Cloudflare R2)
- **Email**: `RESEND_API_KEY`
- **Bots**: `TELEGRAM_*`, `WHATSAPP_*`, `SLACK_*`, `MESSENGER_*`
- **Extension**: `WXT_EXTENSION_SECRET`, `WXT_INBOXSDK_APP_ID`
- **Admin**: `ADMIN_SECRET`
- **Billing**: `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`, `NEXT_PUBLIC_PADDLE_ENV`, `PADDLE_PRO_PRICE_ID`, `PADDLE_ENTERPRISE_PRICE_ID`
- **External APIs**: `SAFE_BROWSING_API_KEY`, `TWILIO_*`
