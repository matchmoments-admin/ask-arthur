# Code Conventions

Standards and patterns for the Ask Arthur monorepo. All contributors (human and AI) should follow these.

---

## Language & Runtime

| Tool       | Version | Notes                     |
| ---------- | ------- | ------------------------- |
| TypeScript | 5.x     | Strict mode, all packages |
| Node.js    | 22 LTS  | Minimum runtime target    |
| Python     | 3.11+   | Pipeline scrapers only    |
| React      | 19      | Web + extension + mobile  |

## Package Manager

- **pnpm** with workspaces (`pnpm-workspace.yaml`)
- Lockfile: `pnpm-lock.yaml` (always committed)
- `.npmrc`: `shamefully-hoist=true`, `strict-peer-dependencies=false`, `package-import-method=copy`
- Never use `npm` or `yarn` in this repo

## Monorepo Commands

```bash
# Build & test
pnpm turbo build              # Build all packages + apps
pnpm turbo test               # Run all Vitest suites
pnpm turbo typecheck           # Type-check all packages
pnpm turbo lint                # ESLint across repo

# Dev servers
pnpm --filter @askarthur/web dev         # Next.js dev
pnpm --filter @askarthur/extension dev   # WXT extension dev
pnpm --filter @askarthur/mobile dev      # Expo dev

# Single-package builds
pnpm --filter @askarthur/web build
pnpm --filter @askarthur/bot-core test

# Pipeline (Python)
cd pipeline/scrapers && python -m pytest tests/ -v
```

## Import Patterns

All cross-package imports use the `@askarthur/*` scope (no hyphen):

```typescript
// Types (Zod schemas, TS interfaces)
import type { AnalysisResult } from "@askarthur/types";
import { AnalysisRequestSchema } from "@askarthur/types";

// Supabase client factories
import { createServiceClient } from "@askarthur/supabase/server";
import { createBrowserClient } from "@askarthur/supabase/browser";

// Utilities
import { logger } from "@askarthur/utils/logger";
import { checkRateLimit } from "@askarthur/utils/rate-limit";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { hashString } from "@askarthur/utils/hash";

// Scam engine
import { analyzeWithClaude } from "@askarthur/scam-engine/claude";
import { storeVerifiedScam } from "@askarthur/scam-engine/pipeline";
import { checkSafeBrowsing } from "@askarthur/scam-engine/safebrowsing";
import { resolveRedirects } from "@askarthur/scam-engine/redirect-resolver";
import { normalizeUrl } from "@askarthur/scam-engine/url-normalize";
import { inngestClient } from "@askarthur/scam-engine/inngest/client";
import { inngestFunctions } from "@askarthur/scam-engine/inngest/functions";

// Bot core
import { analyzeForBot } from "@askarthur/bot-core/analyze";
import { toTelegramMessage } from "@askarthur/bot-core/format-telegram";
import { toSlackBlocks } from "@askarthur/bot-core/format-slack";
import { verifyTelegramSecret } from "@askarthur/bot-core/webhook-verify";
import { enqueueMessage } from "@askarthur/bot-core/queue";
```

Within the web app, use the `@/` alias for local imports:

```typescript
import { validateApiKey } from "@/lib/apiAuth";
import { verifyAdminToken } from "@/lib/adminAuth";
```

## Naming Conventions

### Files & Directories

| Context          | Convention             | Example                                                 |
| ---------------- | ---------------------- | ------------------------------------------------------- |
| React components | PascalCase             | `VerdictBadge.tsx`, `ResultDisplay.tsx`                 |
| Utility modules  | kebab-case             | `rate-limit.ts`, `feature-flags.ts`, `url-normalize.ts` |
| API routes       | kebab-case directories | `api/scam-urls/lookup/route.ts`                         |
| Test files       | `*.test.ts`            | `format-slack.test.ts`, `webhook-verify.test.ts`        |
| Types-only files | kebab-case             | `email-scan.ts`, `extension.ts`                         |
| Python scrapers  | snake_case             | `phishing_army.py`, `phishing_database.py`              |

### TypeScript

| Element          | Convention            | Example                                         |
| ---------------- | --------------------- | ----------------------------------------------- |
| Interfaces/Types | PascalCase            | `AnalysisResult`, `BotMessage`, `QueuedMessage` |
| Zod schemas      | PascalCase + `Schema` | `AnalysisRequestSchema`                         |
| Functions        | camelCase             | `analyzeWithClaude()`, `checkRateLimit()`       |
| Constants        | UPPER_SNAKE           | `VERDICT_EMOJI`, `MAX_TOKENS`                   |
| Env vars         | UPPER_SNAKE           | `ANTHROPIC_API_KEY`, `UPSTASH_REDIS_REST_URL`   |
| Boolean vars     | `is`/`has` prefix     | `isActive`, `hasReachedLimit`                   |

### Database (Supabase)

- Tables: `snake_case` plural (`verified_scams`, `scam_urls`, `api_keys`)
- Columns: `snake_case` (`created_at`, `confidence_score`, `brand_impersonated`)
- RPC functions: `snake_case` verb prefix (`increment_check_stats`, `mark_stale_urls`)
- Views: `snake_case` descriptive (`threat_intel_entities`, `financial_impact_summary`)
- Migrations: 44 files (`supabase/migration.sql` through `migration-v44-scam-feed.sql`)

### Python scrapers — layout

Scrapers under `pipeline/scrapers/` use one of two layouts depending on whether they're standalone or part of a related group:

| When                                               | Layout                                                                                           | Invocation                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------- |
| Standalone source (one feed, one file)             | Flat top-level `<source>.py`                                                                     | `python -m crtsh`                      |
| Grouped sources (≥2 related feeds sharing helpers) | Subdir `<group>/` with `__init__.py`, `common.py` for shared helpers, one `<source>.py` per feed | `python -m ransomware_dls.dragonforce` |

**Examples:**

- Flat (existing convention): `crtsh.py`, `abuseipdb.py`, `phishstats.py`, `urlhaus.py`
- Grouped (Breach Defence Suite onward): `ransomware_dls/{dragonforce.py, akira.py, qilin.py, …, common.py}`, `oaic_ndb/oaic_ndb.py`, `class_actions/{auslii.py, oaic_complaints.py, firms.py, common.py}`

Existing flat scrapers stay flat. Don't migrate them retroactively — only adopt subdirs when introducing a new group of ≥2 related feeds.

**JSONB-returning RPC pattern** (used in v38–v40 government reporting RPCs):

```sql
CREATE OR REPLACE FUNCTION get_threat_intel_export(
  p_entity_type TEXT DEFAULT NULL,
  p_risk_level TEXT DEFAULT NULL,
  p_limit INT DEFAULT 100,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'total_count', (SELECT COUNT(*) FROM ...),
    'limit', p_limit,
    'offset', p_offset,
    'data', COALESCE((SELECT jsonb_agg(...) FROM ... LIMIT p_limit OFFSET p_offset), '[]'::jsonb)
  );
END;
$$;
```

## Code Style

### Linting

- **ESLint 9** flat config (`eslint.config.mjs`)
- Extends: `eslint-config-next/core-web-vitals`, `eslint-config-next/typescript`
- **No Prettier** — ESLint handles formatting concerns
- Ignores: `.next/**`, `out/**`, `build/**`

### TypeScript Strict Rules

- Always use `import type` for type-only imports
- Prefer `interface` over `type` for object shapes (unless union/intersection needed)
- No `any` — use `unknown` with type guards if needed
- Zod schemas for runtime validation at API boundaries

### React

- Functional components only (no class components)
- Server Components by default in Next.js App Router
- `"use client"` directive only when needed (interactivity, hooks, browser APIs)
- `ssr: false` in `next/dynamic` is NOT allowed in Server Components

### Icons — Lucide

All apps use [Lucide](https://lucide.dev) for icons:

- **Web + Extension:** `lucide-react` — inline SVG components, tree-shakeable
- **Mobile:** `lucide-react-native` — uses `color` prop instead of className

**Usage:**

```tsx
// Web / Extension
import { ShieldCheck } from "lucide-react";
<ShieldCheck className="text-deep-navy" size={18} />;

// Mobile
import { ShieldCheck } from "lucide-react-native";
<ShieldCheck size={18} color={Colors.primary} />;

// Config-driven (type-safe)
import type { LucideIcon } from "lucide-react";
const CONFIG: Record<string, { icon: LucideIcon }> = {
  SAFE: { icon: ShieldCheck },
};
<config.icon className="text-white" size={24} />;
```

### Error Handling

- API routes: always return structured JSON errors with appropriate status codes
- Supabase: `createServiceClient()` returns `null` when env vars missing — always check
- Production: fail-closed (block request if service unavailable)
- Development: fail-open for non-critical services (rate limiting, etc.)

## Testing

### Framework

- **Vitest** for all TypeScript tests
- `vitest.config.ts` in each testable package
- Test environment: `node`
- Web app tests use path aliases (`@/` → project root, `server-only` → mock)

### Patterns

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";

// Environment mocking
beforeEach(() => {
  vi.stubEnv("SOME_SECRET", "test-value");
});

// Module mocking
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(),
}));

// Test data factories
const makeResult = (
  overrides: Partial<AnalysisResult> = {},
): AnalysisResult => ({
  verdict: "HIGH_RISK",
  confidence: 0.88,
  summary: "This is a phishing attempt",
  redFlags: ["Suspicious URL", "Urgency language"],
  nextSteps: ["Do not click links", "Report to authorities"],
  scamType: "phishing",
  channel: "email",
  ...overrides,
});
```

### What to Test

- Formatting output for each bot platform (emoji, markdown, HTML escaping)
- Webhook signature verification (HMAC-SHA256, replay attack prevention)
- Input validation and boundary conditions
- Error states (missing env vars, service unavailable)

### Python Tests

- **pytest** for pipeline scrapers
- Located in `pipeline/scrapers/tests/`
- Run: `cd pipeline/scrapers && python -m pytest tests/ -v`

## Git Conventions

### Commit Messages

Imperative mood, feature-focused. No conventional-commits prefix required.

```
# Good
Add Gmail email scanning to Chrome extension (Phase 2)
Fix blog index: remove hero button, left-align categories
Security & SEO fixes: cookie-based admin auth, Unicode sanitization

# Bad
feat: added email scanning
fixed the blog
updates
```

### Branch Strategy

- `main` — production branch, always deployable
- Feature branches off `main` for non-trivial changes
- Direct commits to `main` acceptable for small fixes

## Environment Variables

- Never commit `.env` files
- All required env vars listed in `turbo.json` `globalEnv` array (45+ variables)
- Supabase, Anthropic, Upstash, R2, Telegram, WhatsApp, Slack, Resend, Twilio, etc.
- Feature flags via `@askarthur/utils/feature-flags`

## Deployment

- **Web app**: Vercel (root directory: `apps/web`)
- **Extension**: Manual build + Chrome Web Store upload
- **Mobile**: EAS Build (Expo Application Services)
- **Pipeline**: GitHub Actions (scheduled scraper runs)
- **Bots**: Webhook endpoints on Vercel (serverless)
