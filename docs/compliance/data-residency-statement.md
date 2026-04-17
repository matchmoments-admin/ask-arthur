# Data Residency Statement

**Last updated:** April 2026

All Ask Arthur platform data is processed and stored within Australia.

| Component | Provider | Region |
|-----------|----------|--------|
| Database (PostgreSQL) | Supabase | ap-southeast-2 (Sydney) |
| Application hosting | Vercel | syd1 (Sydney) |
| Object storage | Cloudflare R2 | oc (Oceania — location hint) |
| Email delivery | Resend | US (in-transit only, no storage) |
| AI processing | Anthropic Claude | US (query data, no storage) |
| Cache / Rate limiting | Upstash Redis | ap-southeast-1 (Singapore) |
| Billing | Stripe | AU entity processing (Stripe Australia) |

**Note on Cloudflare R2:** R2 uses an Oceania location hint. Sensitive scam report content is stored in Supabase (Sydney), not R2. R2 stores non-sensitive media only (screenshots for analysis).

**Note on Anthropic Claude:** User-submitted content is sent to Claude for analysis. Anthropic does not store API request data beyond transient processing. No PII is sent — all content is scrubbed before analysis via our 12-pattern PII pipeline.

**Note on Upstash Redis:** Used for rate limiting and response caching only. No PII or scam report content is stored in Redis. Cache entries expire within 24 hours.

Contact: brendan@askarthur.au
