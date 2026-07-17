# Ask Arthur — Web Surface

Every consumer page, authenticated page, admin page, and API route, grouped by domain. One line per route. Source files live under `apps/web/app/`.

**Auth notation:** `open` = no auth, IP rate-limited. `auth` = Supabase session (`Promise.race` wrapped). `admin` = HMAC token + Supabase admin role. `apikey` = Bearer API key validated via `apps/web/lib/apiAuth.ts`. `signature` = HMAC platform-specific (bots, Stripe). `flag` after route name = gated by a feature flag in [feature-flags.md](./feature-flags.md).

---

## Consumer pages (public, no auth)

### Core landing + marketing

| Route            | Purpose                                                                                        | Notes |
| ---------------- | ---------------------------------------------------------------------------------------------- | ----- |
| `/`              | Landing page with embedded scam checker widget                                                 | —     |
| `/pricing`       | Pricing tiers and feature comparison                                                           | —     |
| `/about`         | Company / team background                                                                      | —     |
| `/contact`       | Contact form                                                                                   | —     |
| `/reviews`       | Customer testimonials                                                                          | —     |
| `/privacy`       | Privacy policy                                                                                 | —     |
| `/terms`         | Terms of service                                                                               | —     |
| `/investors`     | Investor relations                                                                             | —     |
| `/accuracy`      | Model accuracy / benchmarks                                                                    | —     |
| `/health/feed`   | Public scam-trend feed snapshot                                                                | —     |
| `/scan-channels` | Discovery page — every way to submit a scan (web, email, bots, extension, mobile). Shipped F1. | —     |

### Consumer products

| Route                  | Purpose                                                | Flag                     |
| ---------------------- | ------------------------------------------------------ | ------------------------ |
| `/charity-check`       | Free charity legitimacy lookup                         | `charityCheck`           |
| `/phone-footprint`     | Phone-number digital footprint scanner (teaser + paid) | `phoneFootprintConsumer` |
| `/persona-check`       | Person / entity reputation lookup                      | —                        |
| `/extension`           | Chrome extension landing                               | —                        |
| `/extension-turnstile` | Turnstile bridge iframe for extension registration     | —                        |

### Vertical landing pages

| Route                    | Purpose                             |
| ------------------------ | ----------------------------------- |
| `/banking`               | Banking-security use case           |
| `/telco`                 | Telco / carrier use case            |
| `/digital-platforms`     | Social-platform moderation use case |
| `/compliance-calculator` | Regulatory burden estimator         |
| `/spf-assessment`        | Free SPF/DMARC/DKIM health check    |

### Blog + intelligence

| Route                     | Purpose                             | Flag                     |
| ------------------------- | ----------------------------------- | ------------------------ |
| `/blog`                   | Article listing with pagination     | —                        |
| `/blog/[slug]`            | Article detail (dynamic)            | —                        |
| `/blog/category/[slug]`   | Articles by category                | —                        |
| `/blog/search`            | Full-text search                    | —                        |
| `/blog/editorial-policy`  | External-link curation policy       | —                        |
| `/intel/regulator-alerts` | Scamwatch / ACSC / ASIC alerts feed | `redditIntelPublicPages` |
| `/intel/themes/[slug]`    | Reddit scam-narrative cluster page  | `redditIntelPublicPages` |

### Marketing route group (`(marketing)`)

| Route             | Purpose                         | Flag       |
| ----------------- | ------------------------------- | ---------- |
| `/scam-feed`      | Public scam-trend dashboard     | `scamFeed` |
| `/scam-map`       | Geo-heatmap of scam reports     | `scamFeed` |
| `/spf-compliance` | SPF/DMARC/DKIM compliance guide | —          |

### Trust & transparency

| Route                      | Purpose                             |
| -------------------------- | ----------------------------------- |
| `/trust`                   | Trust + transparency hub            |
| `/trust/security-overview` | Security practices + certifications |
| `/trust/changelog`         | Product changelog                   |
| `/trust/dpa`               | Data Processing Agreement           |

### Misc consumer

| Route          | Purpose                         |
| -------------- | ------------------------------- |
| `/unsubscribe` | Email unsubscribe form          |
| `/onboarding`  | Post-signup welcome flow (anon) |

---

## Auth pages (Supabase session)

### Auth route group (`(auth)`)

| Route     | Purpose                          |
| --------- | -------------------------------- |
| `/login`  | Email + password and OAuth login |
| `/signup` | User registration                |

### Dashboard (`/app/*` — requires `getUser()`)

| Route           | Purpose                                         |
| --------------- | ----------------------------------------------- |
| `/app`          | Authenticated home / portal                     |
| `/app/settings` | Account preferences + 2FA                       |
| `/app/keys`     | API key self-service (generate, rotate, revoke) |
| `/app/reports`  | User's scan history + saved reports             |
| `/app/threats`  | Aggregated personal threat intelligence         |
| `/app/billing`  | Stripe checkout + subscription management       |
| `/app/team`     | Team-member management + roles                  |

### Role-scoped dashboards

| Route                      | Purpose                                       |
| -------------------------- | --------------------------------------------- |
| `/app/compliance`          | Compliance evidence + audit log               |
| `/app/compliance/evidence` | Detailed evidence snapshots                   |
| `/app/developer`           | API docs, webhook delivery, rate-limit status |
| `/app/executive`           | Executive-summary dashboard                   |
| `/app/fraud-manager`       | Fraud-investigation tools                     |
| `/app/investigations`      | Case management + triage                      |
| `/app/spf-compliance`      | Org-wide domain SPF/DMARC monitor             |

### Breach Defence + family

| Route                           | Purpose                        | Flag                     |
| ------------------------------- | ------------------------------ | ------------------------ |
| `/app/phone-footprint/monitors` | Monitor rules + alerts         | `phoneFootprintConsumer` |
| `/app/family`                   | Family-plan members + activity | `familyPlan`             |

### Admin (`/admin/*` — HMAC token + admin role)

| Route                    | Purpose                                                                                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin/dashboard`       | Admin home                                                                                                                                                                                                                      |
| `/admin/feedback`        | Feedback triage queue review                                                                                                                                                                                                    |
| `/admin/costs`           | Cost-telemetry dashboard                                                                                                                                                                                                        |
| `/admin/analytics`       | First-party analytics — daily scans, activation, no-scan rate, first-touch UTM/channel attribution, and per-content-page conversion. Reads the v190/v191 `security_invoker` views via service role. `FF_ANALYTICS_ATTRIBUTION`. |
| `/admin/brand-alerts`    | Brand-impersonation alert review                                                                                                                                                                                                |
| `/admin/clone-watch`     | Clone-watch triage queue (FP/TP/Investigate) + per-brand history + Netcraft takedown stats + urlscan classification chips                                                                                                       |
| `/admin/onward-reports`  | Pre-approve regulator submissions                                                                                                                                                                                               |
| `/admin/email-studio`    | Preview all outbound email templates + edit their prose "copy slots" (markdown, DB-backed `email_copy`); preview / test-send-to-self / save. APIs: `/api/admin/email-studio/{preview,save,test-send}`. v167.                    |
| `/admin/vulnerabilities` | Vuln-intel review                                                                                                                                                                                                               |
| `/admin/reports`         | Scam-report inspection                                                                                                                                                                                                          |
| `/admin/users`           | User management                                                                                                                                                                                                                 |
| `/admin/leads`           | B2B sales pipeline                                                                                                                                                                                                              |
| `/admin/stripe`          | Manual invoicing                                                                                                                                                                                                                |

---

## API surface

### Public analysis + scanning (open, IP rate-limited)

| Route                  | Method | Purpose                                           |
| ---------------------- | ------ | ------------------------------------------------- |
| `/api/analyze`         | POST   | Main scam analysis (text / URL / email / image)   |
| `/api/analyze/similar` | POST   | Retrieve similar verified scams from corpus       |
| `/api/persona-check`   | POST   | Person / entity reputation lookup                 |
| `/api/deepfake`        | POST   | Deepfake detection (`deepfakeDetection` flag)     |
| `/api/breach-check`    | POST   | Email breach exposure check + rotation actions    |
| `/api/abn-lookup`      | POST   | Australian Business Number verification (ABR API) |

### Consumer lookup

| Route                               | Method | Auth   | Purpose                                                 |
| ----------------------------------- | ------ | ------ | ------------------------------------------------------- |
| `/api/charity-check`                | POST   | open   | Charity legitimacy lookup                               |
| `/api/charity-check/autocomplete`   | GET    | open   | Charity name autocomplete                               |
| `/api/phone-footprint/[msisdn]`     | POST   | open   | Phone-number footprint (free teaser; paid via monitors) |
| `/api/phone-footprint/[msisdn]/pdf` | GET    | open   | PDF report export (Inngest queued)                      |
| `/api/scam-contacts/lookup`         | GET    | apikey | Lookup known scam contact                               |
| `/api/scam-contacts/report`         | POST   | open   | Report a scam contact                                   |
| `/api/scam-urls/lookup`             | POST   | apikey | Lookup scam URL with WHOIS / SSL                        |
| `/api/scam-urls/report`             | POST   | open   | Report a scam URL                                       |

### Extension integration (open, ECDSA-signed install requests)

| Route                                         | Method | Purpose                                                                  |
| --------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| `/api/extension/register`                     | POST   | Register install (Turnstile-gated; one-shot)                             |
| `/api/extension/heartbeat`                    | POST   | Keep-alive + threat-DB version sync                                      |
| `/api/extension/analyze`                      | POST   | Full analysis from extension                                             |
| `/api/extension/analyze-ad`                   | POST   | Facebook ad scan (text + landing + image)                                |
| `/api/extension/analyze-image`                | POST   | Right-click image AI/deepfake check (`FF_IMAGE_CHECK`, tiered daily cap) |
| `/api/extension/check-ad`                     | POST   | Batch ad-safety lookup                                                   |
| `/api/extension/flag-ad`                      | POST   | Community ad flag                                                        |
| `/api/extension/url-check`                    | POST   | Real-time URL reputation (navigation guard)                              |
| `/api/extension/report-email`                 | POST   | Email header analysis                                                    |
| `/api/extension/site-audit`                   | POST   | Website security-header audit                                            |
| `/api/extension/extension-security/analyze`   | POST   | Extension code / manifest scan                                           |
| `/api/extension/extension-security/threat-db` | GET    | Malware-signature DB (extension fetch)                                   |
| `/api/extension/subscription`                 | POST   | Subscription tier lookup                                                 |
| `/api/extension/link-token`                   | POST   | Mint single-use account-link token (`FF_EXTENSION_BILLING`)              |
| `/api/extension/link`                         | POST   | Consume link token, associate install↔user (session-authed)              |

### Security audits (open, max 30–60s)

| Route                    | Method | Purpose                                 |
| ------------------------ | ------ | --------------------------------------- |
| `/api/site-audit`        | POST   | Website security-posture snapshot       |
| `/api/site-audit/stream` | GET    | Streaming variant (SSE)                 |
| `/api/extension-audit`   | POST   | Browser extension security audit        |
| `/api/mcp-audit`         | POST   | MCP server / npm package security audit |
| `/api/skill-audit`       | POST   | AI skill / function security audit      |

### Media + content analysis

| Route                | Method | Flag            | Purpose                                            |
| -------------------- | ------ | --------------- | -------------------------------------------------- |
| `/api/media/upload`  | POST   | `mediaAnalysis` | Upload audio / video for analysis                  |
| `/api/media/analyze` | POST   | `mediaAnalysis` | Transcribe audio → scam analysis (Whisper + Haiku) |
| `/api/media/status`  | GET    | `mediaAnalysis` | Async processing status                            |

### User + org management (auth)

| Route                      | Method | Purpose                         |
| -------------------------- | ------ | ------------------------------- |
| `/api/org/create`          | POST   | Create new organization         |
| `/api/org/invite`          | POST   | Send team invite                |
| `/api/org/invite/accept`   | POST   | Accept team invite token        |
| `/api/org/members`         | GET    | List org members + roles        |
| `/api/family`              | POST   | Family-plan member add / remove |
| `/api/family/invite`       | POST   | Send family invite              |
| `/api/family/join`         | POST   | Accept family invite            |
| `/api/user/delete-account` | POST   | Full data deletion (GDPR)       |
| `/api/user/export-data`    | POST   | Download personal data archive  |

### API key management (auth)

| Route            | Method | Purpose                 |
| ---------------- | ------ | ----------------------- |
| `/api/keys`      | GET    | List org's API keys     |
| `/api/keys`      | POST   | Generate new API key    |
| `/api/keys/[id]` | GET    | Key details (no secret) |
| `/api/keys/[id]` | DELETE | Revoke key              |

### B2B threat intelligence API `/api/v1/*` (apikey)

| Route                            | Method | Flag                | Purpose                                            |
| -------------------------------- | ------ | ------------------- | -------------------------------------------------- |
| `/api/v1/openapi.json`           | GET    | —                   | OpenAPI 3.0 spec                                   |
| `/api/v1/usage`                  | GET    | `auth`              | API usage breakdown (daily / monthly)              |
| `/api/v1/threats/urls/lookup`    | POST   | `auth`              | Batch URL reputation                               |
| `/api/v1/threats/urls/trending`  | GET    | `auth`              | Trending malicious URLs                            |
| `/api/v1/threats/domains`        | GET    | `auth`              | Domain reputation lookup                           |
| `/api/v1/threats/stats`          | GET    | `auth`              | Threat statistics                                  |
| `/api/v1/threats/trending`       | GET    | `auth`              | Trending threats                                   |
| `/api/v1/threats/wallets/lookup` | GET    | `auth`              | Crypto wallet risk score                           |
| `/api/v1/deepfakes`              | GET    | `auth`              | Deepfake detection results                         |
| `/api/v1/deepfakes/trending`     | GET    | `auth`              | Top trending deepfakes                             |
| `/api/v1/entities/[id]`          | GET    | `auth`              | Entity details                                     |
| `/api/v1/entities/lookup`        | GET    | `auth`              | Batch entity lookup                                |
| `/api/v1/entities/batch`         | POST   | `auth`              | Batch entity enrichment                            |
| `/api/v1/scams/search`           | POST   | `scamsSearchB2bApi` | Semantic search over verified scams                |
| `/api/v1/intel/themes`           | GET    | `redditIntelB2bApi` | List Reddit scam themes                            |
| `/api/v1/intel/themes/[id]`      | GET    | `redditIntelB2bApi` | Theme details + member posts                       |
| `/api/v1/intel/search`           | POST   | `redditIntelB2bApi` | Semantic search over Reddit + regulator narratives |
| `/api/v1/intel/digest`           | GET    | `redditIntelB2bApi` | Weekly summary                                     |
| `/api/v1/intel/quotes`           | GET    | `redditIntelB2bApi` | Quoted snippets from latest posts                  |
| `/api/v1/clusters`               | GET    | `auth`              | Scam-cluster listing                               |
| `/api/v1/clusters/[id]`          | GET    | `auth`              | Cluster members + risk                             |

### Billing + Stripe (open, signature for webhook)

| Route                  | Method | Purpose                                     |
| ---------------------- | ------ | ------------------------------------------- |
| `/api/stripe/checkout` | POST   | Create checkout session                     |
| `/api/stripe/portal`   | POST   | Redirect to customer portal                 |
| `/api/stripe/webhook`  | POST   | Stripe event ingestion (signature verified) |

### Reporting + onward (open)

| Route                      | Method | Purpose                                                                    |
| -------------------------- | ------ | -------------------------------------------------------------------------- |
| `/api/report/onward`       | POST   | Submit scam report to regulators (Scamwatch / ACMA / iDcare / CyberReport) |
| `/api/report/destinations` | GET    | List available reporting destinations                                      |

### First-party analytics + attribution (open, `FF_ANALYTICS_ATTRIBUTION`)

First-touch is captured by `middleware.ts`, which sets the `aa_attribution` cookie (`anonymous_id`, `utm_*`, `referrer`, `landing_path`; httpOnly · Secure · SameSite=Lax · 90d) on the visitor's **first** request — write-once, and **no DB write** (a pageview costs 0 rows). Rows are written only on named events, via `logEvent()` (`apps/web/lib/analytics-events.ts`).

| Route         | Method | Purpose                                                                                                                                                                                                                                            |
| ------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/events` | POST   | Client-safe event ingestion (`scan_started`, `feed_view`, `pageview`, `extension_install`). Server-authoritative events (`scan_completed`, `contact_submit`, `scam_report_submitted`) are emitted server-side and **rejected** here (no spoofing). |
| `/go/[slug]`  | GET    | Branded short-link redirect (`apps/web/lib/short-links.ts`) — logs `link_click` server-side (survives referrer-stripping), 302s to the destination with UTMs, and sets the first-touch cookie itself (clean short URLs carry no UTM query).        |

### Phone footprint monitoring (auth or apikey)

| Route                                       | Method | Purpose                                |
| ------------------------------------------- | ------ | -------------------------------------- |
| `/api/phone-footprint/monitors`             | GET    | List monitors                          |
| `/api/phone-footprint/monitors`             | POST   | Create monitor                         |
| `/api/phone-footprint/monitors/[id]`        | GET    | Monitor details                        |
| `/api/phone-footprint/monitors/[id]`        | PUT    | Update monitor settings                |
| `/api/phone-footprint/monitors/[id]`        | DELETE | Delete monitor                         |
| `/api/phone-footprint/monitors/[id]/alerts` | GET    | Alert history for monitor              |
| `/api/phone-footprint/verify/start`         | POST   | Start OTP verification (Twilio Verify) |
| `/api/phone-footprint/verify/check`         | POST   | Verify OTP code                        |

### Dashboard data (auth)

| Route                        | Method | Purpose                         |
| ---------------------------- | ------ | ------------------------------- |
| `/api/dashboard/threat-feed` | GET    | User's personalised threat feed |

### Bot webhooks (signature; multi-platform)

| Route                           | Method | Purpose                                              | Handler                                  |
| ------------------------------- | ------ | ---------------------------------------------------- | ---------------------------------------- |
| `/api/bot-webhook`              | POST   | Multi-platform router (`bot_message_queue` consumer) | Core router                              |
| `/api/webhooks/telegram`        | POST   | Telegram messages + callbacks                        | `apps/web/lib/bots/telegram/handler.ts`  |
| `/api/webhooks/whatsapp`        | POST   | WhatsApp messages + media (via Vonage)               | `apps/web/lib/bots/whatsapp/handler.ts`  |
| `/api/webhooks/slack`           | POST   | Slack slash commands + events                        | `apps/web/lib/bots/slack/handler.ts`     |
| `/api/webhooks/slack/shortcuts` | POST   | Slack message shortcuts + modals                     | `apps/web/lib/bots/slack/handler.ts`     |
| `/api/webhooks/messenger`       | POST   | Facebook Messenger text + postbacks                  | `apps/web/lib/bots/messenger/handler.ts` |

### Third-party integration webhooks (signature)

| Route                     | Method | Purpose                                                      |
| ------------------------- | ------ | ------------------------------------------------------------ |
| `/api/blog/ghost-webhook` | POST   | Ghost CMS post-publish event                                 |
| `/api/stripe/webhook`     | POST   | Stripe subscription events (also listed above under Billing) |

### Auth + onboarding (open)

| Route                        | Method | Purpose                              |
| ---------------------------- | ------ | ------------------------------------ |
| `/api/auth/signout`          | POST   | Clear session + redirect             |
| `/api/subscribe`             | POST   | Newsletter signup                    |
| `/api/waitlist`              | POST   | Waitlist form                        |
| `/api/leads`                 | POST   | B2B contact form                     |
| `/api/feedback`              | POST   | User feedback collection             |
| `/api/unsubscribe`           | POST   | Email unsubscribe form               |
| `/api/unsubscribe-one-click` | GET    | RFC 8058 one-click unsubscribe token |

### Admin (admin)

| Route                                             | Method | Purpose                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/api/admin/login`                                | GET    | HMAC token generation (legacy)                                                                                                                                                                                                                                                                                                                                                       |
| `/api/admin/brand-alerts/publish`                 | POST   | Publish brand-impersonation alert                                                                                                                                                                                                                                                                                                                                                    |
| `/api/admin/brand-alerts/skip`                    | POST   | Mark alert reviewed / skipped                                                                                                                                                                                                                                                                                                                                                        |
| `/api/admin/clone-watch/triage`                   | POST   | FP / TP / Investigate transition. On `tp_confirmed`: inline directory lookup + `enqueue_clone_alert_notification` for fraud_inbox/security_txt brands; stamp `submitted_to.brand_notification`; emit `shopfront/clone.triaged.v1` with bounded retry (3 attempts, 200/400/800ms backoff). On retry exhaustion: Telegram-page admin + return `eventEmitted:false`.                    |
| `/api/admin/clone-watch/scan`                     | POST   | Manual urlscan trigger for a specific alert (rate-limited 20/hour to preserve free-tier quota)                                                                                                                                                                                                                                                                                       |
| `/api/admin/clone-watch/batches/[batchId]/send`   | POST   | Admin approval: pre-checks `FF_SHOPFRONT_CLONE_NOTIFY_BRAND` + outreach brake + `RESEND_FROM_EMAIL`; cross-validates queue.recipient against `brand_contact_directory.brand` PK; re-checks STOP suppression; sends via Resend with `idempotencyKey: clone-watch-send:{batchId}`; transitions batch via `transition_clone_alert_batch`; records via `record_brand_notification_sent`. |
| `/api/admin/clone-watch/batches/[batchId]/reject` | POST   | Admin rejection: transitions a `pending` batch to `rejected`, keeps queue rows for audit.                                                                                                                                                                                                                                                                                            |
| `/api/admin/clone-watch/scamwatch-export`         | GET    | CSV export of TP-confirmed alerts in Scamwatch report-upload format. Manual upload until Playwright form-POST automation (#485) lands.                                                                                                                                                                                                                                               |
| `/api/admin/onward-reports/approve`               | POST   | Pre-approve regulator report                                                                                                                                                                                                                                                                                                                                                         |
| `/api/admin/blog/revalidate`                      | POST   | On-demand ISR flush for `/blog/[slug]` + `/blog` index (edits made outside the Ghost webhook — e.g. `category_slug` set via SQL). `requireAdmin`, kebab-case slug via Zod; calls the shared `revalidateBlogPost()` helper (`lib/blog.ts`). PR #749.                                                                                                                                  |
| `/api/admin/stripe/invoice`                       | POST   | Manual invoice creation                                                                                                                                                                                                                                                                                                                                                              |

### Cron routes (Vercel signature)

| Route                               | Schedule       | Purpose                              |
| ----------------------------------- | -------------- | ------------------------------------ |
| `/api/cron/weekly-email`            | `0 14 * * 1`   | Weekly scam digest                   |
| `/api/cron/nurture`                 | `0 23 * * *`   | B2B leads nurture sequence           |
| `/api/cron/bot-queue-sweep`         | `0 */6 * * *`  | Bot queue safety-net                 |
| `/api/cron/bot-queue-cleanup`       | `0 4 * * *`    | Purge old queue entries              |
| `/api/cron/cost-daily-check`        | `0 */6 * * *`  | Check spend against feature brakes   |
| `/api/cron/cost-weekly-digest`      | `0 22 * * 0`   | Weekly WoW cost digest               |
| `/api/cron/vuln-retention`          | `0 3 * * *`    | Prune vulnerability_detections >180d |
| `/api/cron/scam-reports-retention`  | `30 3 * * *`   | Archive + prune scam_reports         |
| `/api/cron/ensure-partitions`       | `0 2 * * *`    | Create next-month partitions         |
| `/api/cron/reddit-intel-trigger`    | `0 8 * * *`    | Fire reddit-intel-daily Inngest      |
| `/api/cron/reddit-intel-retention`  | `30 4 * * *`   | Prune reddit_processed_posts         |
| `/api/cron/feedback-digest`         | `0 9 * * *`    | Compile feedback triage queue        |
| `/api/cron/health-digest`           | `0 22 * * *`   | Daily health metrics + errors        |
| `/api/cron/pg-stuck-query-watchdog` | `*/5 * * * *`  | Stuck-query watchdog                 |
| `/api/cron/scraper-brake-alert`     | `*/15 * * * *` | Feature-brake alerter                |

Full timetable, cron-route handlers, and Inngest cross-references in [background-workers.md](./background-workers.md).

### Internal / orchestration

| Route          | Method           | Purpose                                     |
| -------------- | ---------------- | ------------------------------------------- |
| `/api/inngest` | POST / PUT / GET | Inngest function invocation + introspection |

### Misc + integration (open)

| Route                          | Method | Purpose                                                 |
| ------------------------------ | ------ | ------------------------------------------------------- |
| `/api/badge`                   | GET    | Embeddable security badge (default style)               |
| `/api/badge/[domain]`          | GET    | Domain-specific badge (`bdBreachScore` flag)            |
| `/api/feed`                    | GET    | Feed JSON export (verified scams + Reddit intel)        |
| `/api/feed/proxy-image`        | GET    | Image-proxy for feed clients (CORS bypass)              |
| `/api/og/scan`                 | GET    | Dynamic OG image for scan-result sharing                |
| `/api/mobile/attest`           | POST   | Device attestation verify (Play Integrity / App Attest) |
| `/api/mobile/push/register`    | POST   | Push-token registration                                 |
| `/api/mobile/regulator-alerts` | GET    | Regulator alerts (`mobileRegulatorAlerts` flag)         |
| `/api/mobile/threat-snapshot`  | GET    | Compact threat summary for mobile widget                |
| `/api/stats`                   | GET    | Public aggregate stats                                  |
| `/api/api-docs`                | GET    | API docs portal redirect                                |

---

## `apps/web/lib/*` — top-level modules

| Module                         | Purpose                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `auth.ts`                      | Supabase `getUser()` helper (5s `Promise.race`, throws `AuthUnavailableError`) |
| `adminAuth.ts`                 | HMAC token + Supabase admin-role verification                                  |
| `apiAuth.ts`                   | API key validation, rate-limit checks, usage logging                           |
| `blog.ts`                      | Ghost API integration                                                          |
| `blogGenerator.ts`             | Generate blog post from structured data                                        |
| `blogRenderer.ts`              | Render blog post HTML + metadata                                               |
| `ghost-sync.ts`                | Sync Ghost webhooks to internal feed                                           |
| `social-publish.ts`            | Cross-post to LinkedIn / Twitter                                               |
| `stripe.ts`                    | Stripe client (checkout, portal, subscriptions)                                |
| `cost-telemetry.ts`            | `logCost()` helper + daily spend brake checks                                  |
| `input-detector.ts`            | Classify input type (email / URL / phone / domain / file)                      |
| `charityRegistrySources.ts`    | ACNC charity-registry data sources                                             |
| `charityResultToResultCard.ts` | Transform charity lookup → card UI                                             |
| `officialBrands.ts`            | Whitelist of verified brand data                                               |
| `reddit-intel.ts`              | Reddit scam-post fetcher + processor                                           |
| `reddit-intel-weekly.ts`       | Weekly summary generation                                                      |
| `regulator-alerts-weekly.ts`   | Scamwatch / ACSC / ASIC digest builder                                         |
| `org.ts`                       | Org creation, invites, role enforcement                                        |
| `unsubscribe.ts`               | Email unsubscribe token validation                                             |
| `phoneFootprintSkus.ts`        | Pricing tiers for phone-monitor subscriptions                                  |
| `twilioLookup.ts`              | Twilio Lookup v2 phone intelligence                                            |
| `twilioVerify.ts`              | Twilio Verify OTP flow                                                         |
| `mediaAnalysis.ts`             | Audio / video upload pipeline (R2 → Whisper → analysis)                        |
| `whisper.ts`                   | OpenAI Whisper transcription client                                            |
| `deepfakeDetection.ts`         | Reality Defender deepfake detection API                                        |
| `compressImage.ts`             | Image optimisation before upload                                               |
| `r2.ts`                        | Cloudflare R2 upload helper                                                    |
| `resend.ts`                    | Resend email API (transactional + marketing)                                   |
| `qrDecode.ts`                  | QR-code decoding from images                                                   |
| `resembleDetect.ts`            | Voice-cloning detection (Resemble AI)                                          |
| `recoverySteps.ts`             | Post-breach recovery guidance templates                                        |
| `env-coerce.ts`                | Type-safe env-var parsing                                                      |
| `chart-tokens.ts`              | Design tokens for Chart.js / Recharts                                          |
| `utm.ts`                       | UTM parameter parsing                                                          |
| `region.ts`                    | Geolocation + timezone helpers                                                 |

### `apps/web/lib/*` directories

| Directory          | Purpose                                                                       |
| ------------------ | ----------------------------------------------------------------------------- |
| `bots/`            | Telegram, WhatsApp, Slack, Messenger handlers (per-platform formatters)       |
| `dashboard/`       | Dashboard data loaders (compliance, developer, executive, investigations)     |
| `hooks/`           | React hooks (client-side only)                                                |
| `notion/`          | Notion API integration (internal docs / CMS)                                  |
| `onward/`          | Regulator reporting logic (Scamwatch, ACMA, iDcare, CyberReport, ReportCyber) |
| `phone-footprint/` | Phone-footprint scoring + monitoring core                                     |

---

## Extension identity & request signing

Chrome's CRX format gives the server no way to verify a request came from a store-installed extension (the CRX packaging key is never exposed at runtime; Web Environment Integrity was abandoned in 2023). Shared secrets baked into the bundle are extractable via `unzip extension.crx`. The current defensible pattern:

1. **Keypair generation** (`apps/extension/src/lib/identity.ts`) — on first run, `crypto.subtle.generateKey({name:'ECDSA', namedCurve:'P-256'}, extractable=false, ['sign','verify'])`. Persisted in IndexedDB; non-extractable `CryptoKey` handles survive MV3 service-worker restarts via structured clone.
2. **Registration** (`apps/extension/src/lib/register.ts` + `src/entrypoints/offscreen/`) — a one-shot MV3 offscreen document iframes `https://askarthur.au/extension-turnstile`, the Turnstile widget runs, the token is `postMessage`d back and forwarded to background via `chrome.runtime.sendMessage`. Background POSTs `{installId, publicKeyJwk, turnstileToken}` to `/api/extension/register`. Server verifies via Cloudflare siteverify and upserts the public key into `extension_installs`. Turnstile rejects `chrome-extension://` origins directly — hosting the bridge iframe on our own domain is the supported workaround.
3. **Request signing** (`apps/extension/src/lib/sign.ts`) — every API call signs `${METHOD}\n${PATH}\n${TIMESTAMP}\n${NONCE}\n${BASE64(SHA256(BODY))}` and attaches four `X-Extension-*` headers. Server-side verification (`apps/web/app/api/extension/_lib/signature.ts`) checks ±5 min clock skew, rejects replayed nonces via Upstash SETNX (10 min TTL), fetches the public key from `extension_installs` (cached in Redis 5 min), and verifies the signature.
