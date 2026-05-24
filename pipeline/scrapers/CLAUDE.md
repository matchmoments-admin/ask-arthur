# pipeline/scrapers — local guide

Scoped guidance for Python threat-feed scrapers. Read this in addition to the [root CLAUDE.md](../../CLAUDE.md).

## What runs here

20+ active scrapers writing to `feed_items` / `scam_*` / `acnc_charities` / `vulnerabilities` tables. Two GitHub Actions workflows drive them:

- `.github/workflows/scrape-feeds.yml` — 4-tier cron (3h / 6h / 12h / daily 16:00 UTC)
- `.github/workflows/scrape-vulnerabilities.yml` — weekly Sunday 04:00 UTC

See [`docs/system-map/background-workers.md`](../../docs/system-map/background-workers.md) for the full scraper → schedule mapping. Most scrapers are AU-focused (Scamwatch, ACSC, ASIC, AUSTRAC, ACNC, PFRA); a few are global (URLhaus, OpenPhish, AbuseIPDB, CT logs).

## Hard rules — born from the 2026-05-09 incident

**Never write `SET statement_timeout = 0` (or `SET LOCAL statement_timeout = 0`).** A single 20-hour ACNC UPDATE took the whole site down. Cap timeouts at a real value — `'300s'` is the established convention.

**Chunk every long-running write loop.** Every UPDATE / DELETE / UPSERT against a hot table (`acnc_charities`, `scam_reports`, `verified_scams`, `feedback_triage_queue`, `feed_items`, `scam_entities`) must use:

```python
# Reference: pipeline/scrapers/acnc_register.py TOUCH_LAST_SEEN_SQL
for chunk in chunks(pks, size=5000):
    try:
        with conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout = '300s'")
            cur.execute(SQL, (chunk,))
        conn.commit()
    except Exception as e:
        conn.rollback()
        log.error(...)  # one chunk failing doesn't poison the run
```

Log per-chunk progress with row counts so investigators can see the loop is making progress.

## Adding a new scraper

1. **Verify the upstream URL works** before merging — `curl -sSI <url>` from the dev machine + a GitHub Actions runner. AUSTRAC originally 404'd in PR #247; check.
2. **Stagger daily 16:00 UTC scrapers by 5-10 min** to avoid hammering the DB or burning a single watchdog window.
3. **Category-inference rule** — specific before generic. A regulator-narrative scraper's `category` map should match exact phrases first, fall back to generic keywords last.
4. **Cost budget** — if the scraper hits a paid API (e.g. AbuseIPDB), add an entry to `feature_brakes` and tag spend via `logCost()` in any web-side enrichment that uses the data.

## Scoped commands

```bash
# From repo root:
cd pipeline/scrapers && python -m pytest tests/ -v       # all tests
cd pipeline/scrapers && python -m pytest tests/test_<x>.py -v  # one file

# Lint / format (uses ruff via pre-commit if configured):
ruff check pipeline/scrapers/
```

The 2026-05-09 incident's reference fix lives in `pipeline/scrapers/acnc_register.py` (PR #187) — that's the canonical shape for any new chunked retryable loop.

## Where things live

| Looking for                        | Where                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Scraper → cron schedule mapping    | [`docs/system-map/background-workers.md`](../../docs/system-map/background-workers.md)                             |
| Hot-table list + chunking rule     | Root [CLAUDE.md](../../CLAUDE.md) "Critical Rules"                                                                 |
| Feed sources + retention policy    | `migration-v98-feed-retention.sql` + `migration-v127-feed-sources.sql`                                             |
| ACNC dataset access (CKAN gotchas) | Memory: [`reference_acnc_ckan_dataset.md`](../../.claude/projects/-Users-brendanmilton-Desktop-safeverify/memory/) |
