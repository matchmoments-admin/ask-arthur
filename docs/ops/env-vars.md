# Environment variables

45+ env vars defined in `turbo.json` `globalEnv`. Grouped here by purpose.

## Supabase

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_*`

## AI

`ANTHROPIC_API_KEY`

## Redis

`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`

## Storage

`R2_*` (Cloudflare R2)

## Email

`RESEND_API_KEY`

## Bots

`TELEGRAM_*`, `WHATSAPP_*`, `SLACK_*`, `MESSENGER_*`

## Extension

- `WXT_INBOXSDK_APP_ID`
- `WXT_TURNSTILE_BRIDGE_URL` — optional local-dev override; defaults to `https://askarthur.au/extension-turnstile`
- `WXT_FACEBOOK_ADS` — build-time flag for Facebook ad scanning content scripts
- `WXT_URL_GUARD`, `WXT_SITE_AUDIT` — other extension feature flags

## Turnstile (extension registration bot-gate)

`TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`

## Admin

`ADMIN_SECRET`

## Billing

- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_STRIPE_PRO_MONTHLY`, `NEXT_PUBLIC_STRIPE_PRO_ANNUAL`
- `NEXT_PUBLIC_STRIPE_BUSINESS_MONTHLY`, `NEXT_PUBLIC_STRIPE_BUSINESS_ANNUAL`

## Auth / feature flags

`NEXT_PUBLIC_FF_AUTH`, `NEXT_PUBLIC_FF_FACEBOOK_ADS` (server-side gate matching `WXT_FACEBOOK_ADS`), `NEXT_PUBLIC_FF_MEDIA_ANALYSIS`, `NEXT_PUBLIC_FF_DEEPFAKE`, `NEXT_PUBLIC_FF_PHONE_INTEL`. Full list in `packages/utils/src/feature-flags.ts`.

## Analyze pipeline (Phase 2)

`FF_ANALYZE_INNGEST_WEB` — server-side, no `NEXT_PUBLIC_` prefix. When `true`, `/api/analyze` emits `analyze.completed.v1` and durable Inngest consumers take over scam_reports / brand alerts / cost telemetry writes. When unset or `false`, the legacy waitUntil path runs. Canary separately from other flags.

## Inngest

`INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` — used by both the cron fans and the Phase 2 analyze consumers.

## External APIs

- `SAFE_BROWSING_API_KEY`
- `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN`
- `OPENAI_API_KEY` (Whisper)
- `HIVE_API_KEY` (Facebook ad image scanning — pricing contract required)
- `REALITY_DEFENDER_API_KEY` + `RESEMBLE_AI_API_TOKEN` (deepfake detection)
- `ABN_LOOKUP_GUID` (ABR Web Services)

## Bot webhook dispatch

`SUPABASE_WEBHOOK_SECRET` — HMAC secret on `bot_message_queue` INSERT trigger; see `/api/bot-webhook/route.ts`.

## Cost alerts

- `TELEGRAM_ADMIN_CHAT_ID` — personal chat ID via @userinfobot
- `DAILY_COST_THRESHOLD_USD` — default `2`

## Per-feature cost brakes

- `VULN_AU_ENRICHMENT_CAP_USD` — default `5`
- `REDDIT_INTEL_CAP_USD` — default `10`
- `PHONE_FOOTPRINT_CAP_USD` — default `5`

When today's per-feature spend exceeds the cap, `cost-daily-check` upserts a `feature_brakes` row and the function early-returns until `paused_until` expires (24h). Phone Footprint sums Vonage `telco_api_usage` + `cost_telemetry`-tagged `phone_footprint`; the others read from `cost_telemetry` only.

**Use bare numbers** (`5`, `10`) — non-numeric values silently disable the brake because `parseFloat("$10")` is `NaN`.
