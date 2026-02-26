# Roadmap

Phased build plan for Ask Arthur with current status tracking. See `BACKLOG.md` for deferred feature ideas by platform.

---

## Phase 1 — Core Platform ✅

The foundation: web app, analysis engine, and data layer.

| Feature | Status |
|---------|--------|
| Next.js web app with scam analysis form | ✅ Done |
| Claude AI analysis engine (text + images) | ✅ Done |
| Three-tier verdict system (SAFE / SUSPICIOUS / HIGH_RISK) | ✅ Done |
| Supabase database (PostgreSQL) | ✅ Done |
| Rate limiting (two-tier, Upstash Redis) | ✅ Done |
| Prompt injection defense (sanitization, nonce delimiters, 14 patterns) | ✅ Done |
| PII scrubbing pipeline (12 patterns) | ✅ Done |
| URL extraction and Safe Browsing API | ✅ Done |
| Analysis result caching (Redis) | ✅ Done |
| IP geolocation for regional stats | ✅ Done |
| Scam URL lookup and reporting endpoints | ✅ Done |
| Contact (phone/email) lookup and reporting | ✅ Done |
| Newsletter subscription (Resend) | ✅ Done |
| Privacy-first analytics (Plausible) | ✅ Done |
| Vercel deployment with security headers | ✅ Done |

## Phase 2 — Multi-Platform Expansion ✅

Bringing scam detection to users where they are.

### Chrome Extension ✅

| Feature | Status |
|---------|--------|
| Phase 1: URL checking + text analysis popup | ✅ Done |
| Phase 2: Gmail email scanning (InboxSDK) | ✅ Done |
| WXT framework (Chrome + Firefox support) | ✅ Done |
| Extension API with dedicated auth + rate limits | ✅ Done |
| Email result caching (local Chrome storage) | ✅ Done |
| Segmented tabs, rounded corners, animations | ✅ Done |

### Mobile App ✅

| Feature | Status |
|---------|--------|
| Expo SDK 54 + React Native app | ✅ Done |
| Tab navigation (Home, Scan, Breach, Apps, Settings) | ✅ Done |
| QR code scanning (expo-camera) | ✅ Done |
| Data breach checking | ✅ Done |
| Share intent handling (text, URLs, images) | ✅ Done |

### Chat Bots ✅

| Feature | Status |
|---------|--------|
| Telegram bot with webhook | ✅ Done |
| WhatsApp bot with webhook | ✅ Done |
| Slack bot with slash commands | ✅ Done |
| Facebook Messenger bot with webhook | ✅ Done |
| Shared bot-core package (formatters, webhook verify, queue) | ✅ Done |
| Platform-specific formatting (HTML, markdown, Block Kit, plain text) | ✅ Done |
| Bot message queue (async processing) | ✅ Done |
| Per-user rate limiting (5/hour sliding window) | ✅ Done |

## Phase 3 — Threat Intelligence ✅

Building a comprehensive threat database.

### Data Pipeline ✅

| Feature | Status |
|---------|--------|
| Python scraper framework with shared utilities | ✅ Done |
| 14 threat feed integrations (see ARCHITECTURE.md) | ✅ Done |
| URL normalization (Python + TypeScript parity) | ✅ Done |
| GitHub Actions scheduled scraping | ✅ Done |
| Feed timestamp tracking | ✅ Done |
| IP address and crypto wallet intelligence | ✅ Done |

### Inngest Background Processing ✅

| Feature | Status |
|---------|--------|
| URL staleness checks (7-day inactive) | ✅ Done |
| IP staleness checks (7-day inactive) | ✅ Done |
| Crypto wallet staleness checks (14-day inactive) | ✅ Done |
| WHOIS + SSL enrichment fan-out (every 6 hours) | ✅ Done |
| Certificate Transparency monitoring (AU brands, every 12 hours) | ✅ Done |

### B2B Threat API ✅

| Feature | Status |
|---------|--------|
| Bearer token authentication (SHA-256 hashed keys) | ✅ Done |
| Threat trending endpoint (by period/region) | ✅ Done |
| URL lookup with full enrichment data | ✅ Done |
| Trending URLs (most-reported domains) | ✅ Done |
| Domain aggregation with WHOIS data | ✅ Done |
| Aggregate statistics endpoint | ✅ Done |
| OpenAPI 3.0 spec with Scalar docs | ✅ Done |
| Per-key daily rate limits | ✅ Done |

## Phase 4 — Content & Security Hardening ✅

| Feature | Status |
|---------|--------|
| Blog system with categories and pagination | ✅ Done |
| Automated weekly blog generation (cron) | ✅ Done |
| Weekly email digest (Resend) | ✅ Done |
| BreadcrumbList JSON-LD (SEO) | ✅ Done |
| Cookie-based admin auth (S1) | ✅ Done |
| Unicode sanitization (S2) | ✅ Done |
| CSP hardening — no unsafe-eval (S3) | ✅ Done |
| Fail-closed rate limiter in production (S4) | ✅ Done |
| x-real-ip for rate limiting (S5) | ✅ Done |
| Signed unsubscribe URLs (HMAC) | ✅ Done |
| Server-side redirect chain resolution | ✅ Done |

## Phase 5 — Media & Advanced Analysis

| Feature | Status |
|---------|--------|
| Media upload to Cloudflare R2 | ✅ Done |
| Media analysis endpoints (upload, analyze, status) | ✅ Done |
| Deepfake detection integration (Reality Defender / Resemble AI) | 🔄 In progress |
| Multi-image analysis (up to 10 images per request) | ✅ Done |
| Breach check API endpoint | ✅ Done |

## Phase 6 — Scale & Growth

Future priorities. Items here may move to `BACKLOG.md` if deprioritized.

| Feature | Status |
|---------|--------|
| Public threat intelligence feeds (real-time) | Planned |
| Brand monitoring (impersonation detection) | Planned |
| Carrier feeds integration (Telstra/Optus) | Planned |
| White-label embed widget | Planned |
| Webhook notifications for new threats | Planned |
| Community scam reports feed | Planned |
| SOC/SIEM integration | Planned |

---

## Status Key

| Icon | Meaning |
|------|---------|
| ✅ | Complete and deployed |
| 🔄 | In progress |
| Planned | Accepted but not started |

For deferred platform-specific features, see `BACKLOG.md`.
