# Architecture

System design, data flows, and API contracts for the Ask Arthur platform.

---

## High-Level Overview

Ask Arthur is a multi-platform scam detection service. Users submit suspicious content (text, URLs, images) via web app, browser extension, mobile app, or chat bots. The platform analyzes submissions using AI (Claude) + threat intelligence feeds, returns a verdict, and stores confirmed threats for community protection.

```
┌──────────────────────────────────────────────────────────┐
│                    User Surfaces                          │
│  Web App  │  Extension  │  Mobile  │  Bots (4 platforms) │
└─────┬──────────┬───────────┬──────────┬──────────────────┘
      │          │           │          │
      ▼          ▼           ▼          ▼
┌──────────────────────────────────────────────────────────┐
│              Next.js API Routes (Vercel)                  │
│  /api/analyze  │  /api/extension/*  │  /api/webhooks/*   │
└─────┬──────────────────┬────────────────────┬────────────┘
      │                  │                    │
      ▼                  ▼                    ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐
│ Scam Engine  │  │  Bot Core    │  │  Threat Intel API    │
│ (Claude AI)  │  │  (Formatters)│  │  /api/v1/threats/*   │
└──────┬───────┘  └──────────────┘  └──────────┬───────────┘
       │                                        │
       ▼                                        ▼
┌──────────────────────────────────────────────────────────┐
│                   Data Layer                              │
│  Supabase (PostgreSQL)  │  Upstash Redis  │  R2 Storage  │
└──────────────────────────────────────────────────────────┘
       ▲
       │
┌──────┴───────────────────────────────────────────────────┐
│              Background Processing                        │
│  Inngest (9 functions)  │  Python Scrapers (16 feeds)    │
│  GitHub Actions (cron)  │  Deep Investigation Pipeline   │
└──────────────────────────────────────────────────────────┘
```

## Monorepo Structure

```
ask-arthur/
├── apps/
│   ├── web/                    # @askarthur/web — Next.js 16 (Turbopack)
│   ├── extension/              # @askarthur/extension — Chrome/Firefox (WXT)
│   └── mobile/                 # @askarthur/mobile — React Native (Expo 54)
│
├── packages/
│   ├── types/                  # @askarthur/types — Zod schemas, TS interfaces
│   ├── supabase/               # @askarthur/supabase — Client factories (server/browser)
│   ├── utils/                  # @askarthur/utils — Logger, hash, rate-limit, feature-flags
│   ├── scam-engine/            # @askarthur/scam-engine — Claude analysis, pipeline, Inngest
│   └── bot-core/               # @askarthur/bot-core — Bot formatters, webhook verify, queue
│
├── tooling/
│   └── typescript/             # @askarthur/tsconfig — Shared TS configs (base, nextjs, node)
│
├── pipeline/
│   └── scrapers/               # Python threat feed scrapers (16 feeds)
│       ├── common/             # Shared utilities (db, normalize, validate)
│       └── tests/              # Pytest suite
│
├── supabase/                   # Migration SQL files (v2–v44)
├── docs/                       # OpenAPI spec, setup guides, pitch materials
│
├── turbo.json                  # Turborepo task configuration
├── pnpm-workspace.yaml         # Workspace manifest
└── .npmrc                      # pnpm settings
```

## Core Data Flow: Analysis

The main analysis pipeline (`/api/analyze`) processes user submissions:

```
Request
  │
  ├─ 1. Payload size check (413 if >10MB)
  ├─ 2. Rate limit check (429 if exceeded)
  │     └─ Two-tier: 3/hour burst + 10/day per IP+UA hash
  ├─ 3. Input validation (Zod schema)
  ├─ 4. Injection pattern detection (14 regex patterns)
  ├─ 5. Cache lookup (text-only, Upstash Redis)
  │     └─ Cache hit → return cached verdict, increment stats
  ├─ 6. URL extraction & validation
  │     ├─ Google Safe Browsing API check
  │     └─ Redirect chain resolution (if feature flag enabled)
  ├─ 7. Parallel processing
  │     ├─ Claude AI analysis (with images if provided)
  │     ├─ URL reputation checks
  │     └─ IP geolocation (ip-api.com)
  ├─ 8. Verdict merging
  │     ├─ Escalate to HIGH_RISK if any URL flagged
  │     └─ Floor to SUSPICIOUS if injection detected
  ├─ 9. Phone intelligence (HIGH_RISK/SUSPICIOUS only)
  │     ├─ Extract phone numbers from text
  │     ├─ Twilio Lookup v2 (line type + CNAM, $0.018/lookup)
  │     ├─ Compute 0-100 risk score (VoIP, non-AU, unknown type, invalid, no carrier, no CNAM)
  │     └─ Inject VoIP/non-AU findings as red flags
  ├─ 10. Background work (Vercel waitUntil)
  │     ├─ Store HIGH_RISK verdicts to Supabase
  │     ├─ Increment statistics counters
  │     └─ Cache text-only results in Redis
  └─ 11. Response with rate limit headers
```

### Request Schema

```typescript
{
  text?: string       // Max 10,000 characters
  image?: string      // Legacy single image (base64)
  images?: string[]   // Multi-image (max 10, each max 5MB)
  mode?: "text" | "image" | "qrcode"
}
```

### Response Schema

```typescript
{
  verdict: "SAFE" | "SUSPICIOUS" | "HIGH_RISK"
  confidence: number      // 0.0–1.0
  summary: string         // Max 500 chars
  redFlags: string[]      // Max 10 items
  nextSteps: string[]     // Max 10 items
  scamType: string        // e.g. "phishing", "impersonation"
  impersonatedBrand: string | null
  channel: "email" | "sms" | "social_media" | "phone" | "website" | "other"
  scammerContacts: {
    phoneNumbers: { value: string, context: string }[]
    emailAddresses: { value: string, context: string }[]
  }
  phoneIntelligence?: {     // Present when phone detected in HIGH_RISK/SUSPICIOUS
    valid: boolean
    phoneNumber: string     // E.164 format
    countryCode: string | null
    nationalFormat: string | null
    lineType: string | null // "mobile" | "landline" | "nonFixedVoip" | ...
    carrier: string | null
    isVoip: boolean
    riskFlags: string[]
    riskScore: number       // 0-100 composite risk score
    riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
    callerName: string | null      // CNAM registered name
    callerNameType: string | null  // "business" | "consumer" | null
  }
}
```

## API Routes

### Public Web API

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/analyze` | POST | Main scam analysis endpoint |
| `/api/breach-check` | POST | Check if email in data breach |
| `/api/stats` | GET | Public threat statistics |
| `/api/subscribe` | POST | Newsletter subscription |
| `/api/unsubscribe` | GET | Newsletter unsubscribe |
| `/api/unsubscribe-one-click` | POST | RFC 8058 one-click unsubscribe |
| `/api/feed` | GET | Public paginated scam feed (filters, FTS, country) |
| `/api/feed/proxy-image` | GET | Reddit image proxy (CORS/hotlink bypass) |

### Scam Data Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/scam-urls/lookup` | GET | Check if URL is a known scam |
| `/api/scam-urls/report` | POST | Report new scam URL |
| `/api/scam-contacts/lookup` | GET | Check phone number/email |
| `/api/scam-contacts/report` | POST | Report malicious contact |

### Media Analysis

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/media/upload` | POST | Upload image/video for analysis |
| `/api/media/analyze` | POST | Analyze deepfake media |
| `/api/media/status` | GET | Check analysis progress |

### Extension API

Authenticated via per-install ECDSA P-256 signature (`X-Extension-Install-Id`, `X-Extension-Timestamp`, `X-Extension-Nonce`, `X-Extension-Signature`). CORS is wildcard (auth is enforced in the headers, not at the origin). See "Extension identity & request signing" below for the full flow.

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/extension/register` | POST | One-time Turnstile-gated registration — stores the install's public key |
| `/api/extension/url-check` | POST | Quick URL verification |
| `/api/extension/analyze` | POST | Full analysis from extension |
| `/api/extension/analyze-ad` | POST | Full ad analysis (text + landing URL + image) |
| `/api/extension/check-ad` | GET | Community flag lookup by ad text hash |
| `/api/extension/flag-ad` | POST | Community flag submission |
| `/api/extension/extension-security/analyze` | POST | Scan installed extensions (CRX parsing) |
| `/api/extension/extension-security/threat-db` | GET | Fetch malicious-extension threat DB |
| `/api/extension/report-email` | POST | Report suspicious email |
| `/api/extension/subscription` | GET | Extension tier lookup (Pro / free) |
| `/api/extension/heartbeat` | GET | Health check / keep-alive |

### Security Scanner API

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/site-audit/stream` | POST | Website health check (SSE streaming) |
| `/api/extension-audit` | POST | Chrome extension security scan (CRX analysis, 20+ checks) |
| `/api/mcp-audit` | POST | MCP server/npm package scan (OSV.dev, OWASP MCP Top 10) |
| `/api/skill-audit` | POST | OpenClaw/Claude skill scan (prompt injection, malware detection) |
| `/api/badge` | GET | Embeddable SVG security badge (shield/pill/cert styles) |
| `/api/og/scan` | GET | Dynamic OG image for scan result sharing |

### Bot Webhooks

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/webhooks/telegram` | POST | Telegram bot webhook |
| `/api/webhooks/whatsapp` | POST | WhatsApp bot webhook |
| `/api/webhooks/slack` | POST | Slack event webhook |
| `/api/webhooks/slack/shortcuts` | POST | Slack slash commands |
| `/api/webhooks/messenger` | POST | Facebook Messenger webhook |
| `/api/webhooks/paddle` | POST | Paddle subscription webhook |

### Corporate Onboarding & Organization API

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/org/create` | POST | Create organization + owner membership |
| `/api/org/members` | GET/PATCH | List/update org members |
| `/api/org/invite` | POST | Send team invitation email |
| `/api/org/invite/accept` | POST | Accept invitation via hashed token |
| `/api/leads` | POST | Corporate lead capture (Zod-validated, Slack notification) |
| `/api/abn-lookup` | GET | Australian Business Number verification (ABR API) |
| `/api/cron/nurture` | GET | Daily nurture email delivery (6-email sequence) |

### B2B Threat Intelligence API (v1)

Authenticated via Bearer token (API key). See `docs/openapi.yaml` for full spec.

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/v1/threats/trending` | GET | Trending scam types by period/region |
| `/api/v1/threats/urls/lookup` | GET | Look up URL threat data |
| `/api/v1/threats/urls/trending` | GET | Most-reported domains |
| `/api/v1/threats/domains` | GET | Domain aggregation & WHOIS |
| `/api/v1/threats/stats` | GET | Aggregate threat statistics |
| `/api/v1/openapi.json` | GET | OpenAPI 3.0 spec (Scalar docs) |

### Cron Routes

| Route | Schedule | Purpose |
|-------|----------|---------|
| `/api/cron/weekly-email` | Weekly | Send summary emails via Resend |
| `/api/cron/weekly-blog` | Weekly | Generate blog posts |
| `/api/cron/pipeline-health` | Periodic | Monitor threat pipeline |
| `/api/cron/process-bot-queue` | Periodic | Process async bot messages |
| `/api/cron/nurture` | Daily 9am AEST | Corporate lead nurture email sequence |

### Internal

| Route | Purpose |
|-------|---------|
| `/api/inngest` | Inngest event handler |
| `/api/admin/login` | Cookie-based admin authentication |

## Database Schema

### Supabase (PostgreSQL)

56 migration files (`supabase/migration.sql` through `migration-v56-leads.sql`). 36+ tables, 5 views, 36+ RPCs.

**Core Tables:**

| Table | Purpose |
|-------|---------|
| `verified_scams` | Confirmed HIGH_RISK submissions (PII-scrubbed) |
| `scam_urls` | Known malicious URLs with enrichment data (164K+) |
| `scam_ips` | Malicious IP intelligence (140K+) |
| `scam_crypto_wallets` | Scam-associated crypto wallet addresses |
| `scam_reports` | Central report node for all user analyses (v21) |
| `scam_entities` | Unified entity lookup layer — phone, email, URL, domain, IP, crypto, bank account (v21, 14K+) |
| `report_entity_links` | Many-to-many junction between reports and entities (v21) |
| `scam_clusters` | Groups of related scam reports by shared entities (v22) |
| `cluster_members` | Cluster membership junction table (v22) |
| `check_stats` | Daily analysis counters by verdict and region |
| `api_keys` | B2B API key hashes, tiers, daily limits |
| `subscriptions` | Paddle subscription records linked to API keys |
| `user_profiles` | User profiles (role, display name, company) linked to auth.users |
| `organizations` | Corporate client organizations with ABN, sector, tier (v55) |
| `org_members` | Organization membership with 6-role RBAC (v55) |
| `org_invitations` | Pending team invitations with hashed tokens (v55) |
| `leads` | Corporate sales pipeline with nurture tracking (v56) |
| `api_usage_log` | Per-key, per-endpoint, per-day API usage tracking |
| `email_subscribers` | Newsletter subscribers |
| `blog_posts` | Blog content with categories and full-text search |
| `blog_categories` | Blog category taxonomy |
| `bot_message_queue` | Async bot message processing queue |
| `feed_ingestion_log` | Scraper run tracking with record counts |
| `phone_lookups` | Twilio phone intelligence results (risk score, CNAM, carrier) |
| `media_analyses` | Uploaded media analysis jobs (deepfake detection) |
| `sites` | Website audit targets with grades |
| `site_audits` | Individual audit results with test scores |
| `device_push_tokens` | Expo push notification tokens (v32) |
| `family_groups` | Family protection groups (v33) |
| `family_members` | Family group membership (v33) |
| `family_activity_log` | Family check activity (v33) |
| `extension_subscriptions` | Extension tier tracking (v34) |
| `phone_reputation` | Community phone reputation data (v35) |
| `reddit_processed_posts` | Reddit scraper deduplication (v36) |
| `feed_items` | Unified public scam feed — Reddit posts, verified scams, user reports (v44) |
| `provider_reports` | Reports submitted to ACCC/AFP/banks/telcos (v39) |
| `provider_actions` | Provider response actions (v39) |

**Views (v38–v40):**

| View | Purpose |
|------|---------|
| `threat_intel_entities` | High-value entities (report_count >= 2 OR risk HIGH/CRITICAL) for government export |
| `threat_intel_urls` | Active, high-confidence URLs for blocklist feeds |
| `threat_intel_daily_summary` | Daily trends by region from check_stats and scam_reports |
| `threat_intel_scam_campaigns` | Campaign-level reporting from scam_clusters |
| `financial_impact_summary` | Loss aggregates by date, scam_type, channel, region, currency (v40) |

**Key RPCs (32 total):**

| RPC | Purpose |
|-----|---------|
| `create_scam_report` | Insert report row, return ID (v21) |
| `upsert_scam_entity` | Upsert entity, bump report_count (v21) |
| `link_report_entity` | Idempotent junction insert (v21) |
| `upsert_scam_url` | Upsert URL with feed attribution (v3) |
| `compute_entity_risk_score` | Composite 0-100 risk score per entity (v27) |
| `bulk_upsert_feed_url` | Batch feed URL ingestion (v15) |
| `bulk_upsert_feed_ip` | Batch feed IP ingestion (v15) |
| `bulk_upsert_feed_entity` | Batch feed entity ingestion (v36) |
| `get_threat_intel_export` | Paginated JSONB entity export for government (v38) |
| `submit_provider_report` | Create provider report with duplicate check (v39) |
| `get_unreported_entities` | Find HIGH+ risk entities not yet reported (v39) |
| `record_financial_impact` | Attach loss data to a report (v40) |
| `get_jurisdiction_summary` | Per-region loss aggregates for state police (v40) |
| `generate_api_key_record` | Create API key with user ownership (v30) |
| `increment_check_stats` | Atomic daily counter increment (v2) |
| `upsert_feed_item` | Upsert feed item on (source, external_id) conflict (v44) |

### Upstash Redis

- Analysis result cache (text-only submissions)
- Rate limiting buckets (sliding window)
- Feature flags

### Cloudflare R2

- Uploaded media (images/screenshots from submissions)
- Stored with structured key paths

## Inngest Background Functions

Eleven event-driven functions registered in `@askarthur/scam-engine/inngest/functions`:

| Function | Schedule | Purpose |
|----------|----------|---------|
| Staleness — URLs | Daily 3am UTC | Mark URLs inactive after 7 days |
| Staleness — IPs | Daily 3am UTC | Mark IPs inactive after 7 days |
| Staleness — Wallets | Daily 3am UTC | Mark wallets inactive after 14 days |
| Enrichment Fan-Out | Every 6 hours | WHOIS + SSL enrichment for pending URLs (20 domains/run) |
| CT Monitor | Every 12 hours | Certificate Transparency monitoring for AU brand impersonation |
| Entity Enrichment | Every 4 hours | Two-tier enrichment for entities with 3+ reports. Tier 1 (inline): local intel + AbuseIPDB + HIBP + crt.sh + Twilio. All via Promise.allSettled |
| URLScan Enrichment | Every 4 hours (+30 min) | Tier 2 async: submits URLs to URLScan.io, waits 60s, retrieves results |
| Cluster Builder | Daily 4am UTC | Groups related scam reports by shared entities |
| Risk Scorer | Every 6 hours | Computes composite 0-100 risk scores per entity via SQL RPC |
| Feed Sync — Verified Scams | Every 15 minutes | Syncs recent verified_scams into feed_items table |
| Feed Sync — User Reports | Every 15 minutes | Syncs HIGH_RISK user reports into feed_items table |

## Threat Intelligence Pipeline

16 Python scrapers in `pipeline/scrapers/` ingest from external threat feeds:

| Scraper | Feed |
|---------|------|
| `abuseipdb.py` | AbuseIPDB malicious IP reports |
| `cert_au.py` | CERT Australia advisories |
| `crtsh.py` | Certificate Transparency logs (brand impersonation) |
| `cryptoscamdb.py` | Crypto scam database |
| `feodo.py` | Feodo botnet C2 tracker |
| `ipsum.py` | IPSUM proxy detection |
| `openphish.py` | OpenPhish phishing URLs |
| `phishing_army.py` | Phishing Army blocklist |
| `phishing_database.py` | Phishing Database feed |
| `phishstats.py` | PhishStats API |
| `phishtank.py` | PhishTank community DB |
| `reddit_scams.py` | Reddit scam subreddit scraper |
| `scamwatch_rss.py` | ACCC Scamwatch RSS feed |
| `spamhaus.py` | Spamhaus DROP/EDROP blocklists |
| `threatfox.py` | ThreatFox malware/C2 IOCs |
| `urlhaus.py` | URLhaus malware hosting |

Scrapers run on GitHub Actions (scheduled, gated by `ENABLE_SCRAPER` repo variable). They use a shared `common/` library for URL normalization, database operations, validation, and R2 evidence storage.

## Deep Investigation Pipeline

Weekly passive reconnaissance on CRITICAL/HIGH risk entities using Linux security tools. Runs on GitHub Actions (Sunday 2am UTC, gated by `ENABLE_DEEP_INVESTIGATION` repo variable).

| Tool | Entity Types | What It Produces |
|------|-------------|-----------------|
| `nmap -sV` | IP | Open ports, service versions, OS guess |
| `nmap --script ssl-enum-ciphers` | IP | Weak ciphers, deprecated TLS |
| `whois` | IP | ASN, network name, bulletproof hosting detection |
| `dnsrecon` | Domain | Subdomains, zone transfer, wildcard DNS |
| `whatweb` | Domain | Technology fingerprinting (CMS, frameworks) |
| `sslscan` | Domain | Protocol support, self-signed certs |
| `nikto` | URL | Exposed admin panels, directory listings |
| `curl -sI` | URL | Security headers, redirect chain |

Results stored in `scam_entities.investigation_data` JSONB. Max 50 entities/run, 1s delay between targets, private IP filtering, no active exploitation.

## Government & Provider Reporting

Infrastructure for submitting scam intelligence to Australian government agencies, banks, and telcos (v38–v40).

### Threat Intel Export (v38)

Four views provide pre-formatted data for government/law-enforcement consumption:
- `threat_intel_entities` — high-value entities with linked report aggregates
- `threat_intel_urls` — active, high-confidence URLs for blocklist feeds
- `threat_intel_daily_summary` — daily trends by region
- `threat_intel_scam_campaigns` — campaign-level reporting from clusters

All views use `security_invoker = true` (caller's RLS, not definer's).

`get_threat_intel_export()` RPC provides paginated JSONB export with filtering by entity type, risk level, date range, and scam type.

### Provider Reporting (v39)

Two tables track outbound reports to providers (ACCC, AFP, ACSC, big-4 banks, Telstra, Optus):
- `provider_reports` — report lifecycle (queued → submitted → acknowledged → actioned → closed)
- `provider_actions` — actions taken by providers (blocked, suspended, takedown, etc.)

RPCs: `submit_provider_report()` (with duplicate detection), `get_unreported_entities()` (finds reportable entities by risk level).

### Financial Impact Tracking (v40)

Scam reports can include financial loss data (`estimated_loss`, `loss_currency`, `target_region`, `target_country`). The `financial_impact_summary` view aggregates losses by date, scam type, channel, and region. `get_jurisdiction_summary()` provides per-state aggregates for police coordination.

## Bot Architecture

### Shared Bot Core (`@askarthur/bot-core`)

All four bot platforms share:
- **Analysis**: `analyzeForBot()` — runs Claude + URL checks in parallel
- **Formatting**: Platform-specific formatters (Telegram HTML, WhatsApp markdown, Slack Block Kit, Messenger plain text)
- **Webhook verification**: HMAC-SHA256 signature validation per platform
- **Rate limiting**: 5 checks/hour per user (sliding window, Upstash)
- **Queue**: Async message processing via Supabase `bot_message_queue` table

### Message Flow

```
Webhook received → Signature verify → Rate limit check → Enqueue message
                                                              │
Cron: /api/cron/process-bot-queue → Dequeue batch → Analyze → Format → Reply
```

## Extension Architecture

### WXT Framework (Chrome/Firefox)

```
entrypoints/
├── background.ts              # Service worker (message routing, context menus, registration)
├── offscreen/                 # Hosts the Turnstile iframe for one-time registration
└── popup/App.tsx              # Popup UI (URL + text analysis)
```

- **Popup**: 380px fixed width, segmented tabs (URL / Text)
- **Auth**: Per-install ECDSA P-256 keypair signs every request. See "Extension identity & request signing" below.

### Extension identity & request signing

Chrome (and the CRX format) gives a server no way to cryptographically verify that a request originated from a store-installed extension — the CRX packaging key is never exposed to runtime, there is no `chrome.runtime.sign()`, and Web Environment Integrity was abandoned in 2023. Shared secrets baked into the bundle (the pre-2026-04 pattern) are trivially extractable via `unzip extension.crx` and are the root cause of the 2025 Symantec extension-key breach report. We run the most defensible no-login alternative:

1. **Keypair generation** (`apps/extension/src/lib/identity.ts`) — on first run, `crypto.subtle.generateKey({name:'ECDSA', namedCurve:'P-256'}, extractable=false, ['sign','verify'])`. The keypair is persisted in IndexedDB; non-extractable `CryptoKey` handles survive MV3 service-worker restarts via structured clone.
2. **Registration** (`apps/extension/src/lib/register.ts` + `src/entrypoints/offscreen/`) — a one-shot MV3 offscreen document iframes `https://askarthur.au/extension-turnstile`, the Turnstile widget runs, the token is `postMessage`d back and forwarded to the background via `chrome.runtime.sendMessage`. Background POSTs `{installId, publicKeyJwk, turnstileToken}` to `/api/extension/register`. The server verifies the token via Cloudflare siteverify and upserts the public key into `extension_installs`. Turnstile rejects `chrome-extension://` origins directly — hosting the bridge iframe on our own domain is the supported workaround.
3. **Request signing** (`apps/extension/src/lib/sign.ts`) — every API call signs `${METHOD}\n${PATH}\n${TIMESTAMP}\n${NONCE}\n${BASE64(SHA256(BODY))}` with the private key and attaches four `X-Extension-*` headers. Server-side verification (`apps/web/app/api/extension/_lib/signature.ts`) checks a ±5 min clock-skew window, rejects replayed nonces via Upstash SETNX (10 min TTL), fetches the public key from `extension_installs` (cached in Redis 5 min), and verifies the signature. The install ID is a random UUID stored in `chrome.storage.local` so existing `extension_subscriptions` mappings key the same way.

## User Authentication

Supabase Auth with PKCE flow, feature-flagged behind `NEXT_PUBLIC_FF_AUTH`.

| Component | File |
|-----------|------|
| Auth server client (RLS-aware) | `packages/supabase/src/server-auth.ts` |
| Middleware client (token refresh) | `packages/supabase/src/middleware.ts` |
| Browser client (cookie auth) | `packages/supabase/src/browser.ts` |
| Auth helpers (`getUser`, `requireAuth`) | `apps/web/lib/auth.ts` |
| Session refresh + route protection | `apps/web/middleware.ts` |
| Admin dual-mode (Supabase + HMAC) | `apps/web/lib/adminAuth.ts` |

**Protected routes:**
- `/app/*` — requires authenticated user (redirects to `/login`)
- `/admin/*` — requires admin role (Supabase Auth) or HMAC cookie (legacy)

**Auth flow:** Signup → email confirmation → login → dashboard → API key creation → billing checkout

## External Services

| Service | Purpose |
|---------|---------|
| Anthropic (Claude) | AI scam analysis (claude-haiku-4-5) |
| Supabase | PostgreSQL database + auth |
| Upstash | Redis cache + rate limiting |
| Vercel | Hosting + serverless functions |
| Cloudflare R2 | Media storage + public CDN for feed images |
| Google Safe Browsing | URL reputation |
| Resend | Transactional email |
| Twilio | Phone number lookup |
| Inngest | Background job orchestration |
| Plausible | Privacy-first analytics |
| InboxSDK | Gmail extension integration |
| Paddle | Merchant-of-record billing (B2B API subscriptions) |
| Reality Defender / Resemble AI | Deepfake detection (media analysis) |
