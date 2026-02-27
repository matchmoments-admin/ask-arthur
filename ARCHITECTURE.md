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
│  Inngest (5 functions)  │  Python Scrapers (14 feeds)    │
│  GitHub Actions (cron)  │  Cron API routes (4)           │
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
│   └── scrapers/               # Python threat feed scrapers (14 feeds)
│       ├── common/             # Shared utilities (db, normalize, validate)
│       └── tests/              # Pytest suite
│
├── supabase/                   # Migration SQL files (v2–v18)
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

Authenticated via `X-Extension-Secret` + `X-Extension-Id` headers. CORS enabled.

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/extension/url-check` | POST | Quick URL verification |
| `/api/extension/analyze` | POST | Full analysis from extension |
| `/api/extension/heartbeat` | GET | Health check / keep-alive |
| `/api/extension/report-email` | POST | Report suspicious email |

### Bot Webhooks

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/webhooks/telegram` | POST | Telegram bot webhook |
| `/api/webhooks/whatsapp` | POST | WhatsApp bot webhook |
| `/api/webhooks/slack` | POST | Slack event webhook |
| `/api/webhooks/slack/shortcuts` | POST | Slack slash commands |
| `/api/webhooks/messenger` | POST | Facebook Messenger webhook |

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

### Internal

| Route | Purpose |
|-------|---------|
| `/api/inngest` | Inngest event handler |
| `/api/admin/login` | Cookie-based admin authentication |

## Database Schema (Key Tables)

### Supabase (PostgreSQL)

19 migration files (`supabase/migration.sql` through `migration-v19-phone-intel.sql`).

**Core Tables:**

| Table | Purpose |
|-------|---------|
| `verified_scams` | Confirmed HIGH_RISK submissions (PII-scrubbed) |
| `scam_urls` | Known malicious URLs with enrichment data |
| `scam_contacts` | Reported phone numbers and emails |
| `check_stats` | Daily analysis counters by verdict and region |
| `api_keys` | B2B API key hashes, tiers, daily limits |
| `subscribers` | Newsletter subscribers |
| `blog_posts` | Blog content with categories |
| `blog_categories` | Blog category taxonomy |
| `bot_message_queue` | Async bot message processing queue |
| `ip_addresses` | Malicious IP intelligence |
| `crypto_wallets` | Scam-associated crypto wallets |
| `feed_timestamps` | Scraper last-run tracking |
| `feed_references` | Scraper source attribution |
| `phone_lookups` | Twilio phone intelligence results (risk score, CNAM, carrier) |

### Upstash Redis

- Analysis result cache (text-only submissions)
- Rate limiting buckets (sliding window)
- Feature flags

### Cloudflare R2

- Uploaded media (images/screenshots from submissions)
- Stored with structured key paths

## Inngest Background Functions

Five event-driven functions registered in `@askarthur/scam-engine/inngest/functions`:

| Function | Schedule | Purpose |
|----------|----------|---------|
| Staleness — URLs | Daily 3am UTC | Mark URLs inactive after 7 days |
| Staleness — IPs | Daily 3am UTC | Mark IPs inactive after 7 days |
| Staleness — Wallets | Daily 3am UTC | Mark wallets inactive after 14 days |
| Enrichment Fan-Out | Every 6 hours | WHOIS + SSL enrichment for pending URLs (20 domains/run) |
| CT Monitor | Every 12 hours | Certificate Transparency monitoring for AU brand impersonation |

## Threat Intelligence Pipeline

14 Python scrapers in `pipeline/scrapers/` ingest from external threat feeds:

| Scraper | Feed |
|---------|------|
| `crtsh.py` | Certificate Transparency logs (brand impersonation) |
| `cryptoscamdb.py` | Crypto scam database |
| `feodo.py` | Feodo botnet C2 tracker |
| `ipsum.py` | IPSUM proxy detection |
| `openphish.py` | OpenPhish phishing URLs |
| `phishing_army.py` | Phishing Army blocklist |
| `phishing_database.py` | Phishing Database feed |
| `phishstats.py` | PhishStats API |
| `phishtank.py` | PhishTank community DB |
| `threatfox.py` | ThreatFox malware/C2 IOCs |
| `urlhaus.py` | URLhaus malware hosting |

Scrapers run on GitHub Actions (scheduled, gated by `ENABLE_SCRAPER` repo variable). They use a shared `common/` library for URL normalization, database operations, and validation.

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
├── background.ts              # Service worker (message routing, context menus)
├── popup/App.tsx               # Popup UI (URL + text analysis)
├── gmail-scanner.content.ts    # Gmail email scanning
└── gmail-relay.content.ts      # Gmail message relay (InboxSDK)
```

- **Popup**: 380px fixed width, segmented tabs (URL / Text)
- **Gmail Integration**: InboxSDK-based email scanning with local cache
- **Auth**: `X-Extension-Secret` header + installation ID

## External Services

| Service | Purpose |
|---------|---------|
| Anthropic (Claude) | AI scam analysis (claude-haiku-4-5) |
| Supabase | PostgreSQL database + auth |
| Upstash | Redis cache + rate limiting |
| Vercel | Hosting + serverless functions |
| Cloudflare R2 | Media storage |
| Google Safe Browsing | URL reputation |
| Resend | Transactional email |
| Twilio | Phone number lookup |
| Inngest | Background job orchestration |
| Plausible | Privacy-first analytics |
| InboxSDK | Gmail extension integration |
| Reality Defender / Resemble AI | Deepfake detection (media analysis) |
