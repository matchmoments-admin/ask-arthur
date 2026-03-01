# Security

Threat model, mandatory defenses, and compliance status for Ask Arthur.

---

## Threat Model

### Assets to Protect

| Asset | Sensitivity | Location |
|-------|------------|----------|
| User-submitted scam content | Medium | Supabase (PII-scrubbed) |
| Subscriber emails | High | Supabase `subscribers` table |
| API keys (B2B) | Critical | Supabase `api_keys` (SHA-256 hashed) |
| Admin credentials | Critical | Environment variable (`ADMIN_SECRET`) |
| Extension secrets | High | Environment variable (`EXTENSION_SECRET`) |
| Claude API key | Critical | Environment variable |
| Redis credentials | High | Environment variables |

### Attack Vectors

| Vector | Risk | Mitigation |
|--------|------|------------|
| Prompt injection via user text | High | Unicode sanitization, nonce delimiters, sandwich defense, 14 regex patterns |
| Prompt injection via invisible Unicode | High | `sanitizeUnicode()` strips zero-width chars + NFC normalization |
| Email HTML/CSS injection (hidden content) | Medium | Client-side: hidden element removal before `innerText`; Server-side: `stripEmailHtml()` strips comments, style/script blocks, hidden elements, data attributes, HTML tags |
| API abuse / scraping | Medium | Two-tier rate limiting (burst + daily), fail-closed |
| Admin panel access | High | Cookie-based HMAC auth with 24h expiry, timing-safe comparison |
| Webhook forgery | High | HMAC-SHA256 signature verification per platform |
| IP spoofing for rate limit bypass | Medium | Uses `x-real-ip` (Vercel-provided, not user-spoofable) |
| XSS via analysis results | Medium | HTML entity escaping in bot formatters, React auto-escaping |
| Clickjacking | Low | `X-Frame-Options: DENY`, `frame-ancestors 'none'` |
| Man-in-the-middle | Low | HSTS (2 years, preload), `upgrade-insecure-requests` |
| PII leakage in stored scams | Medium | 12-pattern PII scrubbing pipeline before storage |

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

| Context | Burst | Daily | Identifier |
|---------|-------|-------|-----------|
| Web analysis | 3/hour | 10/day | SHA-256(IP + User-Agent) |
| Extension manual | 10/minute | 50/day | SHA-256(installation ID) |
| Extension email scan | 20/minute | 200/day | SHA-256(installation ID) |
| Bot platforms | 5/hour | — | Platform + user ID |
| B2B API | — | Per-key limit (default 100) | SHA-256(API key) |

**Fail-closed in production**: if Redis unavailable, returns 503 (blocks requests).
**Fail-open in development**: allows requests for local testing.

### 3. Authentication

| Surface | Method | Details |
|---------|--------|---------|
| Admin panel | Cookie HMAC | SHA-256 HMAC with timestamp nonce, 24h expiry, timing-safe compare |
| Extension API | Shared secret | `X-Extension-Secret` header, timing-safe comparison |
| B2B API | Bearer token | API key hashed with SHA-256, compared against `api_keys.key_hash` |
| Bot webhooks | Platform HMAC | Telegram secret token, WhatsApp SHA-256 signature, Slack v0 signature with replay protection (5-min window) |

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

| Order | Pattern | Replacement |
|-------|---------|-------------|
| 1 | Email addresses | `[EMAIL]` |
| 2 | Credit card numbers (16 digits) | `[CARD]` |
| 3 | Medicare numbers (AU) | `[MEDICARE]` |
| 4 | Tax File Numbers (AU) | `[TFN]` |
| 5 | Social Security Numbers | `[SSN]` |
| 6 | AU mobile numbers | `[AU_PHONE]` |
| 7 | AU landline numbers | `[AU_PHONE]` |
| 8 | Generic phone numbers | `[PHONE]` |
| 9 | IP addresses | `[IP]` |
| 10 | BSB numbers (AU) | `[BSB]` |
| 11 | Street addresses | `[ADDRESS]` |
| 12 | Names (after salutations) | `[NAME]` |

## P0 Security Fixes — Status

All priority-zero security issues have been resolved:

| ID | Issue | Status | Implementation |
|----|-------|--------|----------------|
| S1 | Admin auth was basic/no-auth | **DONE** | Cookie-based HMAC in `lib/adminAuth.ts` — SHA-256, 24h expiry, timing-safe |
| S2 | Unicode prompt injection | **DONE** | `sanitizeUnicode()` in `scam-engine/claude.ts` — strips 11 invisible char classes, NFC normalize |
| S3 | CSP had `unsafe-eval` | **DONE** | Removed from `next.config.ts` CSP — no `unsafe-eval` present |
| S4 | Rate limiter failed open in prod | **DONE** | Production fail-closed in `utils/rate-limit.ts` — returns 503 if Redis unavailable |
| S5 | IP spoofing via x-forwarded-for | **DONE** | Uses `x-real-ip` (Vercel-provided) as primary, `x-forwarded-for` first entry as fallback |

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

### Dependency Security

- `pnpm audit` for Node.js dependency vulnerabilities
- `pip audit` for Python pipeline dependencies
- Lockfiles committed (`pnpm-lock.yaml`, `requirements.txt`)
- Minimal dependency surface (prefer built-in Node crypto over external packages)

### Extension Security

- Minimal permissions: `activeTab`, `contextMenus`, `storage`
- Host permissions scoped to `askarthur.au/api/extension/*` and `mail.google.com/*`
- Installation ID generated on first run (not linked to user identity)
- Email scan results cached locally (not sent to server unless reported)

## Compliance Notes

- **Australian Privacy Act**: PII scrubbed before storage, no raw content retention
- **GDPR-adjacent**: Signed unsubscribe URLs (HMAC), one-click unsubscribe (RFC 8058)
- **Analytics**: Plausible (privacy-first, no cookies, no personal data)
- **HSTS Preload**: Submitted for browser preload lists
