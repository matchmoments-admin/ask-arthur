# Project Notes — Ask Arthur monorepo

Project-specific addendum to this skill. Read after `SKILL.md` and `LANGUAGE.md`. Names things consistently with our package layout so suggestions don't drift into generic "service / handler" framing.

## Where modules live

- Each `packages/@askarthur/*` package is a natural **module**. Its `src/index.ts` (or the explicit subpath exports listed in `package.json`) is its **interface**.
- `apps/web/app/api/*/route.ts` handlers are **adapters** at the HTTP **seam**. They translate request → call to a package module → response. The Module under test is rarely the route — it's what the route calls.
- `supabase/migration-v*.sql` files define the data-layer **interface**. The interface includes RLS policies, triggers, and RPC signatures — not just table shapes. A migration that adds a check constraint is an interface change.
- Inngest functions in `packages/scam-engine/src/inngest/` (and any future `*/inngest/` directories) are **adapters** at the event seam. The event payload schema is the interface.
- `pipeline/scrapers/` (Python) is its own module per scraper. Storage handoff to Supabase is the seam.

## Existing multi-adapter seams worth recognising

These already pass the "≥2 adapters = real seam" test. Don't suggest collapsing them:

- **Bot formatter seam** — `packages/bot-core/src/format-*.ts` has Telegram (HTML), WhatsApp (markdown), Slack (Block Kit), Messenger (plain text). Four adapters behind a shared formatter contract.
- **Supabase client seam** — `packages/supabase` exposes server / server-auth / middleware / browser factories. Four adapters because each runtime context has a distinct cookie/auth model.
- **Scanner seam** — `@askarthur/extension-audit` and `@askarthur/mcp-audit` both produce `UnifiedScanResult`. Two adapters.

## Likely shallow areas worth a deletion test

Hypotheses, not conclusions — confirm with the deletion test before recommending. Listed here so the Explore phase has somewhere to start; real friction may live elsewhere.

- Single-use wrapper helpers around Claude SDK / Resend / Stripe / Twilio that exist in one `packages/scam-engine/src/*.ts` file and are called from one place.
- `apps/web/lib/*` utilities that thinly re-export `@askarthur/utils` functions — adding indirection without depth.
- The `analyze*` family in `packages/scam-engine` — multiple entry points (`analyze`, `analyzeWithClaude`, `analyzeForBot`) that may or may not earn their separate interfaces.

## Cost-aware notes

- `INTERFACE-DESIGN.md` step 2 fans out 3–4 parallel sub-agents per chosen candidate. Before invoking it, surface the estimated token spend (Sonnet × 3–4) so the user can opt in. Our project has a `cost_telemetry` table and explicit per-feature brakes (e.g. `feature_brakes.reddit_intel` at A$10/day) — that discipline applies here too.
- The Explore agent in step 1 is cheap (one parallel agent). Always use it; don't try to grep manually.

## When "deepening" might conflict with shipped intent

Some shallow modules in this repo are deliberate, usually because the SQL migration / RPC pair is the real interface and the TypeScript wrapper is a thin adapter. Examples:

- `create_scam_report` RPC + the helper that calls it — the RPC's `ON CONFLICT` handles idempotency; collapsing the wrapper into callers would scatter the idempotency-key plumbing.
- The `feature_flags` Postgres table + the `featureFlags` helper — the helper exists so server and client read the same source of truth across runtimes.

If a deepening candidate would dissolve a TypeScript wrapper around a Postgres-side interface, flag the SQL side as the real **interface** and ask whether the deepening should pull more logic _into_ SQL (deeper RPC) or _out of_ SQL (logic moves up). Both are valid — neither is "remove the wrapper for tidiness."

## Domain vocabulary

The domain glossary is at `/CONTEXT.md` (repo root). Read it before step 2. If a candidate names something not in the glossary, follow the SKILL.md instruction to add the term inline rather than coining a fresh one.
