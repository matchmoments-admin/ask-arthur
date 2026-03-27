# Ask Arthur — Security Assessment

**Stack:** Next.js 16 · Supabase · Upstash Redis · Vercel · Cloudflare R2 · React Native (Expo 54) · Claude AI · Paddle · Inngest
**Overall grade:** A- (well-hardened, with 6 targeted improvements below)
**Date:** March 2026

---

## Priority Summary

| # | Issue | Severity | Effort | Status |
|---|-------|----------|--------|--------|
| 1 | SSRF guard on URL checker | HIGH | ~2h | TODO |
| 2 | Admin token nonce/revocation | HIGH | ~2h | TODO |
| 3 | CSP nonce-based script-src | MEDIUM | ~3h | TODO |
| 4 | Image magic-byte validation | MEDIUM | ~1h | TODO |
| 5 | Cron auth in middleware | MEDIUM | ~30min | TODO |
| 6 | Push token user binding | LOW | ~1h | TODO |

---

## 1. SSRF in URL Checker (HIGH)

The core `/api/analyze` URL reputation checker passes user-supplied URLs to Google Safe Browsing and Twilio without blocking cloud metadata endpoints, private IP ranges, or alternative IP notations.

**Risk:** Attacker submits `http://169.254.169.254/latest/meta-data/` (AWS metadata), `http://[::1]/admin`, or DNS rebinding URL. Credentials leak if internal fetch occurs.

**Fix:** Create `packages/scam-engine/src/ssrf-guard.ts` with:
- Blocked IP ranges: 127.x, 10.x, 192.168.x, 172.16-31.x, 169.254.x (AWS/GCP metadata), 100.64.x (CGNAT), ::1, fc00:, fe80:
- Blocked hosts: localhost, metadata.google.internal, metadata.goog
- DNS resolution check before any outbound fetch
- Call `assertSafeURL()` before Safe Browsing, Twilio, or redirect resolution

## 2. Admin HMAC Token No Nonce (HIGH)

`createAdminToken()` uses timestamp + HMAC but no nonce. Intercepted token valid for 24h.

**Fix:** Add nonce to token, store revoked nonces in Redis:
- Token format: `timestamp:nonce:hmac`
- `verifyAdminToken()` checks nonce not revoked
- `revokeAdminToken()` on logout stores nonce in Redis with TTL

## 3. unsafe-inline in CSP script-src (MEDIUM)

CSP has `'unsafe-inline'` in script-src allowing inline scripts — most common XSS vector.

**Fix:** Migrate to nonce-based CSP:
- Generate nonce in middleware: `crypto.randomBytes(16).toString('base64url')`
- CSP: `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`
- Keep `'unsafe-inline'` only in style-src (Tailwind needs it)

## 4. Base64 Image No Magic-Byte Validation (MEDIUM)

`/api/analyze` accepts up to 10 base64 images without validating actual file magic bytes.

**Fix:** Create `packages/scam-engine/src/image-validate.ts`:
- Check JPEG (FF D8 FF), PNG (89 50 4E 47), GIF (47 49 46 38), WebP (RIFF) magic bytes
- Validate before passing to Claude vision API
- Reject mismatched content-type vs actual bytes

## 5. Cron Routes Skip Auth in Middleware (MEDIUM)

Middleware skips `/api/cron/*` for rate limiting. CRON_SECRET check is only in route handlers — a forgotten handler is fully public.

**Fix:** Add cron auth check in middleware itself:
- Check `x-cron-secret` or `Authorization: Bearer` header
- Timing-safe comparison against `CRON_SECRET`
- Return 401 if missing/invalid
- Then skip rate limiting (intentional)

## 6. Push Token No Device Binding (LOW)

Push tokens registered with no authentication. On rooted devices, attacker could register victim's token.

**Fix:** Bind to authenticated session when available:
- Include `Authorization: Bearer` header if user signed in
- Server validates JWT and stores `user_id` with push token
- Allow anonymous registration with stricter rate limiting

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
