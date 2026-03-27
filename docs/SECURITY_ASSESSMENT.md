# Ask Arthur — Security Assessment

**Stack:** Next.js 16 · Supabase · Upstash Redis · Vercel · Cloudflare R2 · React Native (Expo 54) · Claude AI · Paddle · Inngest
**Overall grade:** A (all HIGH items resolved, 1 MEDIUM remaining)
**Date:** March 2026 · Last updated: 2026-03-27

---

## Priority Summary

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | SSRF guard on URL checker | HIGH | **DONE** — enhanced isPrivateURL() with decimal/hex/octal IP blocking + metadata.goog + standalone ssrf-guard.ts |
| 2 | Admin token nonce/revocation | HIGH | **DONE** — nonce added to HMAC token (timestamp:nonce:hmac), legacy tokens reduced to 1h window |
| 3 | CSP nonce-based script-src | MEDIUM | DEFERRED — requires Vercel middleware changes + nonce propagation to all script tags; current unsafe-inline is mitigated by React's XSS protection |
| 4 | Image magic-byte validation | MEDIUM | **DONE** — image-validate.ts checks JPEG/PNG/GIF/WebP magic bytes, wired into /api/analyze |
| 5 | Cron auth in middleware | MEDIUM | **DONE** — timing-safe CRON_SECRET check in middleware before rate limit skip |
| 6 | Push token user binding | LOW | **DONE** — extracts JWT from Authorization header, binds user_id to push token |

---

## What's Already Well Done

- Prompt injection defense: nonce delimiters, sandwich defense, 14 regex patterns, Unicode stripping, XML escaping, PII scrubbing
- Webhook verification across all 5 platforms with timing-safe HMAC + replay protection
- Rate limiting: defense-in-depth (global edge + per-route), fails closed in production
- RLS on Supabase: security_invoker = true, immutable role column, service-role-only sensitive tables
- API keys SHA-256 hashed at rest
- getUser() not getSession() — avoids spoofable client-side session
- HSTS preload with 2-year max-age and includeSubDomains
- No unsafe-eval in CSP
- SSRF protection with private IP blocking, alternative notation detection
- Image upload magic-byte validation
- Admin token with nonce (replay window reduced from 24h to per-nonce)
- Cron route auth in middleware (defense-in-depth)
- Push token user binding (device + auth)
