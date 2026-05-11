# News Intel feeds — ops

AU regulator narrative scrapers (Scamwatch HTML, ACSC RSS, ASIC JSON) shipped 2026-05-06 (PR #137 + fixes #138/#139, migration v97).

## Where the code lives

- Scrapers: `pipeline/scrapers/{scamwatch,acsc,asic_investor}_alerts.py`
- Write target: `feed_items` with `source IN ('scamwatch_alert','acsc','asic_investor')`
- Voyage embedding: `feed-items-embed` Inngest cron (`*/30 * * * *`)
- Weekly digest: `regulatorAlerts` section in `WeeklyIntelDigest.tsx`

## Retention (migration v98)

- Narrative `feed_items` >365d → `feed_items_archive`
- `feed_ingestion_log` pruned 90d
- `feed_http_cache` pruned 30d

All housekeeping runs nightly at 02:30 UTC via `feed-retention` Inngest function.

## Known issue — cyber.gov.au RSS timeouts

`cyber.gov.au` RSS occasionally times out from GitHub Actions IPs (suspected UA filtering by Cloudflare WAF). `common/http_cache.py` falls back to a Mozilla UA on retry; persistent failures are logged cleanly to `feed_ingestion_log` so the 3h cron self-heals on next reachable window.
