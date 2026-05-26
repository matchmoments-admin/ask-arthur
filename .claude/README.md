# `.claude/` — the Ask Arthur harness

This is the index for everything in `.claude/`. The harness exists to make Claude Code sessions productive in this monorepo without breaking the codebase. Everything here is additive — nothing in `.claude/` ships in the application bundle.

Read the [root `CLAUDE.md`](../CLAUDE.md) for project conventions. This file documents the local harness only.

---

## Layout

```
.claude/
├── README.md                  # this file
├── settings.json              # committed hook configuration (team-wide)
├── settings.local.json        # gitignored personal overrides
├── hooks/                     # deterministic gates + advisory reviewers
│   ├── branch-check.sh        # PreToolUse — fresh-branch-off-main rule
│   ├── run-reviewer.sh        # PostToolUse dispatcher
│   ├── propose-claudemd-update.sh  # Stop — advisory CLAUDE.md proposals
│   └── reviewers/
│       ├── db-migration.sh
│       ├── cron-impact.sh
│       ├── flag-governance.sh
│       ├── cost-telemetry-instrumentation.sh
│       └── rls-and-tenant-isolation.sh
├── skills/                    # project-specific skill modules
│   ├── improve-codebase-architecture/    # Module/Interface/Seam vocabulary
│   ├── grill-with-docs/                  # plan-stress-testing skill + STACK-PINS
│   └── system-map/                       # quick reference for deployed surface
├── agents/                    # project-specific subagent definitions
│   └── cost-telemetry-auditor.md
└── plugins/                   # external plugin installs (per-developer)
```

The MCP server config lives at `../.mcp.json` (gitignored) with the committable template at `../.mcp.json.example`.

---

## Hooks

| Event        | Script                       | Purpose                                                                                                                                                                                             |
| ------------ | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PreToolUse   | `branch-check.sh`            | Enforce "fresh branch off main" rule once per session                                                                                                                                               |
| PostToolUse  | `run-reviewer.sh`            | Dispatch to advisory reviewers (below) based on edited file path. Advisory only — exit 0 always.                                                                                                    |
| Stop         | `propose-claudemd-update.sh` | If session contains a `fix(…)` / `correct…` commit, propose a rule for the most-touched directory's CLAUDE.md. Advisory only — no file writes. Checks `stop_hook_active` to prevent infinite loops. |
| SessionStart | inline command               | Clean up stale `/tmp/.claude-branch-checked-*` markers                                                                                                                                              |

All hooks are PURE BASH (+ python3 for JSON parsing). No LLM invocations. ≤5s budget per reviewer.

### Adding a new advisory reviewer

The pattern is established and proven — reuse it, don't reinvent.

1. Create `.claude/hooks/reviewers/<name>.sh`. Model on the shortest existing reviewer (`flag-governance.sh`, 88 lines) — pure bash, reads `file_path` + `rel_path` from args, builds a `findings=()` array via grep, emits markdown to stdout, exits 0 unconditionally.
2. `chmod +x` the script.
3. Add a `case "$rel_path" in` matcher to `run-reviewer.sh` that adds your reviewer name to `applicable=()` when the path matches.
4. Smoke-test with both a positive case (reviewer should fire) and a negative case (silent pass).

**Severity tags inside findings** — use the same set as the existing reviewers: `**BLOCK_RECOMMENDED**`, `**ADVISORY**`, `**REMINDER**`. These are conventions for the model reading the output; the hook itself never blocks.

---

## Reviewers (PostToolUse, advisory-only)

| Reviewer                            | Triggers on                                                                             | Checks                                                                                                                                                                                                                                                                           |
| ----------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db-migration.sh`                   | `supabase/migrations/*`, `pipeline/scrapers/*`                                          | `SET statement_timeout = 0`, large unchunked writes on hot tables, HNSW/GIN on hot tables (ADR-0005), PL/pgSQL `#variable_conflict use_column` and SECURITY-INVOKER `search_path` rules                                                                                          |
| `cron-impact.sh`                    | `apps/web/app/api/cron/*`, `apps/web/vercel.json`, `packages/scam-engine/src/inngest/*` | Cron route changes against the watchdog 10-min budget                                                                                                                                                                                                                            |
| `flag-governance.sh`                | `packages/utils/src/feature-flags.ts`                                                   | Default-ON consumer flags, quoted `*_CAP_USD` values (NaN brakes), missing `server-only` markers, system-map updates                                                                                                                                                             |
| `cost-telemetry-instrumentation.sh` | `apps/web/app/api/**/*.ts`                                                              | Paid-API client imports (Anthropic / Resend / Twilio / Vonage / APIVoid / IPQS / AbuseIPDB / VirusTotal / HIBP / URLScan / S3) without any `logCost` / `cost-telemetry` / `feature_brakes` reference                                                                             |
| `rls-and-tenant-isolation.sh`       | `apps/web/**/*.ts(x)`, `packages/**/*.ts(x)` (excluding worker tier)                    | `createServiceClient` outside the allowed worker tier (`apps/web/app/api/**`, `packages/scam-engine/`, `packages/supabase/`). Forbidden in: server components, pages, layouts, middleware, `apps/web/lib/`. See [`packages/supabase/CLAUDE.md`](../packages/supabase/CLAUDE.md). |

**Known issue:** `db-migration.sh`'s `supabase/migrations/*` matcher doesn't match the actual file layout (`supabase/migration-v<N>-*.sql` directly under `supabase/`). The reviewer's Python-scraper checks (case 7 in its body) DO fire because `pipeline/scrapers/*.py` is correct. The migration checks themselves currently never fire. Tracked as a follow-up; not in scope of this PR to fix because changing the matcher would surface advisory noise on every migration edit (behaviour change to an advisory reviewer that's been silent).

---

## Skills (project-scoped, in `.claude/skills/`)

| Skill                            | What it owns                                                                                                                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `improve-codebase-architecture/` | Module / Interface / Seam / Adapter vocabulary + the deletion test. The canonical architectural-review skill.                                                                                                                   |
| `grill-with-docs/`               | Plan-stress-testing skill. Cross-references `CONTEXT.md` + `docs/adr/`. Includes `STACK-PINS.md` documenting the installed-version drift hazards for React 19 / Next 16 / Zod 4 / Expo 54 / WXT / Supabase JS v2 / Inngest SDK. |
| `system-map/`                    | Quick reference for the deployed-surface map (web routes / DB tables / cron jobs / feature flags).                                                                                                                              |

These are PROJECT-SCOPED skills (live in `.claude/skills/` here). User-scoped skills like `local-ultrareview`, `handoff`, `zoom-out`, `to-issues`, `to-prd`, `write-a-skill`, `diagnose`, `blog`, etc. live at `~/.claude/skills/` and are shared across projects.

---

## Subagents (project-scoped, in `.claude/agents/`)

| Agent                       | Purpose                                                                                                                                                                  | Tools / Model              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| `cost-telemetry-auditor.md` | Read-only scan for paid-API call sites missing `logCost` / `feature_brakes` guards. Use weekly or before any release touching scam-engine / pipeline / new Claude paths. | Read / Grep / Glob — Haiku |

For codebase exploration / research, use the built-in `Explore` agent. For multi-perspective code review, use the user-scoped `/local-ultrareview` skill.

---

## Per-developer setup (not committed)

### TypeScript LSP

```
/plugin install typescript-lsp@anthropics-claude-code
```

Required for accurate type diagnostics + cross-package go-to-definition. Per-developer choice; not committed config. Requires `typescript-language-server` on `PATH` — installed via `pnpm install` at the workspace root.

### `.mcp.json`

Copy `../.mcp.json.example` to `../.mcp.json` (gitignored), then export `SUPABASE_ACCESS_TOKEN` in your shell (`.zshrc` / `.zprofile`). The Supabase MCP server runs in `--read-only` mode by default — for write access on a personal dev branch, create a `.mcp.json.local` override with the unrestricted shape.

Generate a Supabase access token at https://supabase.com/dashboard/account/tokens (it's scoped to your dashboard account, not the project).

---

## Related docs

| Looking for                                     | Where                                                                                                                                                                                                 |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project conventions + ship workflow             | [root `CLAUDE.md`](../CLAUDE.md)                                                                                                                                                                      |
| Architectural vocabulary                        | [`.claude/skills/improve-codebase-architecture/LANGUAGE.md`](./skills/improve-codebase-architecture/LANGUAGE.md)                                                                                      |
| Library version pins                            | [`.claude/skills/grill-with-docs/STACK-PINS.md`](./skills/grill-with-docs/STACK-PINS.md)                                                                                                              |
| Per-package sub-CLAUDE.md files                 | `apps/web/CLAUDE.md`, `packages/scam-engine/CLAUDE.md`, `packages/bot-core/CLAUDE.md`, `packages/supabase/CLAUDE.md`, `packages/types/CLAUDE.md`, `supabase/CLAUDE.md`, `pipeline/scrapers/CLAUDE.md` |
| ADRs                                            | [`docs/adr/`](../docs/adr/)                                                                                                                                                                           |
| System map (web / db / workers / flows / flags) | [`docs/system-map/`](../docs/system-map/)                                                                                                                                                             |

---

## What lives elsewhere

- **User-scoped skills** (`handoff`, `zoom-out`, `local-ultrareview`, `to-issues`, `to-prd`, `write-a-skill`, etc.) → `~/.claude/skills/`
- **User memory** → `~/.claude/projects/-Users-brendanmilton-Desktop-safeverify/memory/`
- **Plan files** → `~/.claude/plans/`
- **Plugin installs** → `~/.claude/plugins/`
- **MCP server config** → `../.mcp.json` (gitignored) + `../.mcp.json.example` (committed template)

The user-scoped surfaces are NOT shared via this repo — they live in the developer's home directory and persist across projects.
