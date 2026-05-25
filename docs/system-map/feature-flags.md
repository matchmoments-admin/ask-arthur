# Ask Arthur — Feature Flags & Environment

All feature flags live in `packages/utils/src/feature-flags.ts`. Default is **OFF** unless noted. The `NEXT_PUBLIC_FF_*` prefix exposes a flag to the client bundle; `FF_*` (no prefix) is server-only.

**Convention** (from `CLAUDE.md` Critical Rules):

- New consumer features ship default-OFF behind a `NEXT_PUBLIC_FF_*` flag.
- Server-only canary flags use bare `FF_*`.
- Before flipping any consumer flag from OFF to ON in production, re-run `mcp__supabase__get_advisors` (security + performance) and check the Disk-IO-budget query (`pg_stat_statements ORDER BY shared_blks_read + shared_blks_written DESC LIMIT 25`).

---

## Consumer features

| Flag                   | Default | Purpose                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mediaAnalysis`        | OFF     | Audio upload → Whisper transcription → analysis                                                                                                                                                                                                                                                                                                                                                 |
| `deepfakeDetection`    | OFF     | Deepfake detection on audio/video                                                                                                                                                                                                                                                                                                                                                               |
| `phoneIntelligence`    | OFF     | Twilio Lookup v2 phone intelligence                                                                                                                                                                                                                                                                                                                                                             |
| `videoUpload`          | OFF     | Video upload support                                                                                                                                                                                                                                                                                                                                                                            |
| `scamContactReporting` | OFF     | Community scam-contact reporting + lookup                                                                                                                                                                                                                                                                                                                                                       |
| `scamUrlReporting`     | OFF     | Community scam-URL reporting + WHOIS / SSL                                                                                                                                                                                                                                                                                                                                                      |
| `dataPipeline`         | OFF     | Threat-feed ingestion + Inngest                                                                                                                                                                                                                                                                                                                                                                 |
| `newsletter`           | OFF     | Newsletter signup form on blog                                                                                                                                                                                                                                                                                                                                                                  |
| `redirectResolve`      | OFF     | Resolve URL redirect chains                                                                                                                                                                                                                                                                                                                                                                     |
| `emailScanning`        | OFF     | Chrome extension Gmail scanning                                                                                                                                                                                                                                                                                                                                                                 |
| `siteAudit`            | OFF     | Lightweight website security scanner                                                                                                                                                                                                                                                                                                                                                            |
| `emailSecurityChecks`  | **ON**  | SPF/DMARC/DKIM checks (zero cost)                                                                                                                                                                                                                                                                                                                                                               |
| `recoveryGuidance`     | OFF     | Recovery steps on high-risk verdicts                                                                                                                                                                                                                                                                                                                                                            |
| `charityCheck`         | OFF     | Consumer `/charity-check` page                                                                                                                                                                                                                                                                                                                                                                  |
| `charityCheckIngest`   | OFF     | Server: ACNC daily scraper ingest                                                                                                                                                                                                                                                                                                                                                               |
| `shopSignal`           | **ON**  | Server: commerce-page post-processor on `/api/analyze` + `runAnalysisCore`. Stage 0/0.5 shipped 2026-05-19 (#324, #325); `FF_SHOP_SIGNAL` flipped ON 2026-05-20. Attaches `shopSignal: { isCommerce, commerceFlags[], generatedAt, referrerSource?, paidProviderVerdict? }` to the response; UI renders chips when present. No consumer-side flag — front end just renders if the field exists. |
| `shopSignalPaidFeed`   | OFF     | Server (`FF_SHOP_SIGNAL_PAID_FEED`): enables the APIVoid Site Trustworthiness paid feed (Stage 1, #319). Independent of `shopSignal` so the free Stage-0 detector keeps running if the paid feed is in trouble. Flip ON to start consuming the APIVoid trial.                                                                                                                                   |

## Intelligence core & enrichment

| Flag               | Default | Purpose                               |
| ------------------ | ------- | ------------------------------------- |
| `intelligenceCore` | OFF     | Unified report store + entity linkage |
| `entityEnrichment` | OFF     | Auto-enrich high-report entities      |
| `clusterBuilder`   | OFF     | Auto-group scam reports by entities   |
| `riskScoring`      | OFF     | 0–100 risk scores per entity          |
| `abuseIPDB`        | OFF     | IP reputation lookups                 |
| `urlScanIO`        | OFF     | Async URL scanning                    |
| `hibpCheck`        | OFF     | Email-breach checking                 |
| `ctLookup`         | OFF     | Certificate Transparency lookups      |
| `ipqualityScore`   | OFF     | Phone fraud scoring (IPQualityScore)  |

## Auth & billing

| Flag                  | Default | Purpose                              |
| --------------------- | ------- | ------------------------------------ |
| `auth`                | OFF     | Supabase Auth + dashboard + API keys |
| `billing`             | OFF     | Stripe pricing + checkout            |
| `multiTenancy`        | OFF     | B2B organisations + team management  |
| `corporateOnboarding` | OFF     | ABN-verification corporate flow      |
| `familyPlan`          | OFF     | Shared dashboard + activity log      |

## Extension features

| Flag          | Default | Purpose                                                               |
| ------------- | ------- | --------------------------------------------------------------------- |
| `urlGuard`    | OFF     | Real-time URL checking on navigation                                  |
| `facebookAds` | OFF     | Facebook ad scanning (paired with `WXT_FACEBOOK_ADS` build-time flag) |

## Mobile features

| Flag                    | Default | Purpose                                               |
| ----------------------- | ------- | ----------------------------------------------------- |
| `pushAlerts`            | OFF     | Scam-alert push notifications                         |
| `mobileRegulatorAlerts` | OFF     | Regulator alert feed (`/api/mobile/regulator-alerts`) |
| `deviceAttestation`     | OFF     | Play Integrity / App Attest                           |
| `offlineDB`             | OFF     | SQLite offline scam database                          |
| `callScreening`         | OFF     | Android call-screening service                        |
| `smsFilter`             | OFF     | iOS SMS filtering extension                           |

## Public feeds & B2B

| Flag                   | Default | Purpose                                                                     |
| ---------------------- | ------- | --------------------------------------------------------------------------- |
| `scamFeed`             | OFF     | Public scam feed (Reddit + verified + user reports)                         |
| `scamsSearchB2bApi`    | OFF     | `/api/v1/scams/search` semantic search                                      |
| `regulatorIntelSearch` | OFF     | Fold regulator narratives (Scamwatch/ACSC/ASIC) into `/api/v1/intel/search` |

## Breach Defence suite (F1–F11)

Paused after PR 2 over OAIC NDB data-availability finding. All flags OFF, schema live in prod. See `docs/plans/breach-defence-suite.md` for pause notes.

| Flag                 | Default | Wave | Purpose                                   |
| -------------------- | ------- | ---- | ----------------------------------------- |
| `bdDnsDrift`         | OFF     | F1   | DNS-drift monitor for watched domains     |
| `bdExtensionWarning` | OFF     | F2   | Browser-extension breach warning ribbon   |
| `bdPwdRotate`        | OFF     | F3   | Auto-rotate compromised credentials       |
| `bdBreachIndex`      | OFF     | F4   | Public Australian Breach Index            |
| `bdB2bExposure`      | OFF     | F5   | `/api/v1/breach/exposure` endpoint        |
| `bdClassActions`     | OFF     | F6   | Class-action awareness alerts             |
| `bdAftermath`        | OFF     | F7   | Per-breach recovery wizard + feed         |
| `bdTyposquat`        | OFF     | F8   | Typosquat domain pre-registration alerter |
| `bdBreachScore`      | OFF     | F9   | Embeddable breach-score badge (A+ → F)    |
| `bdRecovery`         | OFF     | F10  | Post-breach recovery playbooks            |
| `bdSecondWave`       | OFF     | F11  | Second-wave phishing correlation          |

## Reddit Intelligence (Waves 1–3)

| Flag                     | Default | Wave | Purpose                              |
| ------------------------ | ------- | ---- | ------------------------------------ |
| `redditIntelIngest`      | OFF     | 1    | Daily Sonnet classifier + IOC linker |
| `redditIntelDashboard`   | OFF     | 2    | Dashboard widgets + theme cards      |
| `redditIntelEmail`       | OFF     | 2    | Weekly email digest                  |
| `redditIntelB2bApi`      | OFF     | 3    | `/api/v1/intel/*` public B2B API     |
| `redditIntelPublicPages` | OFF     | 3    | Public `/intel/themes/[slug]` pages  |

## Phone Footprint

| Flag                     | Default | Purpose                                          |
| ------------------------ | ------- | ------------------------------------------------ |
| `phoneFootprintConsumer` | OFF     | Consumer product (free teaser + paid)            |
| `vonageEnabled`          | OFF     | Vonage provider (NI v2 + CAMARA SIM/Device Swap) |
| `leakcheckEnabled`       | OFF     | LeakCheck phone-breach lookup                    |
| `twilioVerifyEnabled`    | OFF     | Twilio Verify OTP for phone-ownership proof      |

## Shopfront clone-watch

Layer 0 = daily NRD lexical sweep (live since 2026-05-24). Layers 1–5 = outreach pipeline + measurement closure; landed across PRs #424 / #425 / #431 / #432 / #433. All server-side flags.

| Flag                                                                  | Default | Purpose                                                                                                                                          |
| --------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `shopfrontCloneWatch` (`FF_SHOPFRONT_CLONE_WATCH`)                    | **ON**  | Layer 0 daily NRD ingest cron. ON in prod since 2026-05-24.                                                                                      |
| `shopfrontCloneOutreach` (`FF_SHOPFRONT_CLONE_OUTREACH`)              | **ON**  | Master flag for Layers 1–5 (triage dashboard + outreach). ON in prod since 2026-05-26. When OFF, `/admin/clone-watch` 404s + all consumers skip. |
| `shopfrontCloneSubmitNetcraft` (`FF_SHOPFRONT_CLONE_SUBMIT_NETCRAFT`) | OFF     | Layer 2 Netcraft community-blocklist submission. Independent gate so Netcraft path can ship after the brand-notify path stabilises.              |
| `shopfrontCloneNotifyBrand` (`FF_SHOPFRONT_CLONE_NOTIFY_BRAND`)       | OFF     | Layers 3+4 brand notification (formal channels + courtesy email). Flip after the `brand_contact_directory` rows are verified per brand.          |
| `shopfrontCloneWeeklyDigest` (`FF_SHOPFRONT_CLONE_WEEKLY_DIGEST`)     | OFF     | Layer 5 weekly digest cron (Sun 10:00 UTC) → Telegram + LinkedIn-post draft. Flip after first triage week.                                       |
| `shopfrontCloneUrlscan` (`FF_SHOPFRONT_CLONE_URLSCAN`)                | OFF     | Phase A.3 urlscan.io auto-scan + daily re-scan cron. Independent of master `shopfrontCloneOutreach` so we can canary urlscan separately.         |

## Vulnerability & B2B

| Flag                     | Default | Purpose                                               |
| ------------------------ | ------- | ----------------------------------------------------- |
| `vulnAuEnrichment`       | OFF     | Claude Haiku enrichment of Australian CVE context     |
| `vulnDetectionRecording` | OFF     | Record vulnerability detections from scanners         |
| `vulnB2bExposure`        | OFF     | B2B exposure matcher (org product-inventory matching) |

## Analyze pipeline refactor

| Flag                                                  | Default | Purpose                                                                                                                                      |
| ----------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `analyzeInngestWeb` (server `FF_ANALYZE_INNGEST_WEB`) | OFF     | Phase 2: Inngest consumers for `analyze.completed.v1` (durable). When OFF, legacy `waitUntil` path runs. Canary separately from other flags. |
| `similarReports`                                      | OFF     | "Similar reports we've seen" on verdict page                                                                                                 |
| `ragThemes`                                           | OFF     | Inject top-K Reddit themes into Haiku prompt                                                                                                 |

## Third-party reporting

| Flag            | Default | Purpose                                               |
| --------------- | ------- | ----------------------------------------------------- |
| `metaBrpReport` | OFF     | Meta Brand Rights Protection deepfake reporter (stub) |

---

## Per-feature cost brakes

When daily spend exceeds the cap, `cost-daily-check` upserts a `feature_brakes` row and the function early-returns until `paused_until` expires (24h).

| Env var                            | Default | Source data                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DAILY_COST_THRESHOLD_USD`         | `2`     | `cost_telemetry` total → admin alert                                                                                                                                                                                                                                                                                                                                     |
| `VULN_AU_ENRICHMENT_CAP_USD`       | `5`     | `cost_telemetry WHERE feature='vuln-au-enrichment'`                                                                                                                                                                                                                                                                                                                      |
| `REDDIT_INTEL_CAP_USD`             | `10`    | `cost_telemetry WHERE feature='reddit-intel'`                                                                                                                                                                                                                                                                                                                            |
| `PHONE_FOOTPRINT_CAP_USD`          | `5`     | Vonage `telco_api_usage` + `cost_telemetry WHERE feature='phone_footprint'`                                                                                                                                                                                                                                                                                              |
| `CHARITY_CHECK_CAP_USD`            | `5`     | `cost_telemetry WHERE feature='charity-check'`                                                                                                                                                                                                                                                                                                                           |
| `SHOP_SIGNAL_CAP_USD`              | `15`    | `cost_telemetry WHERE feature IN ('shop_signal', 'shop-signal-apivoid-error', 'shop-signal-apivoid-overage')` — wired by `cost-daily-check` (Stage 1 #319). See [`docs/ops/shop-signal-config.md`](../ops/shop-signal-config.md) §3 for derivation.                                                                                                                      |
| `SHOPFRONT_CLONE_OUTREACH_CAP_USD` | `5`     | `cost_telemetry WHERE feature IN ('shopfront_clone_submit_netcraft', 'shopfront_clone_notify_brand', 'shopfront_clone_weekly_digest', 'shopfront_clone_poll_netcraft', 'shopfront_clone_urlscan', 'shopfront_clone_urlscan_rescan')` — aggregate brake across all 6 Layer 1–5 + Phase A.3 sub-features. Engages a single `feature='shopfront_clone_outreach'` brake row. |

**Use bare numbers** (`5`, `10`) — non-numeric values silently disable the brake because `parseFloat("$10")` is `NaN`.

---

## Environment variables

~45 env vars defined in `turbo.json` `globalEnv`. Grouped by domain:

### Supabase

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_INTEGRATION_TEST_URL`, `SUPABASE_INTEGRATION_TEST_SERVICE_KEY` (smoke test against preview branch)
- `SUPABASE_WEBHOOK_SECRET` — HMAC secret on `bot_message_queue` INSERT trigger

### AI / LLM

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY` — Whisper transcription
- `VOYAGE_API_KEY` — Voyage 3 embeddings (per-env split — production / preview / dev)

### Clone-watch outreach (server-only)

- `NETCRAFT_REPORT_API_KEY` — Netcraft v3 Report API; powers Layer 2 community-blocklist submission + the takedown-polling cron. Apply via `report@netcraft.com`. When unset, the submit + poll fns skip-with-reason.
- `NETCRAFT_REPORTER_EMAIL` — identity included in Netcraft submissions. Defaults to `brendan@askarthur.au`.
- `URLSCAN_API_KEY` — urlscan.io free-tier API key. Powers Phase A.3 auto-scan + daily re-scan cron (~60/day usage, 100/day cap).
- `WHOISDS_NRD_ZIP_URL` — optional override for the Layer 0 daily NRD source. Leave unset; computed deterministically from yesterday's UTC date.

### Redis / Cache

- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`

### Storage

- `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ACCOUNT_ID`

### Email

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL` — Use `Ask Arthur <brendan@askarthur.au>` form (display-name workaround for Gmail bare-local-part rendering)

### Bots

- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID`
- `WHATSAPP_*` (via Vonage)
- `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`
- `MESSENGER_PAGE_ACCESS_TOKEN`, `MESSENGER_APP_SECRET`, `MESSENGER_VERIFY_TOKEN`

### Extension

- `WXT_INBOXSDK_APP_ID`
- `WXT_TURNSTILE_BRIDGE_URL` — Optional local-dev override (defaults to `https://askarthur.au/extension-turnstile`)
- `WXT_FACEBOOK_ADS` — Build-time flag for Facebook ad scanning content scripts
- `WXT_URL_GUARD`, `WXT_SITE_AUDIT` — Other extension feature flags
- `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` — Bot-gate for extension registration

### Admin

- `ADMIN_SECRET`

### Billing (Stripe)

- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_STRIPE_PRO_MONTHLY`, `NEXT_PUBLIC_STRIPE_PRO_ANNUAL`
- `NEXT_PUBLIC_STRIPE_BUSINESS_MONTHLY`, `NEXT_PUBLIC_STRIPE_BUSINESS_ANNUAL`

### Auth / feature-flag env

- `NEXT_PUBLIC_FF_AUTH`
- `NEXT_PUBLIC_FF_FACEBOOK_ADS` — Server-side gate matching `WXT_FACEBOOK_ADS`
- `NEXT_PUBLIC_FF_MEDIA_ANALYSIS`, `NEXT_PUBLIC_FF_DEEPFAKE`, `NEXT_PUBLIC_FF_PHONE_INTEL`
- `NEXT_PUBLIC_FF_CHARITY_CHECK`, `NEXT_PUBLIC_FF_PHONE_FOOTPRINT_CONSUMER`
- `NEXT_PUBLIC_FF_REDDIT_INTEL_PUBLIC_PAGES`, `NEXT_PUBLIC_FF_REDDIT_INTEL_B2B_API`
- (Full list lives in `packages/utils/src/feature-flags.ts`)
- `FF_ANALYZE_INNGEST_WEB` — Server-only canary for the analyze Phase 2 pipeline

### Inngest

- `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`

### External APIs

- `SAFE_BROWSING_API_KEY` — Google Safe Browsing
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` — Phone Lookup + Verify
- `HIVE_API_KEY` — Facebook ad image scanning (pricing contract required)
- `REALITY_DEFENDER_API_KEY`, `RESEMBLE_AI_API_TOKEN` — Deepfake / voice-clone detection
- `ABN_LOOKUP_GUID` — ABR Web Services
- `VONAGE_API_KEY`, `VONAGE_API_SECRET`, `VONAGE_APPLICATION_ID`, `VONAGE_PRIVATE_KEY` — Vonage NI v2 + CAMARA
- `LEAKCHECK_API_KEY` — Phone-breach lookup
- `APIVOID_API_KEY` — APIVoid Site Trustworthiness (Shop Signal Stage 1 paid feed)

### Cost alerts & brakes

- `TELEGRAM_ADMIN_CHAT_ID` — Personal chat ID via @userinfobot
- `DAILY_COST_THRESHOLD_USD` (default `2`)
- `VULN_AU_ENRICHMENT_CAP_USD` (default `5`)
- `REDDIT_INTEL_CAP_USD` (default `10`)
- `PHONE_FOOTPRINT_CAP_USD` (default `5`)
- `CHARITY_CHECK_CAP_USD` (default `5`)
- `SHOP_SIGNAL_CAP_USD` (default `15`)

### Operational

- `PG_WATCHDOG_AUTO_TERMINATE` — When `true`, `pg-stuck-query-watchdog` cron auto-terminates non-VACUUM backends running ≥60 min
- `ENABLE_SCRAPER` — GitHub Actions gate for narrative + IOC scrapers
- `ENABLE_VULN_SCRAPER` — GH Actions gate for vulnerability feed scraper
- `ENABLE_CHARITY_CHECK_INGEST` — GH Actions gate for ACNC / PFRA scrapers
- `ENABLE_DEEP_INVESTIGATION` — GH Actions gate for weekly deep-investigation pipeline
- `GHSA_PAT` — GitHub Advisories token

---

## Pre-flip checklist (consumer flag OFF → ON)

Before flipping any `NEXT_PUBLIC_FF_*` flag from default-OFF to ON in production:

1. Re-run `mcp__supabase__get_advisors` (security + performance).
2. Run the Disk-IO-budget query:
   ```sql
   SELECT query, calls, shared_blks_read + shared_blks_written AS io
   FROM extensions.pg_stat_statements
   ORDER BY io DESC
   LIMIT 25;
   ```
3. Verify the new feature's queries aren't in the top-5 — first real traffic is the wrong time to discover an IO-budget surprise.
4. Smoke-test the feature on Vercel preview with the flag flipped.
5. Confirm cost brake env vars are set as bare numbers (not `$10`).
