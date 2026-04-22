# Roadmap

Phased build plan for Ask Arthur with current status tracking. See `BACKLOG.md` for deferred feature ideas by platform.

---

## Phase 1 — Core Platform ✅

The foundation: web app, analysis engine, and data layer.

| Feature                                                                | Status  |
| ---------------------------------------------------------------------- | ------- |
| Next.js web app with scam analysis form                                | ✅ Done |
| Claude AI analysis engine (text + images)                              | ✅ Done |
| Three-tier verdict system (SAFE / SUSPICIOUS / HIGH_RISK)              | ✅ Done |
| Supabase database (PostgreSQL)                                         | ✅ Done |
| Rate limiting (two-tier, Upstash Redis)                                | ✅ Done |
| Prompt injection defense (sanitization, nonce delimiters, 14 patterns) | ✅ Done |
| PII scrubbing pipeline (12 patterns)                                   | ✅ Done |
| URL extraction and Safe Browsing API                                   | ✅ Done |
| Analysis result caching (Redis)                                        | ✅ Done |
| IP geolocation for regional stats                                      | ✅ Done |
| Scam URL lookup and reporting endpoints                                | ✅ Done |
| Contact (phone/email) lookup and reporting                             | ✅ Done |
| Newsletter subscription (Resend)                                       | ✅ Done |
| Privacy-first analytics (Plausible)                                    | ✅ Done |
| Vercel deployment with security headers                                | ✅ Done |

## Phase 2 — Multi-Platform Expansion ✅

Bringing scam detection to users where they are.

### Chrome Extension ✅

| Feature                                                                               | Status                                       |
| ------------------------------------------------------------------------------------- | -------------------------------------------- |
| Phase 1: URL checking + text analysis popup                                           | ✅ Done                                      |
| Phase 2: Gmail email scanning (InboxSDK)                                              | Removed — shifting to email-forwarding model |
| WXT framework (Chrome + Firefox support)                                              | ✅ Done                                      |
| Extension API with dedicated auth + rate limits                                       | ✅ Done                                      |
| Per-install WebCrypto keypair + Turnstile-gated registration (replaces shared secret) | ✅ Done — 2026-04                            |
| Segmented tabs, rounded corners, animations                                           | ✅ Done                                      |

### Mobile App ✅

| Feature                                             | Status  |
| --------------------------------------------------- | ------- |
| Expo SDK 54 + React Native app                      | ✅ Done |
| Tab navigation (Home, Scan, Breach, Apps, Settings) | ✅ Done |
| QR code scanning (expo-camera)                      | ✅ Done |
| Data breach checking                                | ✅ Done |
| Share intent handling (text, URLs, images)          | ✅ Done |

### Chat Bots ✅

| Feature                                                              | Status  |
| -------------------------------------------------------------------- | ------- |
| Telegram bot with webhook                                            | ✅ Done |
| WhatsApp bot with webhook                                            | ✅ Done |
| Slack bot with slash commands                                        | ✅ Done |
| Facebook Messenger bot with webhook                                  | ✅ Done |
| Shared bot-core package (formatters, webhook verify, queue)          | ✅ Done |
| Platform-specific formatting (HTML, markdown, Block Kit, plain text) | ✅ Done |
| Bot message queue (async processing)                                 | ✅ Done |
| Per-user rate limiting (5/hour sliding window)                       | ✅ Done |

## Phase 3 — Threat Intelligence ✅

Building a comprehensive threat database.

### Data Pipeline ✅

| Feature                                           | Status  |
| ------------------------------------------------- | ------- |
| Python scraper framework with shared utilities    | ✅ Done |
| 16 threat feed integrations (see ARCHITECTURE.md) | ✅ Done |
| URL normalization (Python + TypeScript parity)    | ✅ Done |
| GitHub Actions scheduled scraping                 | ✅ Done |
| Feed timestamp tracking                           | ✅ Done |
| IP address and crypto wallet intelligence         | ✅ Done |

### Inngest Background Processing ✅

| Feature                                                         | Status  |
| --------------------------------------------------------------- | ------- |
| URL staleness checks (7-day inactive)                           | ✅ Done |
| IP staleness checks (7-day inactive)                            | ✅ Done |
| Crypto wallet staleness checks (14-day inactive)                | ✅ Done |
| WHOIS + SSL enrichment fan-out (every 6 hours)                  | ✅ Done |
| Certificate Transparency monitoring (AU brands, every 12 hours) | ✅ Done |

### B2B Threat API ✅

| Feature                                           | Status  |
| ------------------------------------------------- | ------- |
| Bearer token authentication (SHA-256 hashed keys) | ✅ Done |
| Threat trending endpoint (by period/region)       | ✅ Done |
| URL lookup with full enrichment data              | ✅ Done |
| Trending URLs (most-reported domains)             | ✅ Done |
| Domain aggregation with WHOIS data                | ✅ Done |
| Aggregate statistics endpoint                     | ✅ Done |
| OpenAPI 3.0 spec with Scalar docs                 | ✅ Done |
| Per-key daily rate limits                         | ✅ Done |

## Phase 4 — Content & Security Hardening ✅

| Feature                                     | Status  |
| ------------------------------------------- | ------- |
| Blog system with categories and pagination  | ✅ Done |
| Automated weekly blog generation (cron)     | ✅ Done |
| Weekly email digest (Resend)                | ✅ Done |
| BreadcrumbList JSON-LD (SEO)                | ✅ Done |
| Cookie-based admin auth (S1)                | ✅ Done |
| Unicode sanitization (S2)                   | ✅ Done |
| CSP hardening — no unsafe-eval (S3)         | ✅ Done |
| Fail-closed rate limiter in production (S4) | ✅ Done |
| x-real-ip for rate limiting (S5)            | ✅ Done |
| Signed unsubscribe URLs (HMAC)              | ✅ Done |
| Server-side redirect chain resolution       | ✅ Done |

## Phase 5 — Media & Advanced Analysis

| Feature                                                                      | Status                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Media upload to Cloudflare R2                                                | ✅ Done                                                                                                                                                                                                                                                                       |
| Media analysis endpoints (upload, analyze, status)                           | ✅ Done                                                                                                                                                                                                                                                                       |
| Deepfake detection provider SDKs (Reality Defender / Resemble AI)            | ✅ Done (client code in `lib/realityDefender.ts`, `lib/resembleDetect.ts`, orchestrator in `lib/deepfakeDetection.ts`)                                                                                                                                                        |
| **Deepfake detection wiring into `runMediaAnalysis`**                        | 🚧 Orphan code — `detectDeepfake()` exists but is never called from the media pipeline. Needs `/tmp` buffer write (Reality Defender) + presigned R2 GET URL (Resemble fallback) before flipping `NEXT_PUBLIC_FF_DEEPFAKE=true`. ~2 hours of wiring in `lib/mediaAnalysis.ts`. |
| `logCost` instrumentation on Reality Defender + Resemble + Whisper callsites | ✅ Done (2026-04)                                                                                                                                                                                                                                                             |
| Multi-image analysis (up to 10 images per request)                           | ✅ Done                                                                                                                                                                                                                                                                       |
| Per-IP sliding-window rate limit on image uploads (5/hour)                   | ✅ Done (2026-04)                                                                                                                                                                                                                                                             |
| Breach check API endpoint                                                    | ✅ Done                                                                                                                                                                                                                                                                       |

## Phase 5b — Soft Launch Readiness ✅

Pre-launch compliance, security hardening, and competitive feature parity.

### Compliance & Security

| Feature                                                                                                  | Status  |
| -------------------------------------------------------------------------------------------------------- | ------- |
| Apple AI consent flow (Guideline 5.1.2(i)) — mobile consent modal + AsyncStorage                         | ✅ Done |
| iOS `NSPrivacyCollectedDataTypes` declaration                                                            | ✅ Done |
| WhatsApp bot AI disclosure — first-time welcome message via Redis                                        | ✅ Done |
| Email HTML/CSS injection hardening — `stripEmailHtml()` server-side + client-side hidden element removal | ✅ Done |

### Feature Enablement

| Feature                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Status               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Phone intelligence wired into analysis pipeline (Twilio Lookup v2)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | ✅ Done              |
| Phone Risk Report Card — CNAM, risk score (0-100), carrier/line-type/country grid (web + mobile)                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | ✅ Done              |
| Rate limiter fix — page navigation exempted from global rate limit (API routes still protected)                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | ✅ Done              |
| Scam recovery guidance UI — structured Australian contacts (web + mobile)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | ✅ Done              |
| SEO blog content — 7 targeted Australian scam posts (seed script)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | ✅ Done              |
| Website Safety Audit — security header/TLS scanner with letter grade (`/audit` page)                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | ✅ Done              |
| Scam Report Card — moved inside ResultCard for prominence, with contact/URL reporting                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | ✅ Done              |
| PhoneIntelCard — hidden for high-confidence HIGH_RISK to avoid mixed signals                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ✅ Done              |
| Hero ResultCard simplification (AskSilver-inspired) — bordered verdict chip, left-bar red-flag cards, "Remember" disclaimer, centered "How did we do?" thumbs, full-width Report + Check-something-else pills. Two amber levels + red (never "safe"). Dropped: confidence meter, summary line, next steps, brand verification prompt, recovery guide, Scamwatch CTA, AI disclaimer. `NEXT_PUBLIC_FF_RESULT_SCREEN_V2` retired. Report button POSTs `userSays: "user_reported"` to `/api/feedback` + opens Scamwatch (migration v67 widens the `user_says` CHECK). | ✅ Done (2026-04-22) |

## Phase 7 — Intelligence Pipeline & External Enrichment ✅

Automated entity enrichment, external threat intelligence feeds, risk scoring with new signals, and deep investigation.

### External API Integrations ✅

| Feature                                                                           | Status  |
| --------------------------------------------------------------------------------- | ------- |
| AbuseIPDB v2 — IP abuse reputation (6h Redis cache)                               | ✅ Done |
| HIBP v3 — email breach exposure (24h Redis cache)                                 | ✅ Done |
| crt.sh — Certificate Transparency log search (12h Redis cache)                    | ✅ Done |
| Twilio Lookup v2 — migrated from web app to scam-engine package (24h Redis cache) | ✅ Done |
| URLScan.io — async URL scanning via Inngest (submit → wait → retrieve)            | ✅ Done |
| Feature flags for each API (independently toggleable)                             | ✅ Done |

### Entity Enrichment Pipeline ✅

| Feature                                                                         | Status  |
| ------------------------------------------------------------------------------- | ------- |
| Tier 1 inline enrichment (AbuseIPDB, HIBP, crt.sh, Twilio) in entity-enrichment | ✅ Done |
| Tier 2 async enrichment (URLScan.io) via separate Inngest function              | ✅ Done |
| Promise.allSettled — one API failure never blocks others                        | ✅ Done |
| Extended risk scoring RPC (v27) with new external intel signals                 | ✅ Done |
| Enrichment points cap raised 25 → 40                                            | ✅ Done |

### Deep Investigation Pipeline ✅

| Feature                                                                             | Status  |
| ----------------------------------------------------------------------------------- | ------- |
| GitHub Actions workflow (Sunday 2am UTC, gated by ENABLE_DEEP_INVESTIGATION)        | ✅ Done |
| Python investigation script (nmap, dnsrecon, nikto, whatweb, sslscan, whois)        | ✅ Done |
| investigation_data JSONB + investigated_at columns (v28)                            | ✅ Done |
| Safety: max 50 entities/run, 1s delay, private IP filtering, no active exploitation | ✅ Done |

### UI Changes

| Feature                                                                                | Status  |
| -------------------------------------------------------------------------------------- | ------- |
| PhoneIntelCard hidden from consumer web app (data flows to enrichment/scoring instead) | ✅ Done |
| Phone intel card deferred to B2B/Gov tier (see BACKLOG.md)                             | ✅ Done |

## Phase 8 — Scale & Growth

Future priorities. Items here may move to `BACKLOG.md` if deprioritized.

| Feature                                                                                      | Status                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Premium tier with rate limit tiers (Paddle)                                                  | ✅ Done                                                                                                                                                                                                             |
| User auth + dashboard + API key self-service (Supabase Auth)                                 | ✅ Done                                                                                                                                                                                                             |
| Family protection plan (shared check routing)                                                | Backend ✅ (v33), UI pending                                                                                                                                                                                        |
| Push scam alerts (FCM/APNs)                                                                  | Backend ✅ (v32), UI pending                                                                                                                                                                                        |
| Background SMS scanning (Android NotificationListenerService / iOS ILMessageFilterExtension) | Planned                                                                                                                                                                                                             |
| Call screening (Android CallScreeningService / iOS CallKit)                                  | Planned                                                                                                                                                                                                             |
| Deepfake detection pipeline wiring (Reality Defender / Resemble AI)                          | See Phase 5 — orphan code, needs wiring into runMediaAnalysis                                                                                                                                                       |
| Automated decision-making disclosure (Privacy Act tranche 1, Dec 2026)                       | Planned                                                                                                                                                                                                             |
| Chrome Web Store submission — v1.0.0 minimal zip                                             | ✅ Ready (zip built, assets staged at `apps/extension/dist/cws-assets/`, listing content drafted; user action required to upload)                                                                                   |
| Chrome Web Store submission — v1.0.1 with Facebook Ads + server gate                         | ✅ Built (`askarthurextension-1.0.1-chrome.zip`, 98.73 kB; requires Hive pricing contract + `HIVE_API_KEY` + `NEXT_PUBLIC_FF_FACEBOOK_ADS=true` in Vercel; 1–3 day CWS re-review for new Facebook host permissions) |
| Firefox / AMO submission (same source tree)                                                  | Planned — v1.1.0                                                                                                                                                                                                    |
| Google Play (Android mobile) submission                                                      | Planned                                                                                                                                                                                                             |
| Public threat intelligence feeds (real-time)                                                 | Planned                                                                                                                                                                                                             |
| Brand monitoring (impersonation detection)                                                   | Planned                                                                                                                                                                                                             |
| Carrier feeds integration (Telstra/Optus)                                                    | Planned                                                                                                                                                                                                             |
| White-label embed widget                                                                     | Planned                                                                                                                                                                                                             |
| Webhook notifications for new threats                                                        | Planned                                                                                                                                                                                                             |
| Public scam feed (`/scam-feed` + `/api/feed`, feature-flagged)                               | ✅ Done (v44)                                                                                                                                                                                                       |
| SOC/SIEM integration                                                                         | Planned                                                                                                                                                                                                             |

## Phase 9 — Data Partnerships & External Intelligence

Building Ask Arthur into a recognised contributor/consumer in Australia's anti-scam ecosystem.

### Phase 9a — Government & Industry Partnerships (non-code)

| Item                                                                                          | Status  |
| --------------------------------------------------------------------------------------------- | ------- |
| Submit NASC/Scamwatch partnership enquiry (data-sharing, SPF "third party gateway" candidacy) | Planned |
| Register as ASD Cyber Security Business Partner (cyber.gov.au/partnershipprogram)             | Planned |
| Explore AFCX (Australian Financial Crimes Exchange) Intel Loop membership                     | Planned |
| Structure collected data to align with Scamwatch categories                                   | Planned |

### Phase 9b — API Integrations (code — IPQualityScore is first)

| Item                                                                 | Status  |
| -------------------------------------------------------------------- | ------- |
| IPQualityScore phone fraud scoring (free tier, 1K/mo)                | Planned |
| ScamAdviser Number API (2.6B phone records, 50+ downstream partners) | Planned |
| Telesign Score API (phone risk scoring)                              | Planned |

### Phase 9c — Alliance Memberships (strategic)

| Item                                                                   | Status  |
| ---------------------------------------------------------------------- | ------- |
| GASA membership + Global Signal Exchange accreditation (320M+ signals) | Planned |
| Upgrade ASD to Network Partner (CTIS STIX machine-speed exchange)      | Planned |
| Explore Twilio Marketplace Publisher (AU scam intelligence add-on)     | Planned |

## Phase 10 — Government Partnerships & Data Exports ✅

Database infrastructure for government reporting, provider coordination, and financial impact tracking.

| Feature                                                                                         | Status        |
| ----------------------------------------------------------------------------------------------- | ------------- |
| Threat intel export views (4 views for government/law-enforcement)                              | ✅ Done (v38) |
| `get_threat_intel_export` RPC with filtering and pagination                                     | ✅ Done (v38) |
| Provider reporting tables (`provider_reports`, `provider_actions`)                              | ✅ Done (v39) |
| `submit_provider_report` + `get_unreported_entities` RPCs                                       | ✅ Done (v39) |
| Financial impact tracking on `scam_reports` (loss, currency, target region)                     | ✅ Done (v40) |
| `financial_impact_summary` view + `get_jurisdiction_summary` RPC                                | ✅ Done (v40) |
| Database consolidation — migrate `scam_contacts` → `scam_entities`, drop 4 legacy tables        | ✅ Done (v41) |
| Data quality backfill — 14K+ entities from canonical tables, risk scoring, confidence promotion | ✅ Done (v42) |

## Phase 11 — Unified Security Scanner ✅

Multi-type security scanner covering websites, Chrome extensions, MCP servers, and AI skills — all graded A+ to F.

| Feature                                                                                           | Status  |
| ------------------------------------------------------------------------------------------------- | ------- |
| Universal input bar with auto-detection (website/extension/MCP/skill)                             | ✅ Done |
| Chrome extension audit — CRX download, manifest + source analysis, 20+ checks, 8 categories       | ✅ Done |
| MCP server audit — npm registry + OSV.dev vulnerability queries, OWASP MCP Top 10, 24+ checks     | ✅ Done |
| AI skill audit — prompt injection, malware/AMOS indicators, ClickFix detection, 16+ checks        | ✅ Done |
| Shared pattern library — 60+ detection patterns (injection, secrets, exfiltration, typosquatting) | ✅ Done |
| Embeddable SVG badges — shield, pill, cert styles at `/api/badge`                                 | ✅ Done |
| Dynamic OG images for scan result sharing at `/api/og/scan`                                       | ✅ Done |
| Scan result persistence (`scan_results` table, `upsert_scan_result` RPC)                          | ✅ Done |
| Permalink scan result pages at `/scan/result/[token]`                                             | ✅ Done |
| Public scan feed at `/health/feed`                                                                | ✅ Done |
| Unified ScanResultReport component (grade ring, category breakdown, recommendations)              | ✅ Done |
| Reddit scraper keyword-based category classifier (backfill + future posts)                        | ✅ Done |
| Scam feed category illustrations — 13 AI-generated images (no-leaf, centered)                     | ✅ Done |
| Blog/character illustration system — faceless flat vector characters, 4 variants                  | ✅ Done |

## Phase 11b — Facebook Marketplace Scam Detection

Chrome extension content script for Marketplace listing analysis and Messenger PayID scam detection. Code is shipped in the v1.0.1 extension bundle but **gated off** behind `WXT_FACEBOOK_ADS` (build-time) + `NEXT_PUBLIC_FF_FACEBOOK_ADS` (server-side gate on `/api/extension/analyze-ad`). Flip both to activate.

| Feature                                                                          | Status                                                                                                                                        |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Marketplace listing seller trust scoring (join date, ratings, location mismatch) | ✅ Code shipped, flag-gated off                                                                                                               |
| Trust badge injection on listing pages (green/amber/red, shadow DOM)             | ✅ Code shipped, flag-gated off                                                                                                               |
| PayID scam pattern detection in Messenger chat (6 patterns, client-side)         | ✅ Code shipped, flag-gated off                                                                                                               |
| Chat warning banner injection (shadow DOM)                                       | ✅ Code shipped, flag-gated off                                                                                                               |
| Background API analysis via `/api/extension/analyze-ad`                          | ✅ Code shipped, server-side `NEXT_PUBLIC_FF_FACEBOOK_ADS` gate added (returns 503 when flag is off — defence against extracted-secret abuse) |
| SPA navigation resilience (MutationObserver + URL heartbeat)                     | ✅ Code shipped, flag-gated off                                                                                                               |
| Hive AI cost instrumentation (`logCost` on every sync-task call)                 | ✅ Done, `unitCostUsd: 0` placeholder pending pricing contract                                                                                |
| Hive AI pricing contract + `PRICING.HIVE_AI_USD_PER_IMAGE` constant              | 🚧 Planned — negotiate with Hive commercial, update `apps/web/lib/cost-telemetry.ts` + `analyze-ad/route.ts:155`                              |
| Selector regression tests for `ad-detector.ts`                                   | 🚧 Planned — Facebook restructures feed DOM ~monthly; capture 5–10 real feed HTML fixtures + write assertions against `detectSponsoredPost()` |
| Per-install hourly cap on `/api/extension/analyze-ad` (60/hour)                  | 🚧 Planned — defence-in-depth atop the existing 50/day bucket, bounds MutationObserver runaway                                                |

## Phase 11c — B2B Corporate Onboarding & Go-to-Market ✅

Multi-tenant organization support, persona-based dashboards, sector landing pages, and sales funnel infrastructure for the SPF Act compliance market.

### Data Foundation ✅

| Feature                                                                | Status  |
| ---------------------------------------------------------------------- | ------- |
| Organizations table with ABN, sector, tier, settings (v55)             | ✅ Done |
| Org members with 6-role RBAC (owner/admin/compliance/fraud/dev/viewer) | ✅ Done |
| Org invitations with hashed tokens and email delivery                  | ✅ Done |
| Org-scoped API keys (backward-compatible with user-scoped)             | ✅ Done |
| Leads table with nurture tracking and UTM (v56)                        | ✅ Done |
| Organization types package (Zod schemas, role permissions)             | ✅ Done |
| Feature flags: multiTenancy, corporateOnboarding                       | ✅ Done |
| Auth layer extended with orgId, orgRole, orgName                       | ✅ Done |
| Org helpers: getOrg, requireOrg, requireOrgRole, requireOrgPermission  | ✅ Done |

### Corporate Onboarding ✅

| Feature                                                    | Status  |
| ---------------------------------------------------------- | ------- |
| ABN Lookup integration (ABR XML API, Redis cached)         | ✅ Done |
| Multi-step onboarding wizard (4 steps)                     | ✅ Done |
| Lead capture API with Slack notifications                  | ✅ Done |
| Team invitation system with email delivery + acceptance    | ✅ Done |
| Team management UI (member list, role badges, invite form) | ✅ Done |
| Dashboard layout updated with org context + role-aware nav | ✅ Done |

### Persona Dashboards ✅

| Feature                                                                    | Status  |
| -------------------------------------------------------------------------- | ------- |
| Compliance Officer dashboard (SPF principle tracker, evidence export)      | ✅ Done |
| Fraud Analyst dashboard (threat investigations, entity explorer, clusters) | ✅ Done |
| Developer dashboard (API usage charts, endpoint breakdown)                 | ✅ Done |
| Executive dashboard (ROI summary, compliance gauge, trends)                | ✅ Done |

### Go-to-Market Pages ✅

| Feature                                                          | Status  |
| ---------------------------------------------------------------- | ------- |
| Banking sector landing page (/banking)                           | ✅ Done |
| Telco sector landing page (/telco)                               | ✅ Done |
| Digital platforms landing page (/digital-platforms)              | ✅ Done |
| Reusable SectorHero, SPFMappingTable, LeadCaptureForm components | ✅ Done |
| SPF Compliance Readiness Assessment (interactive lead magnet)    | ✅ Done |
| Cost of Non-Compliance Calculator (interactive lead magnet)      | ✅ Done |
| "Regulated Entity" custom tier on pricing page                   | ✅ Done |

### Email Nurture ✅

| Feature                                                                                                   | Status  |
| --------------------------------------------------------------------------------------------------------- | ------- |
| 6-email SPF compliance nurture sequence                                                                   | ✅ Done |
| Daily nurture cron job (/api/cron/nurture)                                                                | ✅ Done |
| Templates: SPF Intro, Reasonable Steps, Collective Intelligence, Case Study, Technical Overview, Deadline | ✅ Done |

## Phase 12 — Enterprise Readiness & Certifications

Security certifications, SLA infrastructure, and procurement readiness for mid-tier bank and telco sales.

| Feature                                                      | Status  |
| ------------------------------------------------------------ | ------- |
| Essential Eight ML1 self-assessment                          | Planned |
| Compliance automation platform (Vanta/Sprinto) setup         | Planned |
| SOC 2 Type I (point-in-time)                                 | Planned |
| ISO 27001:2022 implementation                                | Planned |
| SOC 2 Type II (12-month observation)                         | Planned |
| SLA monitoring and uptime dashboard (99.9% target)           | Planned |
| Security whitepaper for bank procurement                     | Planned |
| STIX/TAXII export for government-standard threat sharing     | Planned |
| AFCX Intel Loop integration format                           | Planned |
| Sender ID Register verification endpoint                     | Planned |
| IRAP assessment (when government contracts imminent)         | Planned |
| Stripe billing migration (replace Paddle)                    | Planned |
| Pricing overhaul (Pro $99, Business $449, Enterprise custom) | Planned |
| Fraud Manager dashboard (entity search, alerts, CSV export)  | Planned |

See `docs/pitch/certification-roadmap.md` for detailed sequence, costs, and timelines.

## Phase 13 — Cost Observability & Infrastructure Hardening

Introduced 2026-04 to close the loop between "paid API call" and "visible spend". Cost-attributable operations emit telemetry rows tagged by feature + provider; admin dashboard surfaces them; Telegram alerts catch anomalies.

### Tier 1 — Ground truth ✅

| Feature                                                                                      | Status  |
| -------------------------------------------------------------------------------------------- | ------- |
| `cost_telemetry` table + `daily_cost_summary` / `today_cost_total` views (migration v62)     | ✅ Done |
| `logCost()` fire-and-forget helper wrapped in `waitUntil` (`apps/web/lib/cost-telemetry.ts`) | ✅ Done |
| `PRICING` constants — Claude Haiku 4.5, Twilio Lookup v2, Resemble, OpenAI Whisper           | ✅ Done |
| `AnalysisResult.usage` surfaces token counts from `analyzeWithClaude`                        | ✅ Done |
| Per-IP sliding-window rate limit on `/api/analyze` image uploads (5/h)                       | ✅ Done |
| Bot queue → Supabase Database Webhook (event-driven, unmetered); deleted polling handler     | ✅ Done |
| `/api/bot-webhook` receiver + `/api/cron/bot-queue-sweep` safety-net (every 10 min)          | ✅ Done |

### Tier 2 — Observability surfaces ✅

| Feature                                                                                                                                                                                                                                | Status  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `logCost` instrumentation on 7 paid-API callsites: `web_analyze`, `extension_analyze`, `extension_analyze_ad`, `hive_ai`, `twilio_lookup`, `deepfake_audio` (Resemble), `deepfake_image` (Reality Defender), `transcription` (Whisper) | ✅ Done |
| Admin cost dashboard at `/admin/costs` (today + last-7d + WoW delta + top-5 features + 30-day breakdown)                                                                                                                               | ✅ Done |
| Daily Telegram threshold alert (every 6h, fires only when today > `DAILY_COST_THRESHOLD_USD`)                                                                                                                                          | ✅ Done |
| Weekly Telegram WoW digest (Sunday 22:00 UTC = Monday 08:00 AEST)                                                                                                                                                                      | ✅ Done |
| `sendAdminTelegramMessage` helper in `apps/web/lib/bots/telegram/sendAdminMessage.ts`                                                                                                                                                  | ✅ Done |
| Server-side `NEXT_PUBLIC_FF_FACEBOOK_ADS` gate on `/api/extension/analyze-ad` (503 until flipped, prevents extracted-secret abuse)                                                                                                     | ✅ Done |

### Tier 3 — Conditional future work

Triggered by specific events. Do not schedule speculatively.

| Feature                                                                                                            | Trigger                                                                      |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Threat-DB endpoint → Supabase Edge Function + Cloudflare CDN (scales daily-refresh fan-out to $0 at 10K+ installs) | `/api/extension/extension-security/threat-db` starts returning non-stub data |
| `cost_telemetry` retention job (180-day `pg_cron` delete, or archive to R2)                                        | Row count exceeds ~20M (~6 GB; Supabase Pro storage quota is 8 GB)           |
| Automated budget caps / kill-switches (hourly cron flips a Redis kill-switch at `DAILY_HARD_CAP_USD`)              | 2+ weeks of steady-state telemetry gives a baseline to alarm against         |
| Per-flag flip playbooks (Hive pricing → PRICING update → flag flip checklist, per Phase 5/11b)                     | Each paid-API feature flag flip                                              |

## Phase 14 — Vulnerability Intelligence

New data asset turning the 2026 vulnerability research (`docs/vulnerability-atlas-2026.md`) into a maintained DB that feeds all scanners and a B2B exposure product. Planning details in `docs/vulnerability-tooling-expansion.md` and `/Users/brendanmilton/.claude/plans/steady-wondering-lark.md`.

### Sprint 0 — Preconditions

| Feature                                                                                                                       | Status               |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `docs/vulnerability-atlas-2026.md` stub                                                                                       | ✅ Done (2026-04-21) |
| Phase 14 section added to ROADMAP                                                                                             | ✅ Done (2026-04-21) |
| URL Security Report entry in BACKLOG.md                                                                                       | Planned              |
| Decision: Claude-vision text extraction vs local tesseract.js for image-injection scan                                        | Planned              |
| Decision: `prompt_injection` category weight in mcp-audit (align with skill-scanner at 0.25, rebalance existing 6 categories) | Planned              |

### Sprint 1 — MCP surface + VIDB foundation

| Feature                                                                                                                                  | Status  |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Add `semver` to `@askarthur/mcp-audit` dependencies                                                                                      | Planned |
| MCP CVE rulepack (`packages/mcp-audit/src/cve-rulepack.ts`, 12 CVEs, semver range matching)                                              | Planned |
| MCP tool-description poisoning scanner (1a: README-scanning on npm package README)                                                       | Planned |
| Image-embedded prompt injection scan (Claude-vision path — extract text in existing analyze call)                                        | Planned |
| VIDB schema migration v63: `vulnerabilities`, `vulnerability_exposure_checks`, `vulnerability_detections`, `vulnerability_ingestion_log` | Planned |
| `pipeline/scrapers/vulnerabilities/cisa_kev.py` — first scraper                                                                          | Planned |

### Sprint 2 — VIDB fill-in

| Feature                                                                                      | Status  |
| -------------------------------------------------------------------------------------------- | ------- |
| NVD, GHSA, OSV, enhanced CERT AU scrapers                                                    | Planned |
| `common/vuln_db.py::bulk_upsert_vulnerabilities` helper                                      | Planned |
| `.github/workflows/scrape-vulnerabilities.yml` (weekly, gated by `vars.ENABLE_VULN_SCRAPER`) | Planned |
| Inngest AU-context enrichment (banks/gov affected, modeled after existing `ct-monitor.ts`)   | Planned |
| Admin vulnerability dashboard stub at `/admin/vulnerabilities`                               | Planned |

### Sprint 3 — Extension hardening

| Feature                                                                                                   | Status  |
| --------------------------------------------------------------------------------------------------------- | ------- |
| Migration v64: `extension_version_history` + `compare_extension_versions` RPC                             | Planned |
| Extension hollowing detector — `scanExtension()` accepts `previousVersion`, hashes worker/content scripts | Planned |
| DOM-clickjacking detector (EXT-062, references VU#516608)                                                 | Planned |
| Indirect injection scan on fetched URLs in `resolveRedirects`                                             | Planned |

### Sprint 4 — B2B surface

| Feature                                                                                                   | Status  |
| --------------------------------------------------------------------------------------------------------- | ------- |
| MCP lethal-trifecta composition scanner (`packages/mcp-audit/src/trifecta.ts`)                            | Planned |
| `/api/v1/vulnerabilities/*` — search, get, exposure-report, inventory, webhooks (reuses `validateApiKey`) | Planned |
| `docs/openapi.yaml` updated with vulnerability schemas                                                    | Planned |
| B2B webhook on new matching CVE (Inngest event-driven)                                                    | Planned |

### Sprint 5 — Consumer tools

| Feature                                                                                                                                 | Status  |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| URL Security Report deep scan — **only 7 net-new checks** (SEC-001..SEC-004, SEC-006..SEC-008); others already in `packages/site-audit` | Planned |
| MCP Config Safety Check (`/tools/mcp-config-check`, `packages/mcp-audit/src/config-audit.ts`)                                           | Planned |
| Tool-poisoning scan on pasted config (deferred 1b — realistic data source for `packageData.tools` checks)                               | Planned |

### Later (post-monetisation)

| Feature                                                                    | Trigger                                 |
| -------------------------------------------------------------------------- | --------------------------------------- |
| Scam-Site Technical Fingerprint (pig butchering, wallet drainer, AiTM kit) | Demand from bank customer conversations |
| Deepfake advisory (mobile)                                                 | Mobile install base crosses threshold   |
| Supply-Chain Exposure Check (developer-facing)                             | Developer audience becomes strategic    |
| Crescendo / session-state detection for bots                               | Bot abuse signals warrant it            |

---

## Hardening Sprint (Apr 2026) — follow-ups

Scope-closed in migrations v68–v71 and the accompanying commit. The sprint
addressed the four-agent review (schema, integrations, observability, data
layer) landing on B+/C+/C+. Remaining operator/product work:

| Item                                                                      | Status             | Notes                                                                                        |
| ------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------- |
| PII debug logs removed from `/api/analyze`                                | ✅ Done            | Replaced with `logger.info` + `maskE164`/`maskEmail`                                         |
| `bot_message_queue` terminal-state PII clear + 24h/48h purge cron         | ✅ Done            | `/api/cron/bot-queue-cleanup`                                                                |
| `scam_reports` archive-on-age (90d SAFE, 180d HIGH_RISK)                  | ✅ Done            | v68 + `/api/cron/scam-reports-retention`; `scam_reports_all` view union                      |
| APL data export + deletion endpoints                                      | ✅ Done            | `/api/user/export-data`, `/api/user/delete-account`                                          |
| **UI for export/delete on `/settings/account`**                           | Planned            | APIs live, need a user-facing surface                                                        |
| Resend cost tracking on all email paths                                   | ✅ Done            | `RESEND_USD_PER_EMAIL` in `PRICING`; `logCost()` on welcome/digest/admin-notification        |
| Stripe webhook idempotency                                                | ✅ Done            | v70 `stripe_event_log` + insert-with-conflict gate                                           |
| Admin-RPC service-role lockdown                                           | ✅ Done            | v69 REVOKE on `fraud_manager_search` + enrichment trigger fn                                 |
| Reddit scraper victim/scammer classifier                                  | ✅ Done            | Context-window heuristic; victim matches are dropped, not persisted                          |
| `/admin/health` dashboard (queue, archive, Stripe, feeds)                 | ✅ Done            | Read-only overview                                                                           |
| Partitioning scaffolds for `cost_telemetry`, `scam_reports`, `feed_items` | ✅ Done            | v71 + `ensure_next_month_partitions` daily cron                                              |
| **Partitioning cutover (live table swap)**                                | 🔄 Operator action | Per-table, smallest first; follow `docs/partitioning-runbook.md` during a maintenance window |
| Claude vision image-token surcharge split out of input_tokens             | Planned            | Currently rolled into total input tokens; split for dashboard accuracy                       |
| Error-rate Telegram alerting beyond cost thresholds                       | Planned            | `/admin/health` surfaces the signal; next step is a threshold cron                           |
| Cache hit-rate telemetry (Redis)                                          | Planned            | Upstash doesn't instrument; would need wrapper counters in `getCachedAnalysis`               |
| DLQ table for Inngest / bot-queue terminal failures                       | Planned            | `bot_message_queue.status='failed'` partly covers; Inngest max-retry failures still silent   |

---

## Status Key

| Icon    | Meaning                  |
| ------- | ------------------------ |
| ✅      | Complete and deployed    |
| 🔄      | In progress              |
| Planned | Accepted but not started |

For deferred platform-specific features, see `BACKLOG.md`.
