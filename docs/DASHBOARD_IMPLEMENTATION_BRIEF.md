# Ask Arthur — B2B Intelligence Dashboard Implementation Brief

**Audience:** B2B bank/enterprise partners
**Design style:** gov.au trust aesthetic + Stripe/Retool data-density
**Date:** March 2026

---

## Current Implementation Status (~90% of Week 1 MVP)

### DONE
- Sidebar layout (240px navy, 7 nav items)
- 4 KPI cards (checks, high-risk, losses, intelligence items)
- Checks over time chart (recharts AreaChart with gradient fill)
- Scam type breakdown (horizontal bars from feed_items)
- Source split (4-quadrant grid)
- Compliance checklist (6 items, progress bar)
- Live threat feed (severity dots, monospace, type badges)
- Recent scans widget
- Reports page (export placeholders)
- SPF Compliance page
- Settings page (webhook placeholders)
- Threat Feed full page (/app/threats)
- recharts installed
- DB indexes (migration v46)
- Mobile header bar

### TODO (Remaining Brief Requirements)

**Week 2-3:**
- [ ] lib/dashboard/queries.ts — separate query layer using createAuthServerClient
- [ ] lib/dashboard/formatters.ts — formatAUD, formatRelative, RISK_COLOURS
- [ ] MetricCard.tsx with updatedAt timestamps (data freshness signal)
- [ ] ThreatFeedPanel.tsx with 30s polling via client-side setInterval
- [ ] PipelineHealthPanel.tsx querying feed_ingestion_log
- [ ] API route: /api/dashboard/threat-feed for client polling
- [ ] get_dashboard_summary RPC (single Supabase round-trip for all KPIs)

**Week 3-4:**
- [ ] TanStack Table entity browser (@tanstack/react-table)
- [ ] Filter bar (entity type, risk level, date range)
- [ ] CSV export (streams Supabase query to blob download)
- [ ] "Generate PDF report" Server Action

**Week 5:**
- [ ] Webhook configuration UI
- [ ] API usage charts per key
- [ ] Sheet drawer for sidebar on mobile
- [ ] Suspense skeletons for all sections

---

## Key Technical Decisions

1. NO Supabase Realtime — use 30s polling via setInterval
2. DO use Suspense streaming for all async sections
3. DO call get_dashboard_summary() RPC when deployed
4. Auth at layout level only (requireAuth in layout.tsx)
5. max-w-[1200px] inside main content (not sidebar)
6. Use existing CSS tokens — no new colour definitions
7. Aggregate data server-side where possible
8. requireAuth redirect compatible with sidebar layout

---

## Data Flow Gaps (from audit)

These data connections need to be established:
```
scam_entities → B2B dashboard threat feed ✅ CONNECTED
feed_items → B2B dashboard source split ✅ CONNECTED
check_stats → KPI cards + checks chart ✅ CONNECTED
feed_ingestion_log → pipeline health panel ⚠️ PARTIALLY (component exists, no data flowing)
financial_impact_summary → dashboard ❌ NOT CONNECTED (view exists, empty)
threat_intel_daily_summary → daily chart ❌ NOT CONNECTED
api_usage_log → API usage panel ❌ NOT CONNECTED (empty table)
provider_reports → SPF compliance panel ❌ NOT CONNECTED (empty table)
```

---

## Missing Features Blocking Enterprise Sales

| Feature | Impact | Priority |
|---------|--------|----------|
| Paddle billing UI activation | Cannot close deals | P0 |
| Webhook delivery dashboard | Banks need push alerts | P0 |
| Monthly PDF report generator | APRA compliance requirement | P1 |
| Sector benchmark data | #1 sales question | P1 |
| BSB/account entity type | Banks track payment destinations | P1 |
| Pipeline health dashboard (live) | Trust data freshness | P2 |

---

## Security Improvements (from Security Assessment)

See docs/SECURITY_ASSESSMENT.md for full details. Top 2 priorities:
1. SSRF guard on URL checker (HIGH, ~2h)
2. Admin token nonce/revocation (HIGH, ~2h)
