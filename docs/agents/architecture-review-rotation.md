# Weekly Architecture Review — Rotation

A Claude Code Routine (`Weekly Architecture Review`, runs Mondays 08:00 AEST) applies the [`improve-codebase-architecture`](../../.claude/skills/improve-codebase-architecture/SKILL.md) skill to one module per week and opens a draft issue with the findings. This file explains the rotation so a human browsing the repo can predict (or override) what's coming.

## How the routine picks

The routine computes `date +%V` (ISO week number) and takes `week_num % 6` to index into the table below.

| Index | Module                     | Path                                    |
| ----- | -------------------------- | --------------------------------------- |
| 0     | scam-engine                | `packages/scam-engine/`                 |
| 1     | api routes                 | `apps/web/app/api/`                     |
| 2     | RSC pages (excluding api/) | `apps/web/app/`                         |
| 3     | breach-defence             | `packages/breach-defence/`              |
| 4     | scrapers                   | `pipeline/scrapers/`                    |
| 5     | bot-core + utils           | `packages/bot-core/`, `packages/utils/` |

## Why these six

These are the workspace packages where domain logic concentrates, ranked by the surface area the founder actually touches week-to-week. Hot paths get rotated through ahead of leaf utilities. The rotation deliberately excludes:

- `packages/types`, `packages/supabase` — thin reflection of external schemas; almost no judgment lives here.
- `apps/extension`, `apps/mobile` — shipped less frequently, lower-leverage to deepen.
- `tooling/typescript`, `supabase/` migrations — config / data, not code with judgment.

These can be added later if a deepening pass exposes a real seam worth investigating.

## Output

Each run creates one GitHub issue tagged `needs-triage` + `architecture-review` containing 3–7 ranked deepening opportunities. The founder triages the issue Monday morning. Items worth acting on become separate `ready-for-agent` issues; the rest can be closed as `wontfix` or left for re-evaluation later.

The routine never edits code, opens PRs, or closes existing issues. It is purely a read-only deepening pump that lands findings as a triageable artefact.

## Overriding the rotation

If a particular week wants a different module (e.g. you just landed a big refactor on `packages/scam-engine` and want the next pass on `apps/web/app/api` instead), edit the routine prompt directly for that run. The rotation is intentionally hardcoded in the prompt — there's no override file because that would add a second moving part for a once-a-week routine.

## Related

- Skill: [`.claude/skills/improve-codebase-architecture/`](../../.claude/skills/improve-codebase-architecture/)
- Architecture vocabulary: [`LANGUAGE.md`](../../.claude/skills/improve-codebase-architecture/LANGUAGE.md) — Module / Interface / Seam / Adapter
- Triage labels: [`triage-labels.md`](./triage-labels.md)
- Domain glossary: [`CONTEXT.md`](../../CONTEXT.md)
