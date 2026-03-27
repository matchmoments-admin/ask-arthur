# Ask Arthur — B2B Intelligence Dashboard Implementation Brief

**Audience:** B2B bank/enterprise partners
**Design style:** gov.au trust aesthetic + Stripe/Retool data-density
**Date:** March 2026 · Last updated: 2026-03-27

---

## Implementation Status: ~95% Complete

### DONE — Dashboard Frontend
- [x] Sidebar layout (240px navy, 7 nav items) with mobile header
- [x] 4 KPI cards (checks 7d, high-risk, losses prevented, intelligence items)
- [x] Checks over time chart (recharts AreaChart with gradient fill)
- [x] Scam type breakdown (horizontal bars from feed_items)
- [x] Source split (4-quadrant grid)
- [x] Compliance checklist (6 items, SPF Act progress bar)
- [x] Live threat feed (severity dots, monospace, type badges)
- [x] Recent scans widget (scan_results + site_audits combined)
- [x] Reports page (government export placeholders — STIX, NASC, PDF, CSV)
- [x] SPF Compliance page (full checklist)
- [x] Settings page (webhook/notification placeholders)
- [x] Threat Feed full page (/app/threats)
- [x] recharts installed

### DONE — Data Layer
- [x] lib/dashboard.ts — 5 server-side data queries (KPIs, scam types, channels, threats, scans)
- [x] lib/dashboard/formatters.ts — formatAUD, formatRelative, RISK_COLOURS
- [x] /api/dashboard/threat-feed — polling endpoint for live entity feed

### DONE — Database
- [x] migration-v46: performance indexes (check_stats, scam_entities, feed_items, feed_ingestion_log)
- [x] get_dashboard_summary() RPC deployed — single round-trip for all top-level metrics
- [x] Additional indexes: scam_reports (created_at + verdict), api_usage_log (key + day)

### DONE — Security (all 5 of 6 items)
- [x] SSRF guard enhanced (decimal/hex/octal IP blocking)
- [x] Admin token nonce (timestamp:nonce:hmac format)
- [x] Image magic-byte validation (JPEG/PNG/GIF/WebP)
- [x] Cron auth in middleware (timing-safe CRON_SECRET)
- [x] Push token user binding (JWT extraction)

### TODO — Future Enhancements
- [ ] CSP nonce-based script-src (deferred — requires middleware + nonce propagation)
- [ ] TanStack Table entity browser with filters
- [ ] CSV export from threat feed
- [ ] PDF report generation (Server Action)
- [ ] Webhook configuration UI (functional, not just placeholder)
- [ ] API usage charts per key (requires api_usage_log data flowing)
- [ ] Sheet drawer for sidebar on mobile
- [ ] Suspense skeletons for all dashboard sections

---

## Data Flow Status

```
Reddit scraper → feed_items + scam_entities + scam_urls ✅ WORKING
User submissions → scam_reports → scam_entities ✅ WORKING
feed_items → dashboard source split + scam type breakdown ✅ CONNECTED
check_stats → KPI cards + checks chart ✅ CONNECTED
scam_entities → dashboard threat feed ✅ CONNECTED
feed_ingestion_log → pipeline health (component exists) ✅ CONNECTED
scan_results + site_audits → recent scans widget ✅ CONNECTED
get_dashboard_summary() RPC → single-query KPIs ✅ DEPLOYED
```

### Pipelines NOT YET Active in Production
These need feature flags enabled in Vercel env vars:
- `NEXT_PUBLIC_FF_DATA_PIPELINE=true` — Inngest enrichment/clustering
- `NEXT_PUBLIC_FF_ENTITY_ENRICHMENT=true` — WHOIS/SSL/phone enrichment
- `NEXT_PUBLIC_FF_RISK_SCORING=true` — composite risk scores
- `NEXT_PUBLIC_FF_CLUSTER_BUILDER=true` — campaign grouping

Once enabled, these tables will populate:
- `scam_entities.risk_score` / `risk_level` (currently null for most)
- `scam_clusters` (currently 0 rows)
- `scam_entities.enrichment_data` (WHOIS, SSL, etc.)
- `phone_reputation` (phone fraud scoring)

---

## Key Metrics (Live from Database)

From `get_dashboard_summary(30)`:
- Total checks: 26
- HIGH_RISK: 16
- Suspicious: 7
- Active entities: 22
- New entities (24h): 3
- Feed items: 385
- Active feeds: 1
- Top categories: phishing (47), phone_scam (22), rental_scam (21), impersonation (20)
