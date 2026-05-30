# packages/bot-core — local guide

Scoped guidance for the bot-core package — per-platform message formatters, webhook signature verification, and the dispatch queue. Read this in addition to the [root CLAUDE.md](../../CLAUDE.md).

## What this package owns

- **Per-platform formatters** — `format-telegram.ts` (HTML), `format-whatsapp.ts` (markdown), `format-slack.ts` (Block Kit), `format-messenger.ts` (plain text + carousels).
- **`analyzeForBot`** — `analyze.ts`, the shared entry point bot route handlers call before formatting.
- **Webhook signature verification** — `webhook-verify.ts` (per-platform HMAC + timing-safe compare).
- **Dispatch queue helpers** — `queue.ts` (writes into `bot_message_queue`; actual webhook dispatch is via pg_net per ADR-0001).
- **Rate limiting** — `rate-limit.ts` (Redis-backed per-platform throttles).

## What it doesn't own

- **Webhook routing** — the `/api/webhooks/<platform>/route.ts` handlers live in `apps/web`. This package provides the formatters and verifiers they call.
- **Claude analysis** — `analyzeForBot` delegates into `@askarthur/scam-engine`. Don't import `anthropic` here.
- **Bot-side persistence** — writes to `scam_reports` go via `@askarthur/scam-engine`'s `storeVerifiedScam`. This package only produces messages.

## Critical rule: multi-platform consistency

**Any change to one platform formatter must update the other three OR include an explicit `// PLATFORM EXEMPT: <reason>` comment at the relevant lines.**

If you fix a phishing-URL display in `format-telegram.ts` and don't touch the other three, the WhatsApp / Slack / Messenger views silently drift. Snapshot-style tests under `src/__tests__/` (`format-*.test.ts`) cover the golden path per platform — extend all four files in the same commit when the shape changes.

## Public API surface (key exports)

| Export                     | Purpose                                                   | Consumers                               |
| -------------------------- | --------------------------------------------------------- | --------------------------------------- |
| `analyzeForBot`            | Shared analysis entry point for bot routes                | `apps/web/app/api/webhooks/*/route.ts`  |
| `toTelegramMessage`        | Render `AnalysisResult` to Telegram HTML                  | telegram webhook handler                |
| `toWhatsAppMessage`        | Render `AnalysisResult` to WhatsApp markdown              | whatsapp webhook handler                |
| `toSlackBlocks`            | Render `AnalysisResult` to Slack Block Kit JSON           | slack webhook handler                   |
| `toMessengerMessage`       | Render `AnalysisResult` to Messenger plain text           | messenger webhook handler               |
| `verifyTelegramSecret`     | Constant-time secret-token check (Telegram bot API)       | telegram route guard                    |
| `verifyWhatsAppSignature`  | Meta App X-Hub-Signature-256 verification (WhatsApp)      | whatsapp route guard                    |
| `verifySlackSignature`     | Slack signing-secret v0 signature verification            | slack route + shortcuts guards          |
| `verifyMessengerSignature` | Meta App X-Hub-Signature-256 verification (Messenger)     | messenger route guard                   |
| `safeStrEqual`             | Length-checked timing-safe string compare (no throw)      | verify-token handshakes + messenger sig |
| `enqueueBotReply`          | Insert a row into `bot_message_queue` for pg_net dispatch | bot route handlers                      |

## Scoped commands

```bash
pnpm --filter @askarthur/bot-core test
pnpm --filter @askarthur/bot-core test format-telegram
```

There is no separate typecheck script — typecheck via the web app: `pnpm --filter @askarthur/web typecheck`.

## Gotchas

- **Slack Block Kit ≠ Slack mrkdwn.** Slack accepts both; mrkdwn is NOT Markdown. `*bold*` (single asterisk) not `**bold**`. `<URL|text>` not `[text](URL)`.
- **Telegram MarkdownV2 vs HTML.** We use HTML in `format-telegram.ts` because escaping is simpler. Don't mix.
- **WhatsApp interactive templates.** `format-whatsapp.ts` produces inline messages only; interactive list/button templates require Meta pre-approval and aren't implemented here.
- **Messenger 2000-char limit.** `format-messenger.ts` splits long messages into multi-part replies. Don't bypass this — Meta drops over-length messages silently.
- **Webhook signature checks are timing-safe.** Never replace the `verify*Signature` / `verifyTelegramSecret` helpers with a naïve `===` comparison.

## Where things live

| Looking for                              | Where                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| Bot queue dispatch architecture (pg_net) | [`docs/adr/0001-bot-queue-via-pg-net.md`](../../docs/adr/0001-bot-queue-via-pg-net.md) |
| Per-platform webhook routes              | `apps/web/app/api/webhooks/{telegram,whatsapp,slack,messenger}/route.ts`               |
| Per-platform fixtures                    | `packages/bot-core/src/__tests__/format-*.test.ts`                                     |
| `bot_message_queue` schema               | grep `migration-v*queues*.sql` under `supabase/`                                       |
