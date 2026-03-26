# Ask Arthur — B2B Intelligence Dashboard Build Plan

**Created:** 2026-03-27
**Status:** Ready to implement
**Priority:** P0 — blocks enterprise sales

---

## Context

Ask Arthur has a mature database infrastructure for B2B threat intelligence (21+ tables, 5 government export views, 4 RPCs, Inngest pipelines, Paddle billing) but the logged-in dashboard is a bare shell. The data exists — it just needs a frontend. This plan turns the existing backend into a sellable B2B product.

### Current Data Volumes
| Table | Rows | Dashboard Use |
|-------|------|---------------|
| `feed_items` | 344 | Scam type breakdown, channel split |
| `reddit_processed_posts` | 318 | Threat source intelligence |
| `check_stats` | 17 | KPI cards (checks, verdicts, regions) |
| `scam_entities` | 19 | Live threat feed |
| `verified_scams` | 19 | Verified intelligence |
| `scam_reports` | 15 | User report analytics |
| `site_audits` | 17 | Website scan history |
| `scam_urls` | 12 | URL intelligence |
| `scan_results` | 0 | Scanner results (new) |

### Empty Tables (infra exists, pipelines OFF)
- `api_keys` (0), `api_usage_log` (0), `subscriptions` (0), `user_profiles` (0)
- `scam_ips` (0), `phone_reputation` (0), `scam_clusters` (0)

### Government Export Views (built, ready)
- `threat_intel_entities`, `threat_intel_urls`, `threat_intel_daily_summary`, `threat_intel_scam_campaigns`
- RPCs: `get_threat_intel_export`, `get_unreported_entities`, `get_jurisdiction_summary`, `record_financial_impact`

---

## Week 1 — Dashboard MVP

### 1A. Dashboard Overview Page (`/app/page.tsx`)

**Layout:** Cream background (`#EFF4F8`), max-w-7xl, 6px padding

**Row 1: 4 KPI Cards** (grid-cols-2 lg:grid-cols-4)
| Card | Label | Source | Format |
|------|-------|--------|--------|
| Checks (7d) | Total checks | `check_stats` SUM(total_checks) WHERE date >= 7d ago | `12,847` + delta vs prev 7d |
| HIGH_RISK (7d) | High risk detected | `check_stats` SUM(high_risk_count) | `342` + delta |
| Est. Losses Prevented | Based on avg $540/scam | high_risk_count × $540 | `$2.1M` |
| API Usage | Calls today/limit | `api_usage_log` or placeholder | `7,240 / 10,000` progress bar |

Design rules:
- Large monospace numbers (`font-mono text-2xl tabular-nums`)
- Small uppercase labels (`text-xs uppercase tracking-wider text-arthur-slate`)
- Delta: green up arrow when good, red when bad
- Border: `border border-arthur-slate/15 rounded-lg bg-white`

**Row 2: Scam Type Breakdown + Channel Split** (lg:grid-cols-5, 3/2 split)

Left (col-span-3): Horizontal bar chart from `feed_items` grouped by `category`
- Each bar: label, percentage bar (`bg-arthur-navy`), count
- Sort descending by count

Right (col-span-2): 4-quadrant grid from `feed_items` grouped by `channel`
- SMS, Email, Phone, Other
- Each cell: icon, label, percentage (large mono), count (small)
- Use `divide-x divide-y` pattern

**Row 3: Live Threat Feed + Compliance** (lg:grid-cols-5, 3/2 split)

Left (col-span-3): Entity feed from `scam_entities` ORDER BY last_seen DESC
- Severity dot (red/orange/slate based on `risk_level`)
- Entity type badge (`URL`, `PHONE`, `EMAIL` in mono uppercase)
- Value in monospace, truncated
- Scam type label
- Relative timestamp
- Hover: "View →" button
- "Live" indicator with pulsing red dot

Right (col-span-2): Compliance checklist (hardcoded initially)
- Progress bar at top (X/Y complete)
- Checklist items: title, description, status icon (check/clock/circle), category badge
- Items: Scamwatch taxonomy alignment, Monthly report, NASC pipeline, AFCX export, APRA CPS 230

**Row 4: API Usage Chart** (full width)
- Area chart with gradient fill
- Time range segmented control (7d/30d/90d)
- Quota reference line (dashed gold)
- Below chart: Today / Monthly / Avg per day stats

### 1B. Dashboard API Routes

Create server-side data fetching functions (not new API routes — use Supabase service client in server components):

```typescript
// lib/dashboard.ts
async function getDashboardKPIs(days: number)
async function getScamTypeBreakdown(days: number)
async function getChannelSplit(days: number)
async function getRecentThreats(limit: number)
async function getAPIUsage(days: number)
```

### 1C. Dashboard Nav Update

Update `DashboardNav.tsx` tabs:
- **Overview** (existing, replace content)
- **Threat Feed** (new — full entity browser)
- **API Keys** (existing)
- **Reports** (new — export/compliance)
- **Billing** (existing)

---

## Week 2 — Data Pipeline Activation

### 2A. Feature Flags to Enable
```bash
# Production env vars to set in Vercel
NEXT_PUBLIC_FF_DATA_PIPELINE=true
NEXT_PUBLIC_FF_SCAM_FEED=true
NEXT_PUBLIC_FF_AUTH=true
NEXT_PUBLIC_FF_BILLING=true
NEXT_PUBLIC_FF_ENTITY_ENRICHMENT=true
NEXT_PUBLIC_FF_RISK_SCORING=true
NEXT_PUBLIC_FF_CLUSTER_BUILDER=true
NEXT_PUBLIC_FF_SITE_AUDIT=true
```

### 2B. Inngest Pipeline Verification
- Verify Inngest is connected in production (check Vercel env vars)
- Run manual enrichment fan-out to populate entity data
- Verify risk scorer produces 0-100 scores
- Verify cluster builder groups related reports

### 2C. Data Quality
- Backfill `scam_entities` from `feed_items` (extract phones, emails, URLs)
- Ensure `check_stats` is incrementing on every analysis
- Verify `api_usage_log` populates when API keys are used

---

## Week 3 — B2B & Government Features

### 3A. Government Export Page (`/app/reports/page.tsx`)
- Export buttons: CSV, JSON, STIX 2.1
- Date range picker
- Entity type filter
- Risk level filter
- Preview table of export data
- Powered by `get_threat_intel_export` RPC

### 3B. Webhook Configuration (`/app/webhooks/page.tsx`)
- Configure webhook URL for high-risk entity alerts
- Test webhook button
- Delivery log (last 10 deliveries with status)
- Filter by entity type, risk level, scam type

### 3C. Billing Activation
- Ensure Paddle env vars are set in production
- Test subscription flow: free → pro → enterprise
- Verify tier syncing works (api_keys limits update)
- Add usage-based billing alerts (approaching quota)

### 3D. Security Whitepaper
- 10-page PDF covering: architecture, data handling, privacy, Australian sovereignty
- Required for bank vendor risk assessment
- Host at `/security-whitepaper` or as downloadable PDF

---

## Design System for Dashboard

### Colors
```
arthur-navy:    #001F3F  — text, chart strokes, primary
arthur-slate:   #6B8EA4  — secondary text, borders, muted
arthur-cream:   #EFF4F8  — page background
arthur-gold:    #E8B64A  — accents, warnings, CTAs
arthur-risk:    #DC6843  — high-risk severity
arthur-safe:    #5B9279  — safe/complete states
```

### Typography Rules
- KPI numbers: `font-mono text-2xl font-semibold tabular-nums`
- Labels: `text-xs font-medium uppercase tracking-wider text-arthur-slate`
- Entity values: `font-mono text-sm text-arthur-navy`
- Timestamps: `font-mono text-[10px] tabular-nums text-arthur-slate`

### Component Rules
- Cards: `rounded-lg border border-arthur-slate/15 bg-white px-5 py-4`
- Dense lists: `divide-y divide-arthur-slate/8` (NOT card boxing)
- Severity dots: `h-2 w-2 rounded-full` (red/orange/slate)
- Left border severity: `border-l-[3px] border-arthur-risk pl-4`
- Progressive disclosure: categories collapsed by default, click to expand

### Layout
- Page: `min-h-screen bg-arthur-cream`
- Container: `mx-auto max-w-7xl px-6 py-6`
- Grid: `grid gap-6 lg:grid-cols-5` with 3/2 splits
- KPI row: `grid grid-cols-2 gap-4 lg:grid-cols-4`

---

## Files to Create/Modify

### Create
| File | Purpose |
|------|---------|
| `apps/web/lib/dashboard.ts` | Server-side dashboard data queries |
| `apps/web/components/dashboard/KPICards.tsx` | 4 metric cards |
| `apps/web/components/dashboard/ScamTypeBreakdown.tsx` | Horizontal bar chart |
| `apps/web/components/dashboard/ChannelSplit.tsx` | 4-quadrant delivery grid |
| `apps/web/components/dashboard/ThreatFeed.tsx` | Live entity feed |
| `apps/web/components/dashboard/ComplianceChecklist.tsx` | SPF compliance status |
| `apps/web/components/dashboard/APIUsageChart.tsx` | Usage area chart |

### Modify
| File | Change |
|------|--------|
| `apps/web/app/app/page.tsx` | Replace with dashboard overview |
| `apps/web/components/DashboardNav.tsx` | Add Threat Feed + Reports tabs |

### Reuse
| Existing | For |
|----------|-----|
| `packages/utils/src/feature-flags.ts` | Gate dashboard features |
| `@askarthur/supabase/server` | Service client for queries |
| Existing `check_stats`, `scam_entities`, `feed_items` tables | Data sources |

---

## Verification

1. `pnpm turbo build` passes
2. Visit `/app/` → see 4 KPI cards with real data
3. Scam type breakdown shows category distribution from feed_items
4. Threat feed shows recent entities with severity dots
5. Compliance checklist renders with correct status indicators
6. Dashboard loads in <2 seconds (server-rendered)

---

## Success Metrics

- **Week 1:** Dashboard overview page live with real data
- **Week 2:** Entity enrichment pipeline running, risk scores populating
- **Week 3:** Government export functional, webhook delivery working
- **Goal:** Demoable to a bank fraud team within 3 weeks
