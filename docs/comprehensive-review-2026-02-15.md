# Ask Arthur — Comprehensive Review Report

**Date:** 15 February 2026
**Scope:** Security, Copy, Product-Market Fit, Business/Monetisation, Technical Roadmap + Domain Setup

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Security Audit](#1-security-audit)
3. [Copy & Messaging Audit](#2-copy--messaging-audit)
4. [Product-Market Fit Audit](#3-product-market-fit-audit)
5. [Business & Monetisation Audit](#4-business--monetisation-audit)
6. [RICE-Scored Roadmap](#5-rice-scored-roadmap)
7. [Domain Setup Guide](#6-domain-setup-guide-au-domains)

---

## Executive Summary

Ask Arthur is a well-architected scam detection platform with security practices that exceed pre-seed norms. The codebase is clean, typed, and production-ready at small scale. Five specialist reviews identified **20 security findings** (1 critical, 5 high), **~40 copy improvement opportunities**, strong PMF signals with clear risks, and validated unit economics at scale.

### Top 5 Actions (This Week)

| # | Action | Category | Effort |
|---|--------|----------|--------|
| 1 | Replace `[YOUR_ABN]` placeholder in Footer + emails | Legal/Trust | 10 min |
| 2 | Scope `unsafe-eval` CSP to `/api-docs` only | Security | 3 hrs |
| 3 | Fix HTTP geolocate call to HTTPS | Security | 15 min |
| 4 | Install Sentry error tracking | Infrastructure | 4 hrs |
| 5 | Apply to Cyber Security Business Connect grant | Business | 1 day |

---

## 1. Security Audit

**Overall Grade: B+** — Strong foundations with specific gaps to close.

### Severity Summary

| Severity | Count | Key Findings |
|----------|-------|-------------|
| CRITICAL | 1 | Admin panel uses URL parameter auth (`?secret=X`) — leaked in browser history, Referer headers, and admin notification emails |
| HIGH | 5 | Global `unsafe-eval` in CSP; admin secret embedded in emails; HTTP geolocation (plaintext IPs); unauthenticated unsubscribe endpoint; Safe Browsing API key in URL |
| MEDIUM | 8 | Fail-open rate limiter; IP spoofing via headers; `unsafe-inline` scripts; stored XSS risk in email digest; wildcard CORS on OpenAPI; prompt injection regex bypass via Unicode; no Sentry; unsanitised blog content |
| LOW | 6 | ABN placeholder; User-Agent in rate limit hash; service role key usage; PII regex false positives; missing env docs; greedy JSON regex |

### Critical Finding: Admin Panel Authentication

**File:** `app/admin/blog/page.tsx`
**Issue:** Admin access controlled by `?secret=X` URL parameter — visible in browser history, server logs, Referer headers, and sent via email in `api/cron/weekly-blog/route.ts`.
**Fix:** Replace with Supabase Auth (email OTP) or NextAuth. Remove secret from notification emails.

### High Priority Fixes

1. **CSP `unsafe-eval` is global** (`next.config.ts:28`) — Should be scoped only to `/api-docs` route
2. **Admin secret in emails** (`api/cron/weekly-blog/route.ts:51-63`) — Never embed secrets in email
3. **HTTP geolocate** (`lib/geolocate.ts:21`) — User IPs sent in plaintext. Use Vercel's built-in geo headers instead
4. **Unsubscribe lacks auth** (`api/unsubscribe-one-click/route.ts`) — No HMAC token, anyone can mass-unsubscribe emails
5. **Safe Browsing key in URL** (`lib/safebrowsing.ts:27`) — API key visible in server logs

### Positive Security Observations

- 4-layer prompt injection defense (regex + XML escaping + nonce delimiters + sandwich + verdict floor)
- 13-pattern PII scrubbing pipeline for Australian identifiers
- SHA-256 API key hashing, never stored in plaintext
- Fail-closed rate limiting in production
- Zod validation on all API endpoints
- HSTS with preload, X-Frame-Options DENY, secure headers

---

## 2. Copy & Messaging Audit

**Overall Grade: B+** — Strong foundation, meaningful conversion gains available.

### Key Findings

1. **Homepage H1 is a question, not a statement** — Questions slow processing for anxious users. Change to: *"Check any message for scams — free, instant, and private."*

2. **American English inconsistencies** — "Analyzed" appears in 3 locations instead of "Analysed" (homepage, about page, privacy section). "Analyzing..." loading state should be "Analysing..."

3. **Feature headings are abstract** — "Authority" and "Efficiency" are corporate. Replace with "Trusted Analysis" and "Results in Seconds"

4. **Confidence percentage confuses target users** — "72% confidence" is meaningless to an 80-year-old. Replace with qualitative labels: "High confidence" / "Moderate confidence"

5. **Welcome email references unbuilt product** — Email mentions "Scam Shield for Families" but user signed up for weekly alerts. Messaging disconnect

6. **"API" in primary navigation** — Developer-facing link in nav alongside Blog/About conflicts with elderly user positioning. Move to footer

7. **Missing emotional reassurance** — Error messages are generic/cold. "Something went wrong" needs empathy for anxious users who just pasted a scam

8. **No share mechanism after verdicts** — Elderly users want to show results to family. Add "Share with family" button

### Quick Copy Wins

| Current | Recommended | File |
|---------|-------------|------|
| "Analyzing..." | "Analysing..." | `ScamChecker.tsx` |
| "Check Now" | "Check This Message" | `ScamChecker.tsx` |
| "This Appears Safe" | "This Looks Safe" | `ResultCard.tsx` |
| "Independent Cybersecurity Advisory Tool" | "Independent Scam Detection Tool" | `Footer.tsx` |
| "AI analyzes it" | "Arthur analyses it" | `about/page.tsx` |
| Nav: `Blog \| API \| About` | `How It Works \| Blog \| About` | `Nav.tsx` |

---

## 3. Product-Market Fit Audit

### Differentiation Matrix

Arthur occupies a unique intersection: **(1) real-time AI analysis of full message content**, **(2) deep Australian scam pattern recognition**, and **(3) community-sourced data flywheel feeding a B2B API**. No single competitor occupies all three.

**Biggest existential risk:** Apple/Google shipping native scam detection in Messages/Gmail (2-3 year horizon). Mitigation: accelerate B2B revenue so the consumer tool becomes a data acquisition channel, not the business.

### Customer Personas

1. **"Concerned Carol"** (55-75, retired) — Primary consumer. Uses 2-3x/week. High word-of-mouth. WTP: $0 for checker, $5-10/mo for family protection
2. **"Protective Paul"** (30-45, tech-savvy) — Secondary consumer, actual purchaser for families. Finds Arthur via Google, shares with parents. WTP: $10-20/mo
3. **"Compliance Cathy"** (35-50, bank fraud analyst) — B2B buyer. Needs early warning on scam trends. WTP: $5K-$15K/mo. Blocked by: no SOC2, no SLA
4. **"Fintech Freddie"** (28-40, Head of Risk at neobank) — B2B buyer. Wants brand impersonation alerting. WTP: $2K-$5K/mo. Faster procurement than banks

### Moat Assessment

| Asset | Defensibility | Notes |
|-------|-------------|-------|
| Australian scam corpus | Medium-High | Grows daily; 12-24 months to replicate |
| Zero-knowledge privacy | Medium | Hard to retrofit, differentiates vs US competitors |
| B2B API integrations | Medium-High | Switching costs once integrated |
| SEO content flywheel | Medium | Blog posts from real threat data compound |
| AU-specific prompts | Low | Trivially copiable |
| Brand trust | Low (currently) | Must compound over time |

### Growth Hypotheses

1. SEO-driven organic acquisition via auto-generated blog posts (target: 1K+ monthly sessions by Month 3)
2. Family sharing as viral loop (target: K-factor >0.3)
3. Brand impersonation alerting sells the API (target: 3/5 trials convert)
4. Government grants fund runway to PMF (target: $50K+ non-dilutive in 6 months)
5. "Scam Shield for Families" validates consumer WTP (target: 500+ waitlist, 40% WTP $10+/mo)

---

## 4. Business & Monetisation Audit

### Unit Economics (Validated from Codebase)

| Component | Cost/Check | Notes |
|-----------|-----------|-------|
| Claude Haiku 4.5 (in+out) | ~$0.0006 | With prompt caching (~90% hit rate at scale) |
| Google Safe Browsing + VirusTotal | ~$0.0001 | Free tiers |
| Upstash Redis | ~$0.0001 | 2 Redis calls per check |
| Supabase + R2 (HIGH_RISK only) | ~$0.00007 | ~30-40% of checks |
| **Total marginal cost** | **~$0.0008** | **Confirmed sub-$0.001** |

### Fully-Loaded Cost at Scale

| Checks/month | Total infra/mo | Cost/check |
|-------------|---------------|------------|
| 3,000 (current) | $71 | $0.024 |
| 30,000 | $138 | $0.0046 |
| 300,000 | $434 | $0.0014 |
| 1,000,000 | ~$900 | $0.0009 |

### B2B Pricing Assessment

- **Pro at $2K/mo:** Strategically correct for market entry but may be too cheap. Consider $3K/mo floor
- **Enterprise at $5K-$15K/mo:** Reasonable for mid-tier ADIs, underpriced for Big 4. Upper bound should be $25K-$30K/mo
- **Missing tier:** "Strategic" at $25K-$50K/mo for Big 4 banks with co-branded alerts and custom dashboards
- **Critical gap:** No billing/Stripe integration. Acceptable at 0-2 customers, must build before #3
- **API too thin:** 2 endpoints insufficient for $2K+/mo. Need 5-8 for Pro, 10-15 for Enterprise

### 12-Month Projection (at $750K funding)

| Metric | Month 6 | Month 12 |
|--------|---------|----------|
| Consumer MAU | 7,000 | 20,000 |
| B2B Customers | 1 | 4 |
| MRR | $3,000 | $16,000 |
| ARR | $36,000 | $192,000 |
| Cash Remaining | ~$705K | ~$624K |

**Path to $100K ARR:** 3 paying customers at ~$4K/mo blended ACV. Achievable Month 8-10.

### Grant Priority (Ranked)

| Rank | Grant | Amount | Apply When |
|------|-------|--------|-----------|
| 1 | **Cyber Security Business Connect & Protect** | $10K-$50K | **This week** |
| 2 | **R&D Tax Incentive (43.5% refund)** | Variable | Register with AusIndustry now |
| 3 | AustCyber Projects Fund | $50K-$250K | Month 2 |
| 4 | CSCRC Partnership | Project-dependent | Month 4-6 |
| 5 | Sovereign Tech Fund | $25K-$100K | Month 6-12 |

**Critical missing item:** The R&D Tax Incentive (43.5% refundable offset) was omitted from the grant strategy doc. At $200K eligible R&D spend, this returns $87K cash.

### Fundraising Readiness

**Gaps to close before raising:**
1. No traction data in the pitch (add current MAU, checks, verified scams)
2. No B2B customer validation (need 2-3 LOIs)
3. Team section is vague (need names, credentials, advisors)
4. No financial model attached
5. API product too thin (2 endpoints ≠ sellable product)

**Recommended ask:** $750K on $3-4M post-money valuation. Gives 19 months runway.

---

## 5. RICE-Scored Roadmap

### Top 10 Items by RICE Score

| Rank | Item | RICE | Category | Effort |
|------|------|------|----------|--------|
| 1 | Replace `[YOUR_ABN]` placeholder | **200.0** | Legal | 10 min |
| 2 | Scope `unsafe-eval` to `/api-docs` only | **60.0** | Security | 0.5 pw |
| 3 | Fix HTTP geolocate call | **50.0** | Security | 0.2 pw |
| 4 | DKIM/SPF/DMARC verification | **42.7** | Security | 0.3 pw |
| 5 | Email capture after analysis | **42.7** | Growth | 0.3 pw |
| 6 | Plausible custom events | **42.7** | Growth | 0.3 pw |
| 7 | Add Sentry error tracking | **40.0** | Infra | 0.5 pw |
| 8 | Structured data (JSON-LD) | **32.0** | Growth | 0.5 pw |
| 9 | Open Graph image | **26.7** | Growth | 0.3 pw |
| 10 | Set up `.au` domains | **25.6** | Trust | 0.5 pw |

### Sprint Plan

**Weeks 1-2:** Critical fixes — ABN, CSP, geolocate, Sentry, DKIM, admin auth, Plausible events, health endpoint
**Weeks 3-4:** Growth enablers — JSON-LD, OG image, email capture in ResultCard, blog sitemap, `.au` domain, mobile nav
**Weeks 5-8:** Features — Scam trends dashboard, WhatsApp forwarding, browser extension, multi-language, community reporting
**Weeks 9-12:** Scale prep — Result caching, API self-service, usage dashboard, performance optimisation, load testing

### Quick Wins (<1 Hour)

1. Replace `[YOUR_ABN]` (10 min) — `Footer.tsx:49`, `lib/resend.ts:65`
2. Fix HTTP geolocate (15 min) — `lib/geolocate.ts:21`
3. Add email capture to ResultCard (30 min) — Import `SubscribeForm` into `ResultCard.tsx`
4. Add Plausible custom events (30 min) — `ScamChecker.tsx`, `SubscribeForm.tsx`, `WaitlistForm.tsx`
5. Add blog posts to main sitemap (15 min) — `app/sitemap.ts`
6. Add AI disclaimer to ResultCard (10 min)

---

## 6. Domain Setup Guide (.au Domains)

### Code Change (Already Applied)

The redirect from `.au` domains to `askarthur.au` has been added to `next.config.ts`:

```typescript
async redirects() {
  return [
    {
      source: "/:path*",
      has: [{ type: "host", value: "(www\\.)?askarthur\\.(au|com\\.au)" }],
      destination: "https://askarthur.au/:path*",
      permanent: true,
    },
  ];
}
```

Build verified: passes successfully.

### Manual Steps Required

**Step 1: Purchase Domains on GoDaddy**
- Go to godaddy.com/domains
- Purchase `askarthur.au` and `askarthur.com.au`
- Cost: ~$20-30 AUD/year per domain

**Step 2: Configure DNS Records**

For both domains, delete default parking records, then add:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | @ | 76.76.21.21 | 600 |
| CNAME | www | cname.vercel-dns.com | 600 |

**Step 3: Add Domains in Vercel**
1. Project Settings > Domains
2. Add: `askarthur.au`, `www.askarthur.au`, `askarthur.com.au`, `www.askarthur.com.au`
3. SSL auto-provisions (24-48h)

**Step 4: Verify**
```bash
dig askarthur.au        # Should show A record → 76.76.21.21
dig www.askarthur.au    # Should show CNAME → cname.vercel-dns.com
curl -I https://askarthur.au  # Should 308 redirect to askarthur.au
```

**Step 5: Update External Services**
- Google Search Console: Add `.au` domains as properties
- Plausible Analytics: Add `.au` domain tracking
- Update social/marketing materials

**Timeline:** ~2-3 hours active work + 24-48h DNS/SSL propagation.

---

*Full agent reports available in `/private/tmp/claude-501/-Users-brendanmilton-Desktop-safeverify/tasks/` for reference.*
