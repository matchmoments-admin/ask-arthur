# Data Residency Statement

**Last updated:** 30 July 2026

> **Corrected 30 July 2026.** This statement previously read "All Ask Arthur
> platform data is processed and stored within Australia" and listed the
> database as `ap-southeast-2` (Sydney) with application hosting in `syd1`.
> Both were wrong. Verified against the live infrastructure: the Supabase
> project is `ap-southeast-1` (Singapore) — there is only one project and it has
> never been in Sydney — and Vercel server functions execute in `iad1`
> (Washington DC), with `syd1` serving only the CDN edge. The public trust pages
> and the privacy policy were corrected in the same change.

Ask Arthur data is stored in Singapore and processed in the United States.
Australian-region infrastructure is limited to the CDN edge and the R2 location
hint.

| Component                  | Provider         | Region                                  |
| -------------------------- | ---------------- | --------------------------------------- |
| Database (PostgreSQL)      | Supabase         | **ap-southeast-1 (Singapore)**          |
| Server functions (compute) | Vercel           | **iad1 (Washington DC, USA)**           |
| CDN / static edge          | Vercel           | syd1 (Sydney)                           |
| Object storage             | Cloudflare R2    | oc (Oceania — location hint)            |
| Email delivery             | Resend           | US (in-transit only, no storage)        |
| AI processing              | Anthropic Claude | US (query data, no storage)             |
| Cache / Rate limiting      | Upstash Redis    | ap-southeast-1 (Singapore)              |
| Billing                    | Stripe           | AU entity processing (Stripe Australia) |

**Note on Cloudflare R2:** R2 uses an Oceania location hint. Sensitive scam report content is stored in Supabase (Singapore), not R2. R2 stores non-sensitive media only (screenshots for analysis).

**Note on Anthropic Claude:** User-submitted content is sent to Claude for analysis. Verified 2026-07-30: the scam-analysis path passes `scrubPii: true` (`packages/scam-engine/src/claude.ts:403`), so submitted TEXT is redacted before transmission. IMAGES are sent unmodified — `scrubPII` is text-only and cannot redact an image. Anthropic does not store API request data beyond transient processing. No PII is sent — all content is scrubbed before analysis via our 12-pattern PII pipeline.

**Note on Upstash Redis:** Used for rate limiting and response caching only. No PII or scam report content is stored in Redis. Cache entries expire within 24 hours.

Contact: brendan@askarthur.au
