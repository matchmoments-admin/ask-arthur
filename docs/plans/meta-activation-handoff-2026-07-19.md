# Meta activation handoff — 2026-07-19

**For:** a fresh context continuing the WhatsApp / Messenger (Meta) work.
**Read first:** [docs/ops/meta-bots-config.md](../ops/meta-bots-config.md) (the
founder runbook) and [ADR-0023](../adr/0023-meta-platform-boundaries.md) (what
Meta does and does NOT allow — do not re-scope the blocked paths).

---

## 1. What shipped (don't redo)

- **#827** — every bot's "Report scam" button now drives the **real onward-
  reporting brain** (was static Scamwatch text). WhatsApp + Messenger + Telegram
  wired. Shared core: `apps/web/lib/onward/submit.ts` (`submitOnwardReports`,
  used by both `/api/report/onward` and the bots); bot glue:
  `apps/web/lib/bots/onward-report.ts` (Redis-stashed evidence →
  `get_onward_destinations` → submit). `analyzeForBotDetailed` returns the
  persisted `scamReportId`.
- **#828** — Messenger env documented in `.env.example`; founder runbook;
  ADR-0023; BRP plan; BACKLOG updates.

Both bots (WhatsApp + Messenger) are **code-complete**. What's left is Meta-side
config (founder) + a couple of optional code follow-ups (a fresh context).

## 2. Observed Meta app state (2026-07-19)

App **"Just Ask Arthur"**, status **Unpublished**. Dashboard lists these use
cases: Threads API, Manage everything on your Page, **WhatsApp**, Instagram
messaging, **Messenger**, Ads Agentic. "Facebook Login for Business" product is
also added. A **"Become a Tech Provider"** banner is present.

Reading of this state:

- The two we need — **WhatsApp** + **Messenger** — are present. Good.
- **Extraneous** for the bots: Threads, Ads Agentic, Facebook Login for Business
  (and Instagram unless we build the IG DM bot — see §4). Each extra use case
  widens App Review scope → trim them.
- **Tech Provider verification is a gate to App Review** — must be done before
  the messaging permissions can be approved for public use.

## 3. Remaining config (FOUNDER — Meta dashboard + Vercel)

Ordered; details in the runbook §0–§4:

1. **Trim use cases** to WhatsApp + Messenger (+ Page for Messenger). Remove
   Threads / Ads Agentic / FB Login / Instagram (unless building §4).
2. **Meta Business verification** (Business Settings → Security Center).
3. **Become a Tech Provider** + access verification (dashboard banner).
4. **WhatsApp:** add product, connect WABA + number, set `WHATSAPP_*` env in
   Vercel, configure webhook `https://askarthur.au/api/webhooks/whatsapp`
   (subscribe `messages`), request `whatsapp_business_messaging` Advanced Access.
5. **Messenger:** connect the Ask Arthur Page, set `MESSENGER_*` env in Vercel,
   configure webhook `https://askarthur.au/api/webhooks/messenger` (subscribe
   `messages`, `messaging_postbacks`), request `pages_messaging` Advanced Access.
6. **Smoke test** (runbook §3): forward a scam → verdict → tap Report scam →
   confirm an `onward_report_log` row + a `cost_telemetry` `bot_analyze` row.
7. **Publish** the app (Dashboard → publish step).

The webhook GET verify handshake + HMAC POST are already implemented and will
pass as soon as the `*_VERIFY_TOKEN` / `*_APP_SECRET` env values match the
dashboard. No code change is required to go live.

## 4. Code tasks for THIS context (optional, buildable)

Prioritised for a fresh agent:

1. **Instagram DM scam-check bot** (headline — the app already has the Instagram
   messaging use case; BACKLOG "Instagram DM integration"). Mirror the Messenger
   bot: a new `apps/web/app/api/webhooks/instagram/route.ts` + `apps/web/lib/
bots/instagram/{handler,api,media}.ts` + `packages/bot-core/src/format-
instagram.ts` (or reuse the Messenger formatter — IG uses the same Send API
   shape via the `instagram_manage_messages` permission). Wire the same
   `analyzeForBotDetailed` + `stashBotReport`/`reportBotScam` onward flow.
   Instagram messaging rides the Messenger Platform, so the webhook + signature
   verification are the same Meta infrastructure. Gate live behind its own env +
   app review. **Only build if keeping the Instagram use case** (§3.1).
2. **Verify the wired onward flow end-to-end once the bots are live** — after the
   founder's smoke test, confirm `onward_report_log` rows and that auto-submit
   destinations (ACMA/OpenPhish/APWG/brand) actually fire their workers.

## 5. Deferred (do NOT build ahead of the trigger)

- **`meta_report` onward destination** — thin consumer; won't surface for bots
  (channel unknown). Build only when a Facebook-scam web/extension flow wires
  into onward reporting.
- **Report-to-Meta via BRP** — brand-gated; build when a pilot brand authorises
  us for their registered trademark ([docs/plans/meta-brp-report-to-meta.md](./meta-brp-report-to-meta.md)).
- **Mobile onward parity** — needs `/api/analyze` to return a `scam_report_id`
  (a hot-path change affecting web+extension+mobile); lowest-priority surface.
- **Marketplace ingestion** — BLOCKED by Meta (ADR-0023). Not a task.

## 6. Conventions

Ship workflow in root `CLAUDE.md` (fresh branch, explicit staging, migrations
via MCP + advisors, Vercel green before squash-merge). Any new bot goes through
the shared `analyzeForBotDetailed` path so it inherits `checkBotRateLimit`,
`logCost({feature:"bot_analyze"})`, the `bot_analyze` brake, PII scrubbing, and
the onward-report flow — don't fork them. New background fns → docs/inngest-brakes.md.
