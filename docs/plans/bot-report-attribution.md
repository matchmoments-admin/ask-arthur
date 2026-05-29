# Bot → scam_reports attribution (ready-to-execute)

**Goal:** capture every bot scam-check into `scam_reports` so we can classify and
report on scam types **by platform** (Messenger / WhatsApp / Telegram / Slack),
alongside the web/extension rows that already land there.

**No migration** — `scam_reports` and the `source` CHECK enum (incl. `bot_messenger`,
`bot_whatsapp`, `bot_telegram`, `bot_slack`) already exist (v21). The web path already
writes via `storeScamReport`; bots simply skip it. This wires the missing call.

## Sequencing (why this is a plan, not yet a PR)

Edits `analyzeForBot` (changed in PR #545) and the Messenger handler (PR #543). Build
as a 4th parallel branch → conflict cascade in this monorepo (rebase drops commits).
**Execute on a single branch off `main` once #543 + #545 merge.** All three are green +
mergeable as of this writing.

## Decisions (locked)

1. **Write to `scam_reports`, not a `verified_scams.source` column.** The intelligence
   table already carries source × scam_type × verdict × input_mode × impersonated_brand
   × channel × region. The column idea was inferior (needs a migration, HIGH_RISK-only).
2. **Store on every bot check, including cache hits** — each forward is a real submission
   to count in the funnel. No `idempotencyKey` → one row per submission (intended).
3. **Skip entity-linkage in v1** — `entities: []`. Scam-type reporting doesn't need the
   entity graph; add as a fast-follow if wanted.
4. **No `verified_scam_id` link in v1** — pass `null` (mirrors the web Inngest-flag-ON
   path, which also defers the link). Follow-up can restore it.
5. **Gate on `featureFlags.intelligenceCore`** to stay consistent with the web path
   (which only writes `scam_reports` when that flag is on). If the flag is off in prod,
   neither web nor bots write — no surprise divergence.
6. **PII-safe** — `storeScamReport` runs `scrubPII()` on content + red flags internally.

## Changes

### 1. `packages/bot-core/src/analyze.ts`

```ts
import { storeScamReport } from "@askarthur/scam-engine/report-store";
import { hashIdentifier } from "@askarthur/utils/hash";
import { featureFlags } from "@askarthur/utils/feature-flags";
import type { AnalysisResult, ReportSource, InputMode } from "@askarthur/types";

/** Where a bot check came from — used to attribute the scam_reports row. */
export interface BotReportContext {
  source: ReportSource; // bot_messenger | bot_whatsapp | bot_telegram | bot_slack
  userId: string; // raw platform user id — hashed internally, never stored raw
  inputMode: InputMode; // "text" | "image"
}

export async function analyzeForBot(
  text: string,
  region?: string,
  images?: string[],
  report?: BotReportContext, // NEW optional param — back-compatible
): Promise<AnalysisResult> {
  // ... existing brake check + runAnalysisCore + cost telemetry (unchanged) ...

  // Attribution: record the submission for per-platform scam-type reporting.
  // Fire-and-forget; storeScamReport scrubs PII and never throws. Runs on
  // cache hits too — every forward is a real submission worth counting.
  if (report && featureFlags.intelligenceCore) {
    const reporterHash = await hashIdentifier(
      report.userId,
      `bot:${report.source}`,
    );
    void storeScamReport({
      reporterHash,
      source: report.source,
      inputMode: report.inputMode,
      analysis: out.result,
      text, // scrubbed inside storeScamReport
      region: region ?? null,
      countryCode: null,
      entities: [], // v1: no entity linkage
    });
  }

  return out.result;
}
```

### 2. `packages/bot-core/src/index.ts`

Export `BotReportContext` alongside `analyzeForBot`.

### 3. Handler call sites — pass the report context

| Handler    | File                                                 | Call site(s)                             | source                         | inputMode     |
| ---------- | ---------------------------------------------------- | ---------------------------------------- | ------------------------------ | ------------- |
| Messenger  | `apps/web/lib/bots/messenger/handler.ts` (post-#543) | `processAnalysis`, `processImageMessage` | `bot_messenger`                | text / image  |
| WhatsApp   | `apps/web/lib/bots/whatsapp/handler.ts`              | `processAnalysis`, `processImageMessage` | `bot_whatsapp`                 | text / image  |
| Telegram   | `apps/web/lib/bots/telegram/handlers.ts`             | `analyzeAndReply`                        | `bot_telegram`                 | text          |
| Slack      | `apps/web/lib/bots/slack/*`                          | analyze call site                        | `bot_slack`                    | text          |
| Queue path | `apps/web/lib/bot-message-processor.ts`              | `analyzeForBot` call                     | derive from `message.platform` | from `images` |

`userId`: Messenger `senderId`, WhatsApp `from`, Telegram `String(ctx.from?.id ?? ctx.chat.id)`, Slack the Slack user id.

### 4. Test

Extend the bot-core analyze test: when `report` is passed, assert `storeScamReport` is
called once with the expected `source` + `inputMode` (mock `@askarthur/scam-engine/report-store`).

## Verification

- `pnpm --filter @askarthur/bot-core test`
- `pnpm --filter @askarthur/web typecheck`
- Post-deploy: `SELECT source, scam_type, verdict, count(*) FROM scam_reports
WHERE source LIKE 'bot_%' AND created_at > now() - interval '1 day'
GROUP BY 1,2,3 ORDER BY 4 DESC;` — confirm bot rows appear with classifications.

## Follow-ups (not in v1)

- Entity linkage (`buildEntities` from `scammerContacts` + URLs).
- `verified_scam_id` link for HIGH_RISK bot rows.
- `/admin` per-platform scam-type view + weekly digest by `source × scam_type`.
