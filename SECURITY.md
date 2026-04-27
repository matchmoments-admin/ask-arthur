# Security

Threat model, mandatory defenses, and compliance status for Ask Arthur.

---

## Threat Model

### Assets to Protect

| Asset                         | Sensitivity | Location                                                                                                                    |
| ----------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| User-submitted scam content   | Medium      | Supabase (PII-scrubbed)                                                                                                     |
| Subscriber emails             | High        | Supabase `email_subscribers` table                                                                                          |
| API keys (B2B)                | Critical    | Supabase `api_keys` (SHA-256 hashed)                                                                                        |
| Admin credentials             | Critical    | Environment variable (`ADMIN_SECRET`)                                                                                       |
| Extension install public keys | Medium      | Supabase `extension_installs.public_key_jwk` (non-secret; the private half is non-extractable and never leaves the browser) |
| Turnstile secret              | High        | `TURNSTILE_SECRET_KEY` env var (server-side only; verifies registration tokens)                                             |
| Claude API key                | Critical    | Environment variable                                                                                                        |
| Redis credentials             | High        | Environment variables                                                                                                       |
| Threat intel export data      | High        | Supabase views (`threat_intel_*`), service-role only                                                                        |
| Provider report payloads      | High        | Supabase `provider_reports.payload` JSONB                                                                                   |
| Financial loss data           | Medium      | Supabase `scam_reports` (estimated_loss, loss_currency)                                                                     |
| Evidence files                | Medium      | Cloudflare R2 (`evidence_r2_key` on scam_entities)                                                                          |

### Attack Vectors

| Vector                                                                                           | Risk   | Mitigation                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prompt injection via user text                                                                   | High   | Unicode sanitization, nonce delimiters, sandwich defense, 14 regex patterns                                                                                                                                                                                                                                                      |
| Prompt injection via invisible Unicode                                                           | High   | `sanitizeUnicode()` strips zero-width chars + NFC normalization                                                                                                                                                                                                                                                                  |
| Email HTML/CSS injection (hidden content)                                                        | Medium | Client-side: hidden element removal before `innerText`; Server-side: `stripEmailHtml()` strips comments, style/script blocks, hidden elements, data attributes, HTML tags                                                                                                                                                        |
| API abuse / scraping                                                                             | Medium | Two-tier rate limiting (burst + daily), fail-closed                                                                                                                                                                                                                                                                              |
| Admin panel access                                                                               | High   | Cookie-based HMAC auth with 24h expiry, timing-safe comparison                                                                                                                                                                                                                                                                   |
| Webhook forgery                                                                                  | High   | HMAC-SHA256 signature verification per platform                                                                                                                                                                                                                                                                                  |
| IP spoofing for rate limit bypass                                                                | Medium | Uses `x-real-ip` (Vercel-provided, not user-spoofable)                                                                                                                                                                                                                                                                           |
| XSS via analysis results                                                                         | Medium | HTML entity escaping in bot formatters, React auto-escaping                                                                                                                                                                                                                                                                      |
| Clickjacking                                                                                     | Low    | `X-Frame-Options: DENY`, `frame-ancestors 'none'`                                                                                                                                                                                                                                                                                |
| Man-in-the-middle                                                                                | Low    | HSTS (2 years, preload), `upgrade-insecure-requests`                                                                                                                                                                                                                                                                             |
| PII leakage in stored scams                                                                      | Medium | 12-pattern PII scrubbing pipeline before storage                                                                                                                                                                                                                                                                                 |
| Threat intel data exfiltration                                                                   | Medium | Views use `security_invoker = true`; service-role access only; no public API exposure                                                                                                                                                                                                                                            |
| Provider report tampering                                                                        | Medium | RLS on `provider_reports`/`provider_actions` (service-role only); JSONB payloads validated by RPC                                                                                                                                                                                                                                |
| Financial data manipulation                                                                      | Low    | `record_financial_impact` RPC enforces non-negative loss, valid ISO 4217 currency; CHECK constraints on `estimated_loss >= 0`                                                                                                                                                                                                    |
| Image proxy SSRF                                                                                 | Medium | Domain allowlist (3 domains), `redirect: "manual"` with re-validation, content-type check, 5MB limit, 10s timeout                                                                                                                                                                                                                |
| Feed data exposure                                                                               | Low    | Only `published = TRUE` items visible via RLS; PII-scrubbed descriptions; no raw user content                                                                                                                                                                                                                                    |
| Active recon legal exposure (deep-investigation runs nmap/nikto/sslscan against 3rd-party hosts) | Medium | `vars.ENABLE_DEEP_INVESTIGATION` defaults unset (treated as false) — scheduled runs disabled by default. Per-entity `scam_entities.legal_basis` (v80) defaults to `public_interest_research_unverified`; elevate per-row only after written legal sign-off. Manual workflow_dispatch retained as incident-response safety valve. |

## Mandatory Defenses

### 1. Input Sanitization

**File:** `packages/scam-engine/src/claude.ts`

All user text is sanitized before Claude analysis:

1. **Unicode sanitization** — removes 11 classes of invisible characters (zero-width space, joiner, non-joiner, BOM, word joiner, invisible separators, language tags) then NFC-normalizes
2. **PII scrubbing** — replaces emails, credit cards, Medicare numbers, TFNs, SSNs, phone numbers, IP addresses, BSBs, addresses, names with placeholder tokens
3. **XML escaping** — prevents delimiter breakout
4. **Nonce-based delimiters** — user content wrapped in UUID-tagged XML elements (`<user_input_{nonce}>`)
5. **Sandwich defense** — analysis instructions placed before AND after user content
6. **Injection pattern detection** — 14 regex patterns flag manipulation attempts (e.g., "ignore previous instructions", "return SAFE", "system prompt", delimiter breakout)
7. **Email HTML sanitization** — `stripEmailHtml()` in `scam-engine/html-sanitize.ts` strips HTML comments, `<style>`/`<script>` blocks, elements with `display:none`/`visibility:hidden`, `data-*` attributes, and remaining HTML tags before analysis (defense-in-depth for extension email scanning)

### 2. Rate Limiting

**Two layers of defense:**

**Layer 1 — Global edge middleware** (`apps/web/middleware.ts`): 60 requests/min per IP via Upstash Redis sliding window. Only applied to API routes (`/api/*`) and mutating requests (POST, PUT, DELETE). Page navigation (GET to non-API paths) is exempt to prevent rate limit errors when browsing between pages.

**Layer 2 — Per-route analysis limits** (`packages/utils/src/rate-limit.ts`):

| Context              | Burst     | Daily                       | Identifier               |
| -------------------- | --------- | --------------------------- | ------------------------ |
| Web analysis         | 3/hour    | 10/day                      | SHA-256(IP + User-Agent) |
| Extension manual     | 10/minute | 50/day                      | SHA-256(installation ID) |
| Extension email scan | 20/minute | 200/day                     | SHA-256(installation ID) |
| Bot platforms        | 5/hour    | —                           | Platform + user ID       |
| B2B API              | —         | Per-key limit (default 100) | SHA-256(API key)         |

**Fail-closed in production**: if Redis unavailable, returns 503 (blocks requests).
**Fail-open in development**: allows requests for local testing.

### 3. Authentication

| Surface          | Method                            | Details                                                                                                                                                                                                                   |
| ---------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User auth        | Supabase Auth (PKCE)              | Email/password + magic link, JWT validation via `getUser()`, cookie-based sessions via `@supabase/ssr`, feature-flagged behind `NEXT_PUBLIC_FF_AUTH`                                                                      |
| Admin panel      | Dual-mode                         | Supabase Auth (admin role in `app_metadata`) with HMAC cookie fallback, dual-mode in `lib/adminAuth.ts`                                                                                                                   |
| Session refresh  | Edge middleware                   | `createMiddlewareClient()` refreshes expired tokens on every request                                                                                                                                                      |
| Route protection | Middleware                        | `/app/*` requires authenticated user, `/admin/*` requires admin role                                                                                                                                                      |
| Extension API    | Per-install ECDSA P-256 signature | `X-Extension-Install-Id`, `X-Extension-Timestamp`, `X-Extension-Nonce`, `X-Extension-Signature`; ±5 min skew window, Redis nonce-replay protection, public keys registered through a Cloudflare Turnstile-gated endpoint. |
| B2B API          | Bearer token                      | API key hashed with SHA-256, compared against `api_keys.key_hash`                                                                                                                                                         |
| Bot webhooks     | Platform HMAC                     | Telegram secret token, WhatsApp SHA-256 signature, Slack v0 signature with replay protection (5-min window)                                                                                                               |

**Auth security notes:**

- Uses `supabase.auth.getUser()` (server-side JWT validation) not `getSession()` (client-side, spoofable)
- RLS policies enforce user-scoped data access (api_keys, subscriptions, api_usage_log)
- Max 5 active API keys per user (enforced in `generate_api_key_record` RPC)
- Subscription ownership verified in Paddle webhook (prevents subscription theft via customData manipulation)
- User profile role column is immutable via RLS WITH CHECK constraint

### 4. Security Headers

**File:** `apps/web/next.config.ts`

```
Content-Security-Policy:
  default-src 'self'
  script-src 'self' 'unsafe-inline' https://plausible.io https://cdn.jsdelivr.net https://cdn.paddle.com
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net
  font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net
  img-src 'self' data: blob: https://*.r2.cloudflarestorage.com
  connect-src 'self' https://*.supabase.co wss://*.supabase.co https://plausible.io https://cdn.jsdelivr.net https://*.paddle.com
  frame-src https://*.paddle.com
  frame-ancestors 'none'
  form-action 'self'
  base-uri 'self'
  object-src 'none'
  worker-src 'self' blob:
  upgrade-insecure-requests

Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=(self)
```

### 5. PII Scrubbing Pipeline

**File:** `packages/scam-engine/src/pipeline.ts`

Before storing any verified scam, the following PII patterns are scrubbed (order matters for specificity):

| Order | Pattern                         | Replacement  |
| ----- | ------------------------------- | ------------ |
| 1     | Email addresses                 | `[EMAIL]`    |
| 2     | Credit card numbers (16 digits) | `[CARD]`     |
| 3     | Medicare numbers (AU)           | `[MEDICARE]` |
| 4     | Tax File Numbers (AU)           | `[TFN]`      |
| 5     | Social Security Numbers         | `[SSN]`      |
| 6     | AU mobile numbers               | `[AU_PHONE]` |
| 7     | AU landline numbers             | `[AU_PHONE]` |
| 8     | Generic phone numbers           | `[PHONE]`    |
| 9     | IP addresses                    | `[IP]`       |
| 10    | BSB numbers (AU)                | `[BSB]`      |
| 11    | Street addresses                | `[ADDRESS]`  |
| 12    | Names (after salutations)       | `[NAME]`     |

## P0 Security Fixes — Status

All priority-zero security issues have been resolved:

| ID  | Issue                            | Status   | Implementation                                                                                   |
| --- | -------------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| S1  | Admin auth was basic/no-auth     | **DONE** | Cookie-based HMAC in `lib/adminAuth.ts` — SHA-256, 24h expiry, timing-safe                       |
| S2  | Unicode prompt injection         | **DONE** | `sanitizeUnicode()` in `scam-engine/claude.ts` — strips 11 invisible char classes, NFC normalize |
| S3  | CSP had `unsafe-eval`            | **DONE** | Removed from `next.config.ts` CSP — no `unsafe-eval` present                                     |
| S4  | Rate limiter failed open in prod | **DONE** | Production fail-closed in `utils/rate-limit.ts` — returns 503 if Redis unavailable               |
| S5  | IP spoofing via x-forwarded-for  | **DONE** | Uses `x-real-ip` (Vercel-provided) as primary, `x-forwarded-for` first entry as fallback         |

## Secure Development Practices

### API Boundaries

- All external input validated with Zod schemas before processing
- Payload size limits enforced (10MB max)
- API keys never stored in plaintext (SHA-256 hashed)
- Timing-safe comparisons for all secret comparisons
- Rate limit headers included in responses

### Data Handling

- No raw user content stored — only PII-scrubbed summaries for HIGH_RISK verdicts
- Redis cache keys based on content hash (not raw text)
- Supabase RLS (Row Level Security) for multi-tenant isolation
- `createServiceClient()` returns null when credentials missing (graceful degradation)

### Government Reporting Data

- **Threat intel views** (`threat_intel_entities`, `threat_intel_urls`, `threat_intel_daily_summary`, `threat_intel_scam_campaigns`) all use `security_invoker = true` — queries run with the caller's permissions, not the view creator's
- **Provider reports** (`provider_reports`, `provider_actions`) have RLS enabled with service-role-only policies. No public/anon access
- **Financial impact data** validated by `record_financial_impact` RPC: non-negative `estimated_loss`, ISO 4217 `loss_currency`, CHECK constraints at the database level
- **Evidence storage** via `evidence_r2_key` on `scam_entities` — R2 bucket is private, accessed only through service-role authenticated server-side code

### Dependency Security

- `pnpm audit` for Node.js dependency vulnerabilities
- `pip audit` for Python pipeline dependencies
- Lockfiles committed (`pnpm-lock.yaml`, `requirements.txt`)
- Minimal dependency surface (prefer built-in Node crypto over external packages)

### Public Feed Security

- **Image proxy** (`/api/feed/proxy-image`) — strict domain allowlist (`preview.redd.it`, `i.redd.it`, `i.imgur.com`), manual redirect handling with re-validation, content-type must start with `image/`, 5MB max, 10s timeout
- **Feed API** (`/api/feed`) — public read-only, RLS enforces `published = TRUE`, NaN-safe pagination defaults, feature-flagged (`NEXT_PUBLIC_FF_SCAM_FEED`)
- **`upsert_feed_item` RPC** — `SECURITY DEFINER` with `SET search_path = public`, service-role only
- **Feed descriptions** — all content PII-scrubbed at source (Reddit usernames stripped, user reports use `scrubbed_content`, verified scams use AI-generated summaries)

### Extension Security

- Minimal permissions: `activeTab`, `contextMenus`, `storage`, `offscreen` (offscreen is used exclusively to host the one-time Turnstile iframe during registration)
- Host permissions scoped to `askarthur.au/api/extension/*` (plus `<all_urls>` only when URL Guard is enabled)
- Per-install ECDSA P-256 keypair generated with `extractable: false` — the private key is stored in IndexedDB and never leaves the browser, even the extension's own code cannot export it (`crypto.subtle.exportKey` throws)
- Request signatures verified against `extension_installs.public_key_jwk`. Public keys are registered through `/api/extension/register`, which is Turnstile-gated and IP rate-limited (5/hr) to raise the cost of identity farming
- Replay protection: every signed request carries a nonce; the server SETNX-locks each nonce in Upstash Redis with a 10-minute TTL, aligned with the ±5 minute timestamp skew window
- Installation ID remains a random UUID stored in `chrome.storage.local` (not linked to user identity), which preserves the `extension_subscriptions` mapping for Pro users across the auth migration
- Email scan results cached locally (not sent to server unless reported)
- Known non-mitigation: no Chrome platform primitive cryptographically binds a request to a CWS-installed extension (WEI was abandoned 2023; Verified Access is ChromeOS-only). The real defense against API abuse remains server-side rate limiting keyed to the per-install identity; the signature scheme exists to make that identity revocable and to remove the extractable-secret finding from static analysis of the bundle.

## Compliance Notes

- **Australian Privacy Act**: PII scrubbed before storage; no raw content retention for SAFE/SUSPICIOUS verdicts
  - APL right-to-access: `GET /api/user/export-data` returns a JSON bundle of everything linked to the caller's auth uid
  - APL right-to-erasure: `POST /api/user/delete-account` (body `{"confirm":"DELETE"}`) removes the auth.users row, cascading to `user_profiles` and owned `family_groups`; submitted scam intelligence is kept for community safety but is not linked to the user
  - Retention: `scam_reports` rows aged beyond 90 days (SAFE/SUSPICIOUS) or 180 days (HIGH_RISK) are moved to `scam_reports_archive` by the `/api/cron/scam-reports-retention` daily cron — no hard delete, union available via the `scam_reports_all` view
  - `bot_message_queue` terminal rows (completed/failed) have their `message_text` / `images` / `reply_to` cleared at status transition; the full row is hard-deleted after 24h by `/api/cron/bot-queue-cleanup`
- **GDPR-adjacent**: Signed unsubscribe URLs (HMAC), one-click unsubscribe (RFC 8058)
- **Analytics**: Plausible (privacy-first, no cookies, no personal data)
- **HSTS Preload**: Submitted for browser preload lists

## Observability

- `/admin/costs` — per-feature cost rollups, 7-day WoW delta, Telegram daily threshold alert + weekly digest
- `/admin/health` — queue depth, oldest pending age, archive counts, Stripe idempotency log, feed-staleness warnings
- `logCost()` wired on: Claude (input+output tokens), Whisper (seconds), Twilio Lookup v2, Hive AI (units; unit-cost pending contract), Reality Defender, Resemble AI, Resend (welcome/digest/admin-notification)
- Stripe webhook is idempotent via `stripe_event_log` (insert-with-conflict gate on `event.id`); duplicates return 200 without re-running handlers
- Admin-only RPCs (`fraud_manager_search`, entity enrichment trigger fn) are REVOKEd from public/anon/authenticated and GRANTed only to `service_role`
