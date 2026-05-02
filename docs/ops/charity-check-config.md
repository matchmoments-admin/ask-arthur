# Charity Legitimacy Check — Operational Config Checklist

**Purpose.** Single source of truth for every env var, feature flag, GitHub
Actions variable, third-party account, UI integration point, and
compliance artefact that Charity Check depends on. If the UI needs a new
toggle, a flag needs flipping, or a vendor key needs provisioning — it
goes here.

Referenced from [CLAUDE.md](../../CLAUDE.md) Quick Reference. Keep updated
each sprint.

**Status legend**

| Marker | Meaning                                                         |
| ------ | --------------------------------------------------------------- |
| ✅     | Live / configured / shipped                                     |
| ⏳     | In progress this sprint                                         |
| ❌     | Not started                                                     |
| 🔒     | Blocked — waiting on external dep (DPA, vendor approval, legal) |

---

## 1. Feature flags

All Charity Check flags default **OFF** in production. They gate orthogonal
subsystems so they can be rolled out independently.

| Flag (env var)                 | Default | Gates                                                                                                                  | Flip when                                                                                               |
| ------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_FF_CHARITY_CHECK` | `false` | The consumer surface — `/charity-check` page (404 when off), `POST /api/charity-check` and autocomplete (503 when off) | Smoke-tested on Vercel preview with at least one SAFE + one HIGH_RISK end-to-end; verdict copy reviewed |
| `FF_CHARITY_CHECK_INGEST`      | `false` | The ACNC scraper (`pipeline/scrapers/acnc_register.py`) — when off, the scraper logs a no-op and exits                 | Already flipped in CI workflow env; needed only to override locally                                     |

The GitHub Actions workflow ALSO gates the scraper step on a separate repo
variable `vars.ENABLE_CHARITY_CHECK_INGEST` (defence-in-depth). Both must
be true for the scraper to actually run on a scheduled or dispatched job.

**Rollout order (recommended):**

1. Set repo var `ENABLE_CHARITY_CHECK_INGEST=true` (already done — 2026-05-02)
2. Trigger the scraper once via `gh workflow run scrape-feeds.yml -f feed=acnc_register` to populate `acnc_charities`
3. Verify ~64k rows landed via `SELECT count(*) FROM acnc_charities`
4. Flip `NEXT_PUBLIC_FF_CHARITY_CHECK=true` on a Vercel preview environment
5. Smoke-test the consumer surface (see §6 below)
6. Promote to production once preview soak is satisfactory

---

## 2. Environment variables

### Already present in the repo (reused)

| Env var                             | Status | Used by                                                                       |
| ----------------------------------- | ------ | ----------------------------------------------------------------------------- |
| `ABN_LOOKUP_GUID`                   | ✅     | ABR Lookup wrapper (`@askarthur/scam-engine/abr-lookup`) — pillar 2 (abr_dgr) |
| `GOOGLE_SAFE_BROWSING_API_KEY`      | ✅     | Safe Browsing leg of pillar 3 (donation_url) via existing scam-engine helper  |
| `WHOIS_API_KEY`                     | ✅     | WHOIS leg of pillar 3 (whoisjson.com, free 1000/month)                        |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | ✅     | Rate-limit buckets (cc_lookup, cc_autocomplete) + ABR Lookup result cache     |
| `SUPABASE_DB_URL`                   | ✅     | ACNC scraper Postgres connection (Supavisor port 6543)                        |
| `SUPABASE_SERVICE_ROLE_KEY`         | ✅     | API routes (RPC + table reads) — same key the rest of the app uses            |

### Charity-check-specific

| Env var                        | Status | Notes                                                                                                                                                                                                                                  |
| ------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_FF_CHARITY_CHECK` | ❌     | Default OFF — flip on Vercel preview to drive `/charity-check`                                                                                                                                                                         |
| `FF_CHARITY_CHECK_INGEST`      | ✅     | Set in `.github/workflows/scrape-feeds.yml` step env; also a turbo.json `globalEnv` entry so local dev can opt in                                                                                                                      |
| `CHARITY_CHECK_CAP_USD`        | ✅     | Default $5/day. Used by `apps/web/app/api/cron/cost-daily-check/route.ts` to engage `feature_brakes.charity_check`. v0.1+v0.2a are zero-marginal-cost; the brake exists ahead of v0.2b's image OCR (Claude Vision ~$0.002–$0.01/image) |

### GitHub Actions repo variables

| Variable                      | Value  | Notes                                                             |
| ----------------------------- | ------ | ----------------------------------------------------------------- |
| `ENABLE_CHARITY_CHECK_INGEST` | `true` | Set 2026-05-02. Gates the ACNC scraper step in `scrape-feeds.yml` |

---

## 3. Database state

### Migrations applied (production project `rquomhcgnodxzkhokwni`)

| Version                            | Applied at         | Purpose                                                                   |
| ---------------------------------- | ------------------ | ------------------------------------------------------------------------- |
| `v83_acnc_charities`               | 2026-05-02 02:42 Z | Creates `acnc_charities` table + 4 indexes + RLS + `search_charities` RPC |
| `v83_search_charities_search_path` | 2026-05-02 02:44 Z | Adds `SET search_path = public, pg_catalog` to the RPC (advisor WARN fix) |
| `v84_feed_ingestion_log_charity`   | 2026-05-02 06:11 Z | Adds `'charity'` to `feed_ingestion_log.record_type` CHECK allowlist      |

### Tables and row counts (post-first-ingest, 2026-05-02)

| Table                | Rows   | Source / refresh                                                        |
| -------------------- | ------ | ----------------------------------------------------------------------- |
| `acnc_charities`     | 63,637 | data.gov.au CKAN resource `eb1e6be4-...`, weekly source / daily scraper |
| `feed_ingestion_log` | + N    | One row per scraper run with `record_type='charity'`                    |
| `feature_brakes`     | + 1    | When `charity_check` brake engages (none today; default $5/day)         |

### RPCs

- `search_charities(p_query TEXT, p_limit INT DEFAULT 8)` — autocomplete; returns `(abn, charity_legal_name, town_city, state, charity_website, similarity_score)`. Trigram + ILIKE-prefix ranking; ILIKE-prefix wins (sim=1.0). Hardened with `SET search_path = public, pg_catalog`. Granted to `anon, authenticated, service_role`.

---

## 4. Scheduled jobs

| Job                  | Schedule           | Where                                                                    | What                                                                                                                                                                                                               |
| -------------------- | ------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ACNC register scrape | Daily at 06:00 UTC | `.github/workflows/scrape-feeds.yml` step "Scrape ACNC Charity Register" | Pulls 64k rows from CKAN, transforms, upserts via `INSERT ... ON CONFLICT DO UPDATE WHERE source_row_hash IS DISTINCT`. Daily run is a no-op on unchanged source — typical wall time ~3-4 minutes, zero DB writes. |
| Cost daily check     | Every 6 hours      | `apps/web/app/api/cron/cost-daily-check/route.ts` (Vercel Cron)          | Aggregates today's `cost_telemetry` rows for `feature='charity_check'`; engages `feature_brakes.charity_check` if spend > `CHARITY_CHECK_CAP_USD` (default $5).                                                    |

Manual scrape: `gh workflow run scrape-feeds.yml -f feed=acnc_register` (also accepts `feed=all`).

---

## 5. UI integration points

### Pages

- **`/charity-check`** — landing + form. `apps/web/app/charity-check/page.tsx`. Server-side `notFound()` when `featureFlags.charityCheck` is off (returns 404 in prod today).

### API routes

- **`POST /api/charity-check`** — main verdict endpoint. Zod input (either `abn` 11-digits or `name` ≥2-chars; optional `donationUrl`, `paymentMethod`). Rate-limited to 5/h/IP via `cc_lookup` bucket. Returns `CharityCheckResult` with `X-Request-Id`.
- **`GET /api/charity-check/autocomplete?q=...&limit=...`** — typeahead. Calls `search_charities` RPC; Redis 1h cache. Rate-limited to 60/min/IP via `cc_autocomplete` bucket.

### Components

- `apps/web/components/CharityChecker.tsx` — client form (name/ABN tabs, autocomplete listbox, donation URL field, payment method dropdown).
- `apps/web/components/CharityVerdict.tsx` — verdict pill, 4-fact icon strip, official donation URL CTA, state-register caveat link, HIGH_RISK escalation prompts, collapsible details cards.

### Helpers

- `apps/web/lib/charityRegistrySources.ts` — hand-maintained map of state code → fundraising-licence register URL + `requiresOwnLicence` flag (currently WA + TAS).

---

## 6. Smoke-test checklist (post flag-flip)

Run these on the preview deployment after setting `NEXT_PUBLIC_FF_CHARITY_CHECK=true`:

1. **SAFE happy path** — Visit `/charity-check?abn=11005357522`, expect SAFE verdict for "Australian Red Cross Society" with all four ticks lit, official donation URL CTA → `www.redcross.org.au`.
2. **Autocomplete** — Type "Cancer Council" in the name field, expect a listbox of all five state-level Councils with town + state shown.
3. **No match** — Submit `name=Definitely Not A Real Charity 12345`, expect SUSPICIOUS verdict with "we can't find this in the ACNC register" copy.
4. **Typosquat** — Submit `name=Astralian Red Cross` (1-letter typo), expect HIGH_RISK with `nearest_match: "Australian Red Cross Society"` shown in the verdict copy.
5. **Cash payment hard-floor** — Submit any registered charity with `paymentMethod=cash`, expect HIGH_RISK regardless of verdict score.
6. **Donation-URL pillar** — Submit `abn=11005357522` with `donationUrl=https://www.redcross.org.au`, expect 4 ticks lit including Donation URL; verify the collapsible "Donation URL details" section shows domain age + Safe Browsing clean.
7. **Rate-limit** — Submit 6 POST requests in under an hour, expect the 6th to return 429.

---

## 7. Compliance / privacy posture

- The ACNC dataset is licensed CC BY 3.0 AU. Attribution: surfaced in the verdict-screen footer ("Powered by ACNC Charity Register · ABR Lookup").
- No PII stored from charity-check requests. `cost_telemetry` rows record verdict + composite_score + provider IDs + latency, NOT the charity name or ABN being looked up.
- ABN Lookup responses cached in Redis for 24h (versioned cache key `askarthur:abn:v2:{ABN}`); cache holds public ABR data only.
- Withheld ACNC fields (e.g. women's-shelter security exemptions): if the source dataset omits a field, the row stores NULL — the engine doesn't auto-flag missing fields as suspicious.

---

## 8. What's NOT yet wired (deferred to v0.2/v0.3/v0.4)

See `BACKLOG.md → Charity Legitimacy Check` for the full deferred list. Highlights:

- **v0.2c**: PFRA member overlay + Scamwatch alert join (the differentiating face-to-face fundraiser layer)
- **v0.2e**: main-checker auto-detection deep-link from `/api/analyze`
- **v0.2d**: behavioural micro-flow (3-question vs. today's single dropdown)
- **v0.2b**: image OCR via Claude Vision (lanyard photo input)
- **v0.3**: state register scrapers (NSW, VIC, WA), AIS financial overlay, ACFID overlay
- **v0.4**: B2B `POST /api/v1/charity/verify` endpoint for SPF Act buyers

---

## 9. Operational reminders

- The scraper's daily run is a no-op when nothing changed (row-hash skip-on-no-change). Don't be alarmed by `status='partial'` in `feed_ingestion_log` — that's the expected steady-state for a weekly source on a daily schedule.
- `function_search_path_mutable` advisor WARNs were already addressed for the v83 RPC; future RPCs MUST include `SET search_path = public, pg_catalog`.
- The `extension_in_public` advisor WARN on `pg_trgm` is a pre-existing database-hygiene backlog item, not introduced by Charity Check — see `BACKLOG.md → Database Hygiene & SPF Readiness`.
