# Brand Alerts as a Growth Engine — Scalable Strategy

## Context

Brand impersonation alerts should drive two things: **community trust** (public social posts showing Ask Arthur actively protects Australians) and **revenue** (converting brands into paying customers). Individual alerts per scam will flood feeds. Instead, aggregate into digestible summaries and use them strategically.

---

## The Two-Track Strategy

### Track 1: Public Social Posts (community + authority)

**Don't post every detection. Post weekly/monthly brand intelligence summaries.**

Instead of "@Google we found a scam" 50 times a month, post:

> 🚨 This week's Scam Intelligence Report from Ask Arthur:
>
> 📊 247 scam reports analysed
> 🏦 Top impersonated brands: @CommBank (34), @Google (28), @Telstra (22)
> 📱 SMS is the #1 delivery method (61%)
> 🔍 3 new scam campaigns detected
>
> Protect yourself: askarthur.au
> Full report: askarthur.au/scam-feed
>
> #ScamAlert #Australia #CyberSecurity

This is **far more shareable** than individual alerts. It positions Ask Arthur as the authority, not a notification bot.

**Schedule:** One social post per week (Monday morning AU time). Admin approves draft in `/admin/brand-alerts`.

**For major incidents only** (confidence >95%, new campaign affecting >10 reports in 24h): post an urgent individual alert with admin approval.

### Track 2: Brand Outreach (B2B revenue)

**Don't cold-email every brand. Build a "Brand Intelligence Report" that brands pay for.**

Flow:
1. Alerts accumulate silently in DB (already built)
2. Monthly: admin generates a "Brand Intelligence Report" for a specific brand
3. Report shows: number of scams impersonating them, delivery methods, scammer contacts, trend over time
4. Admin sends this report to the brand's security team as a free sample
5. CTA: "Want automated real-time alerts? Subscribe to Ask Arthur Brand Protection — $X/month"

**The key insight:** The free sample report is the sales tool. Not the individual alert.

---

## Admin Dashboard Redesign (`/admin/brand-alerts`)

### View 1: Summary Dashboard (default)

```
┌─────────────────────────────────────────────────┐
│  Brand Alert Summary              [This Week ▾]  │
├─────────────────────────────────────────────────┤
│                                                   │
│  Total alerts: 47    New campaigns: 3             │
│  Top brand: CommBank (12)                         │
│  Top method: SMS (61%)                            │
│                                                   │
│  [Generate Weekly Social Post]                    │
│  [Generate Brand Report for...]                   │
│                                                   │
├─────────────────────────────────────────────────┤
│  Brand         │ Alerts │ Method │ Trend          │
│  CommBank      │ 12     │ SMS    │ ↑ +5 vs last   │
│  Google        │ 8      │ SMS    │ → same          │
│  Telstra       │ 7      │ Email  │ ↓ -3 vs last   │
│  ATO           │ 6      │ SMS    │ ↑ new           │
│  ANZ           │ 4      │ Phone  │ → same          │
│  ...                                              │
└─────────────────────────────────────────────────┘
```

### View 2: Individual Alerts (drill-down)

Click a brand → see all individual alerts for that brand. Same as current table but filtered.

### View 3: Generate Social Post

"Generate Weekly Post" button:
1. Queries alerts from the selected period
2. Auto-generates a summary post (short for Twitter, long for LinkedIn/Facebook)
3. Admin reviews/edits → publishes

### View 4: Generate Brand Report

"Generate Report for [Brand]" button:
1. Queries all alerts for that brand (all time or date range)
2. Generates a structured PDF/page with:
   - Total scams impersonating this brand
   - Delivery method breakdown
   - Scammer contact details (phones, URLs)
   - Trend over time
   - "Powered by Ask Arthur — askarthur.au/brand-protection"
3. Creates a shareable URL: `/report/brand/[brand-slug]`
4. Admin can share this URL with the brand's security team

---

## Monetisation Path

### Free Tier (what we give away)
- Weekly public social posts (builds community trust)
- One-off brand report as a free sample (sales tool)
- Public scam feed at `/scam-feed`

### Brand Protection Plan ($500-$2,000/mo)
- Real-time alerts when their brand is impersonated
- Monthly intelligence PDF for their security team
- Scammer contact details (phones, URLs, emails)
- Delivery method breakdown + trend analysis
- Dedicated API endpoint: `GET /api/v1/brand-alerts?brand=CommBank`
- This is the Paddle subscription product

### Enterprise Threat Intelligence ($5,000-$15,000/mo)
- Everything in Brand Protection
- Full entity API access (phones, URLs, IPs, wallets)
- STIX 2.1 export for SIEM integration
- Custom webhook delivery
- Already exists as the Enterprise tier in `api_keys`

---

## Implementation — What to Build

### Phase 1: Weekly Summary Post (replaces individual alerts)

**Change `brand-alerts.ts`:** Still create individual alert rows (for data), but DON'T auto-generate drafts per alert. Remove `draft_post_short`/`draft_post_long` from auto-generation.

**New: Summary generation function** in `social-post.ts`:
- `generateWeeklySummary(alerts[])` → produces the aggregated post
- Called from admin dashboard, not automatically

**Update admin page:**
- Default view = summary dashboard with aggregated stats
- "Generate Weekly Post" button → creates summary draft → admin approves → publish
- Remove auto-drafting per individual alert

### Phase 2: Brand Report Pages

**New page:** `/report/brand/[slug]/page.tsx`
- Public shareable page showing brand-specific intelligence
- Aggregated stats, trend chart, delivery breakdown
- CTA: "Want real-time alerts? Contact us"
- This is the sales landing page

**Admin action:** "Generate Report" → creates/updates the report page for a brand

### Phase 3: Brand Protection Subscription

**Wire into Paddle:**
- New price ID: `PADDLE_BRAND_PROTECTION_PRICE_ID`
- New tier in `api_keys`: `brand_protection`
- New API endpoint: `GET /api/v1/brand-alerts?brand=X` (authenticated)
- Webhook delivery: when new alert for subscribed brand → push to their configured webhook

---

## Files to Modify

| File | Change |
|------|--------|
| `packages/scam-engine/src/brand-alerts.ts` | Remove auto-draft generation (keep alert creation) |
| `packages/scam-engine/src/social-post.ts` | Add `generateWeeklySummary()` function |
| `apps/web/app/admin/brand-alerts/page.tsx` | Replace list view with summary dashboard |
| `apps/web/app/admin/brand-alerts/BrandAlertsList.tsx` | Rewrite as summary view + drill-down |

## Files to Create

| File | Purpose |
|------|---------|
| `apps/web/app/report/brand/[slug]/page.tsx` | Public brand intelligence report page |
| `apps/web/lib/brand-report.ts` | Generate brand-specific report data |

## No New Database Changes

The existing `brand_impersonation_alerts` table + `known_brands` table are sufficient. The summary is computed at query time, not stored separately.

---

## Posting Schedule

| Type | Frequency | Auto/Manual | Purpose |
|------|-----------|-------------|---------|
| Weekly summary | Every Monday | Admin approves draft | Community trust + authority |
| Urgent alert | As needed (rare) | Admin approves | Major new campaign only |
| Brand report | On demand | Admin generates | B2B sales tool |

---

## Verification

1. Admin dashboard shows aggregated brand alert stats
2. "Generate Weekly Post" creates a summary with top brands + stats
3. Admin approves → posts to social platforms
4. `/report/brand/commbank` shows a public intelligence page
5. Individual alerts still stored in DB for drill-down
