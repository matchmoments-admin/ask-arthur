# packages/scam-engine — local guide

Scoped guidance for the scam-engine package — Claude AI integration, threat enrichment, and Inngest durable consumers. Read this in addition to the [root CLAUDE.md](../../CLAUDE.md).

## What this package owns

- **Claude integration** — `claude.ts`, `anthropic.ts`, `analyze-core.ts`
- **Enrichment helpers** — Google Safe Browsing, VirusTotal, AbuseIPDB, IPQS, URLScan, HIBP, CT-log lookups
- **Pipeline writes** — `pipeline.ts` (scrubs PII, normalises, calls RPCs to persist scam reports / entities / wallets / IPs)
- **Inngest durable functions** — under `src/inngest/` (28+ functions: enrichment, cron, retention, embeddings, brand alerts)
- **Sub-domain modules** — `news-intel/`, `phone-footprint/`
- **SSRF guard** — `ssrf-guard.ts` exports `assertSafeURL` and `filterSafeURLs` (the canonical SSRF defence — used by Slack handler, persona-check, etc.)

## What it doesn't own

- **Verdict merge logic** — lives in `@askarthur/core-analysis` (`mergeVerdict`, `runAnalysisCore`). Don't duplicate URL-escalation or injection-floor rules here.
- **Bot formatting** — lives in `@askarthur/bot-core` (per-platform formatters, `analyzeForBot`).
- **Type definitions** — Zod schemas + interfaces live in `@askarthur/types`. Add new public shapes there, not here.

## Public API surface (key exports)

| Export                     | Purpose                                             | Consumers                                             |
| -------------------------- | --------------------------------------------------- | ----------------------------------------------------- |
| `analyzeWithClaude`        | Single-shot Claude analysis call                    | core-analysis, route handlers                         |
| `storeVerifiedScam`        | Persist a verified scam via `pipeline.ts`           | analyze + bot-core                                    |
| `assertSafeURL`            | SSRF defence — throws on private IP / metadata host | Slack handler, persona-check, any outbound fetch path |
| `filterSafeURLs`           | Silent drop of unsafe URLs from a list              | Safe Browsing / Twilio enrichment                     |
| `scrubPII`                 | Email / phone redaction before persistence          | persona-check, pipeline                               |
| `*` from `./inngest/index` | All durable functions (cron + event-driven)         | `apps/web/inngest/`                                   |

## Scoped commands

```bash
pnpm --filter @askarthur/scam-engine test
pnpm --filter @askarthur/scam-engine test ssrf-guard
```

Package tests live under `src/__tests__/` and `src/inngest/__tests__/`. There is no separate typecheck script; `pnpm --filter @askarthur/web typecheck` will surface any contract breakage because web consumes most exports.

## Gotchas

- **`scamPipeline.test.ts` sometimes times out on vitest forks** (pre-existing, low-priority flake). Re-run on its own with `--no-file-parallelism` if needed.
- **Inngest functions are durable but the IDs are stable** — changing a function name or step name resets the state machine for in-flight runs. Coordinate via a feature flag if you need to rename.
- **Embeddings live on sibling tables, not parent tables** — see ADR-0005 + the `acnc_charity_embeddings` pattern. Never add HNSW to a write-frequent parent (`scam_reports`, `verified_scams`, `acnc_charities`).
- **Cost-tagged spend uses `logCost()`** from `./cost-log` (the in-package sink — `packages/scam-engine/src/cost-log.ts`), NOT `@askarthur/utils/cost-telemetry` (that export does not exist; scam-engine cannot import apps/web's logCost either — wrong dependency direction). Every paid-API call should tag `feature` + `provider`. Untagged spend doesn't show up in the `/admin/costs` dashboard or weekly Telegram digest. For free-tier APIs, still log `units` with `estimatedCostUsd: 0` so volume/ceiling is visible. The brake check is `isFeatureBraked(feature)` from the same module.
- **PL/pgSQL function pitfalls** when adding RPCs from this package: see "PL/pgSQL function gotchas" in the root CLAUDE.md (search_path = '' hides extension operators; `#variable_conflict use_column` needed when OUT params shadow column names).

## Where things live

| Looking for                                    | Where                                                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Verdict-merge logic                            | `packages/core-analysis/src/verdict.ts`                                                  |
| Inngest function index                         | [`docs/system-map/background-workers.md`](../../docs/system-map/background-workers.md)   |
| Embeddings policy                              | [`docs/adr/0005-pgvector-index-policy.md`](../../docs/adr/0005-pgvector-index-policy.md) |
| Clone-detection signal model + source layering | ADR-0015 + ADR-0016                                                                      |
