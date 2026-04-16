# Security Posture Overview

**Last updated:** April 2026

## Encryption
- **At rest:** AES-256 (Supabase/PostgreSQL default encryption)
- **In transit:** TLS 1.3 (Vercel + Cloudflare edge)
- **API keys:** SHA-256 hashed — plaintext never stored
- **Secrets:** Timing-safe comparisons for all secret checks (crypto.timingSafeEqual)

## Access Control
- **Database:** Row Level Security (RLS) enabled on all 36+ tables
- **API authentication:** Bearer token (hashed key lookup) with per-key rate limits
- **User authentication:** Supabase Auth (PKCE flow, server-side JWT validation)
- **Admin panel:** Dual-mode auth (Supabase Auth + HMAC-signed cookies, 24h TTL)
- **Organization RBAC:** 6 roles (owner, admin, compliance_officer, fraud_analyst, developer, viewer) with permission matrix
- **Extension auth:** X-Extension-Secret header with timing-safe comparison

## Rate Limiting
- **Global:** 60 requests/minute per IP (sliding window, Upstash Redis)
- **API keys:** Per-key daily and per-minute limits (tier-based)
- **Form submissions:** 5/hour per IP
- **Bot messages:** 5/hour per platform+user pair
- **Behaviour:** Fail-closed in production (503 on Redis outage), fail-open in development

## Input Validation
- **PII scrubbing:** 12-pattern regex pipeline (emails, cards, Medicare, TFN, SSN, phones, IPs, addresses, names)
- **Prompt injection:** 14 detection patterns (role reassignment, delimiter breakout, verdict forcing, etc.)
- **Unicode sanitization:** Zero-width character stripping + NFC normalization
- **XML escaping:** For all user content in AI prompts
- **Zod validation:** All external input validated with Zod 4 schemas

## Security Headers
- Content-Security-Policy (strict, no unsafe-eval)
- Strict-Transport-Security (2-year max-age with preload)
- X-Frame-Options: DENY
- X-Content-Type-Options: nosniff
- Referrer-Policy: strict-origin-when-cross-origin
- Permissions-Policy: camera=self, microphone=(), geolocation=(), payment=self
- Cross-Origin-Embedder-Policy: credentialless
- Cross-Origin-Opener-Policy: same-origin

## Incident Response
- **P1 response target:** 30 minutes
- **Breach notification:** Clients within 72 hours, OAIC within 30 days (per Notifiable Data Breaches scheme)
- **Contact:** security@askarthur.com.au

## Security Testing
- **Dependency scanning:** GitHub Dependabot (automated)
- **npm audit:** Runs in CI/CD pipeline
- **Penetration testing:** Planned Q3 2026

## Certifications (Current & Planned)
- ASD Essential Eight ML1: Self-assessment planned
- CSA STAR Level 1: Submission planned
- SOC 2 Type I: Target Q3 2026
- ISO 27001:2022: Target Q1 2027

## Sub-processors

| Provider | Purpose | Data processed | SOC 2 |
|----------|---------|----------------|-------|
| Supabase | Database, auth | All application data | Type II |
| Vercel | Application hosting | Request/response data | Type II |
| Cloudflare | CDN, R2 storage | Static assets, media | Type II |
| Anthropic | AI analysis | Scrubbed scam content (no PII) | Type II |
| Resend | Email delivery | Email addresses, content | Available |
| Upstash | Rate limiting, cache | Hashed identifiers, counters | Available |
| Stripe | Billing | Customer name, email, payment | Type II |

Contact: security@askarthur.com.au
