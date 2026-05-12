---
name: system-map
description: Answer questions about Ask Arthur's deployed surface (web routes, database tables, background workers, feature flags, canonical data flows) by reading docs/system-map/ instead of scanning the codebase. Use when the user asks "where does X live", "what runs at <time>", "what tables exist for <feature>", "what flag gates <surface>", or any other deployed-surface inventory question.
---

# Ask Arthur System Map

The repo has a living architecture map at [`docs/system-map/`](../../../docs/system-map/) — a hand-maintained inventory of every route, table, RPC, trigger, cron, Inngest function, scraper, feature flag, and canonical data flow.

## When this skill fires

The user asks any question whose answer is in the deployed surface, e.g.:

- "Where does the analyze pipeline write to?"
- "What runs at 03:30 UTC?"
- "Which tables are write-frequent / 'hot'?"
- "What `/api/v1/*` endpoints exist?"
- "Which feature flag gates the charity-check page?"
- "How many Inngest functions do we have?"
- "What's the canonical flow for bot dispatch?"

## How to answer

1. **Start at [`docs/system-map/README.md`](../../../docs/system-map/README.md)** — it has the ASCII diagram + a navigator pointing at the other 5 files.
2. **Pick the right sub-file** based on the question:
   - Routes / pages / `/api/*` → [`web-surface.md`](../../../docs/system-map/web-surface.md)
   - Tables / RPCs / triggers / RLS → [`database.md`](../../../docs/system-map/database.md)
   - Vercel crons / Inngest / scrapers / GH Actions → [`background-workers.md`](../../../docs/system-map/background-workers.md)
   - Feature flags / env vars / cost brakes → [`feature-flags.md`](../../../docs/system-map/feature-flags.md)
   - End-to-end flows (analyze, Reddit Intel, Phone Footprint refresh, Charity Check, Bot dispatch, Onward reporting) → [`data-flows.md`](../../../docs/system-map/data-flows.md)
3. **Answer from the map** — quote line numbers / file paths so the user can verify. Do **not** walk the codebase unless the map's answer is missing or stale.
4. **If the map seems stale** (the user contradicts it, or a recent PR isn't reflected), say so explicitly and then verify against the codebase. Update the map in a follow-up commit when you find drift.

## What this skill is NOT

- Not a substitute for ADRs (`docs/adr/`) — ADRs answer _why_ and _what's forbidden_, the map answers _what exists_.
- Not a substitute for `CONTEXT.md` — the glossary defines domain terms; the map describes deployed surface.
- Not a substitute for `CLAUDE.md` Critical Rules — those are constraints the map respects but doesn't replace.

## Maintenance

When you add or remove a route / table / cron / flag, update the matching `docs/system-map/*.md` file in the same PR. Single home per fact — never duplicate into `ARCHITECTURE.md` (retired) or `docs/plans/`.
