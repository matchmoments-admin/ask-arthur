# Critique — "AskArthur Threat Intelligence Ingestion" research doc

## Context

The user has produced a 40-source threat-intel ingestion plan dated 14 May 2026 and asked for a critique of its improvement value plus additional suggestions. The proposal is well-researched at the source level but operates from a stale picture of the codebase — it cites "16 Python scrapers" when the actual count is **26 active scrapers** (21 narrative/IOC + 5 vulnerability). Roughly **half of its Tier 1–3 recommendations are already shipped**. The critique below maps each recommendation against current state, identifies architectural mismatches with patterns already in production (`feed_items`, `feed_http_cache`, Voyage embeddings, greedy clustering, `feature_brakes`, chunked-retryable loops), and isolates the small set of net-new ideas that actually move the platform forward.

---

## 1. Coverage matrix — proposal vs current state

| Proposal source                                | Tier (proposal) | Actual status                  | Notes                                                                                                                                                             |
| ---------------------------------------------- | --------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ACSC alerts + advisories RSS                   | T1              | **SHIPPED**                    | `pipeline/scrapers/acsc_alerts.py` (every 3h) with WAF fallback. Proposal's `curl_cffi` advice is still useful for _article-body_ extraction, not the RSS itself. |
| Scamwatch HTML                                 | T1              | **SHIPPED**                    | `scamwatch_alerts.py` (every 3h). Email-channel ingestion is the genuine net-new (see §3).                                                                        |
| NASC news scrape                               | T1              | **NOT SHIPPED**                | Worth adding (Fusion Cell reports are high-signal).                                                                                                               |
| ACMA scam alerts                               | T1              | NOT SHIPPED                    | Net-new. Quarterly "Action on scams" PDF is highest value.                                                                                                        |
| URLhaus / OpenPhish                            | T1              | **SHIPPED**                    | `urlhaus.py` + `openphish.py`.                                                                                                                                    |
| AusCERT public RSS                             | T2              | NOT SHIPPED                    | Net-new. Body content is members-only; RSS title/summary is public.                                                                                               |
| AUSTRAC media release RSS                      | T2              | NOT SHIPPED                    | Net-new.                                                                                                                                                          |
| OAIC NDB releases                              | T2              | NOT SHIPPED                    | Net-new. Already on the Breach Defence Suite radar.                                                                                                               |
| AFP media releases                             | T2              | NOT SHIPPED                    | Net-new.                                                                                                                                                          |
| Services Australia                             | T2              | NOT SHIPPED                    | Net-new.                                                                                                                                                          |
| ACCC media releases                            | T2              | NOT SHIPPED                    | Net-new but high overlap with Scamwatch — dedupe critical.                                                                                                        |
| FTC Consumer Alerts (GovDelivery)              | T2              | NOT SHIPPED                    | Net-new. **Strongest international-source rationale in the proposal.**                                                                                            |
| FBI IC3 PSA scraper                            | T2              | NOT SHIPPED                    | Net-new. PDF annual report is the highest-value subset.                                                                                                           |
| HIBP breaches API                              | T2              | **SHIPPED**                    | `packages/scam-engine/src/hibp.ts` + `HIBP_API_KEY`.                                                                                                              |
| Risky Biz Substack RSS                         | T2              | NOT SHIPPED                    | Net-new. Trivial to add.                                                                                                                                          |
| NCSC UK                                        | T3              | NOT SHIPPED                    | Net-new. Low AU relevance — defer.                                                                                                                                |
| CISA advisories                                | T3              | **SHIPPED (as KEV vuln-feed)** | `pipeline/scrapers/vulnerabilities/cisa_kev.py` (Sundays). Proposal misranks this — it's a core vuln source, not Tier 3.                                          |
| Europol                                        | T3              | NOT SHIPPED                    | Net-new. Low AU relevance — defer.                                                                                                                                |
| State police                                   | T3              | NOT SHIPPED                    | Net-new but low-signal per-source; only worth doing if rolled into a single multi-state scraper.                                                                  |
| ABA news                                       | T3              | NOT SHIPPED                    | Net-new. Low frequency.                                                                                                                                           |
| AFCA datacube                                  | T3              | NOT SHIPPED                    | Net-new. PDF quarterly reports only.                                                                                                                              |
| eSafety newsroom                               | T3              | NOT SHIPPED                    | Net-new. Low scam-specific signal.                                                                                                                                |
| PhishTank                                      | T3              | **SHIPPED**                    | `phishtank.py`.                                                                                                                                                   |
| Spamhaus DROP                                  | T3              | **SHIPPED**                    | `spamhaus.py`.                                                                                                                                                    |
| APWG quarterly                                 | T3              | NOT SHIPPED                    | Net-new. Annual PDF only.                                                                                                                                         |
| MISP community feeds                           | T3              | NOT SHIPPED                    | Defer until partner asks (proposal agrees).                                                                                                                       |
| X/Twitter — Nitter/RSS-Bridge/socialdata.tools | T4              | NOT SHIPPED                    | Net-new. **High maintenance burden; proposal is correct that it's optional.**                                                                                     |

### Not in the proposal but already shipped (and underused upstream)

These are codebase assets the proposal should have built on rather than around:

- `asic_investor_alerts.py` (ASIC daily) — **major omission** for an AU scam product.
- `cert_au.py` (narrative + vuln variants, Playwright fallback already exists).
- `acnc_register.py` (CKAN, ABN enrichment, chunked-retryable pattern is the **reference** for any new long-running write loop).
- `phishstats.py`, `phishing_database.py`, `phishing_army.py`, `feodo.py`, `ipsum.py`, `abuseipdb.py`, `crtsh.py` (CT monitoring already runs every 12h).
- 5-scraper vulnerability workflow (NVD, GHSA, OSV, CISA KEV, CERT-AU CVE) — Sunday cron.
- Reddit r/Scams + the full **Reddit Intel** pipeline (Sonnet 4.6 classifier → Voyage 3 embedding → greedy pgvector clustering → themes → public `/intel/themes/[slug]` pages → B2B `/api/v1/intel/*` → weekly digest).

### Net-new score

Of the proposal's ~30 distinct source recommendations, **~12 are truly net-new** (NASC, ACMA, AUSTRAC, OAIC NDB, AFP, Services Australia, ACCC, AusCERT public RSS, AFCA, FTC, IC3, NCSC UK), **~10 are already shipped**, and the remainder (state police, ABA, eSafety, APWG, MISP, Europol, X/Twitter, Bluesky/Mastodon) are low-priority enough that they're not worth the engineering cost individually.

---

## 2. Architectural mismatches with what's already in production

The proposal's §8 ("Technical ingestion patterns") and §8.6 ("Suggested Supabase schema") read like greenfield design. They miss several patterns already operating in this repo, and the proposed schema would create parallel infrastructure to what already exists:

| Proposal                            | Existing equivalent                                                                                                                   | Recommendation                                                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New `feed_sources` config table     | None — and **this one is genuinely worth adding**. The existing pattern hardcodes source slugs in scrapers.                           | Adopt the proposal's `feed_sources` table verbatim. **Highest-leverage schema change in the proposal.**                                                               |
| New `feed_items` table              | **Exists** — `feed_items(id, source, narrative, title, url, entities, created_at, embedding)` with retention to `feed_items_archive`. | Drop the proposed schema, extend the existing one. Add `published_at`, `raw jsonb`, `external_id` if missing.                                                         |
| New `scam_alerts` normalized output | Function partly served by `feed_items` + `reddit_intel_themes` + `regulator-alert-push` Inngest.                                      | Build `scam_alerts` only if the goal is **post-classification** rollups distinct from raw feed items (e.g., Claude-extracted IoC bundles). Otherwise overlap is high. |
| ETag / Last-Modified caching        | **Exists** — `feed_http_cache` table; used by `common/http_cache.py`.                                                                 | Use, don't rebuild.                                                                                                                                                   |
| Feed health observability           | **Exists** — `feed_ingestion_log` (90d retention) + `/api/cron/scraper-brake-alert` every 15 min.                                     | Extend, don't rebuild. The proposal's `consecutive_failures >= 3 → disabled` rule is solid; add it as a column on the new `feed_sources` table.                       |
| `curl_cffi` for Cloudflare bypass   | Not used yet. ACSC RSS works via plain UA fallback; article bodies are harder.                                                        | Add as an opt-in helper in `pipeline/scrapers/common/`. Worth doing.                                                                                                  |
| Per-source cost brakes              | **Exists** — `feature_brakes` with `reddit_intel` (A$10/day), `phone_footprint`, `vuln_au_enrichment`, `charity_check` brakes.        | Add `feed_intel_ingest` brake before any source that triggers Claude per-item (Scamwatch via email → Claude is the obvious spend).                                    |
| STIX/TAXII object model             | Not used. Proposal recommends "wait until partner asks".                                                                              | Agree.                                                                                                                                                                |

**One pattern the proposal does not mention but should**: the **Voyage-embed + greedy-cosine-cluster + weekly-theme** machinery that powers Reddit Intel is **directly reusable** for regulator narratives. The proposal treats ACSC/Scamwatch/AFP/AUSTRAC as item-level events to be surfaced in a feed; the codebase has already proven that theme-clustered narratives ship better blog content and digest emails. **The genuine architectural upgrade is to extend the Reddit Intel theme-clustering machinery across `source IN ('acsc','scamwatch_alert','asic_investor', + new gov sources)`, not to add 12 more item-level feeds.**

---

## 3. The one high-leverage idea: inbound-email infrastructure

Buried in §2 and §8.4, the strongest single recommendation in the proposal is **inbound-email ingestion**. The codebase has zero inbound-email handling today, and this single piece of infrastructure unlocks ≥8 of the proposed sources in one shot:

- Scamwatch alerts (no RSS exists)
- AusCERT Week-in-Review (paid, member-only)
- IDCARE Insights (no RSS, infrequent)
- FTC Consumer Alerts GovDelivery (no native RSS)
- AUSTRAC subscription
- OAIC newsletter
- AFP media-release subscription
- Risky Biz / Krebs (already RSS-available, but email is a backup)

Recommended stack (matches the proposal): **Cloudflare Email Routing → Cloudflare Worker → Supabase Edge Function → Inngest `email/received` event → Claude normalization → `feed_items` insert.** Address tagging (`acsc+ingest@`, `scamwatch+ingest@`) gives free source attribution.

**Why this is the highest-leverage move**: every "no RSS / Drupal scrape" source listed in the proposal becomes a 10-line subscription instead of a 200-line scraper with bot-management bypass. It also gives clean source coverage in places where HTML scraping is a legal grey area.

**Cost-brake before launch**: every inbound email triggers a Claude extraction. With ~20 subscriptions sending ~5 emails/day on average, that's ~100 Claude calls/day. Add a `feed_intel_inbound_email` row to `feature_brakes` with A$3/day cap before flipping it on.

---

## 4. Additional suggestions the proposal missed

Ordered by improvement value, not by effort.

### 4.1 Reuse Reddit Intel clustering for regulator narratives (≈2 days)

Refactor `reddit-intel-daily` / `reddit-intel-cluster` to accept a `source_filter` parameter. Run a parallel daily cron clustering Scamwatch + ACSC + ASIC + (new) NASC + ACMA + AFP narratives into `regulator_intel_themes`. This is the missing piece between "we ingest 26 sources" and "we publish a coherent weekly scam brief". The blog generator currently sources only from `verified_scams` user reports — it should also consume `regulator_intel_themes`.

### 4.2 CertStream WebSocket for live brand-impersonation (≈3 days)

`crtsh.py` runs every 12h. CertStream (calidog.io) is the live WebSocket of new CT log entries. For AU brand impersonation watchlists (auspost, mygov, bigbanks, ATO), real-time detection beats 12h-batch. Persistent worker on Fly.io / Railway (cannot run on Vercel — needs long-lived WebSocket).

### 4.3 ACCC/ASIC/Scamwatch quarterly PDF ingestion (≈1 day)

Annual/quarterly reports (ACCC Targeting Scams, ACMA "Action on Scams, Spam, and Telemarketing", AFCA quarterly, OAIC NDB, APWG quarterly, FBI IC3 annual) are the **highest signal-density** documents in the AU scam ecosystem. One Inngest function that downloads PDFs from a known URL list once per release and pushes them through Claude with a JSON-schema prompt → `regulator_report_extracts` table. Far higher leverage than scraping any individual news page.

### 4.4 Cross-link regulator narratives to crt.sh watchlist (≈half-day)

When an ACSC/Scamwatch/AFP alert names an impersonated brand, auto-enqueue `{brand}.au`, `{brand}-*.com`, etc. into the existing CT-monitor watchlist. The pieces all exist; nothing connects them. This is a 50-line cron change.

### 4.5 auDA `.au` zone data / passive DNS (≈2 days)

For typosquat detection (already in the Breach Defence Suite plan), passive DNS is the missing prerequisite. **DomainTools Iris** is paid; **CIRCL passive DNS** is free for researchers. auDA does not publish the `.au` zone publicly, but newly registered `.au` domains appear in the CT logs (and in `crtsh.py`). Cheaper interim: scrape `whoisxmlapi.com/whois-database-download/newly-registered-domains` (paid) or rely on crt.sh + Cloudflare Radar.

### 4.6 Cloudflare Radar `Top Domains AU` weekly snapshot (≈half-day)

Free public API: `https://api.cloudflare.com/client/v4/radar/datasets/top` — exposes most-visited AU domains weekly. Useful for keeping the brand-impersonation watchlist current automatically (vs. hardcoded `auspost / mygov / ato / commbank` list).

### 4.7 VirusTotal v3 enrichment (≈1 day, free tier)

4 req/min on the free tier is plenty for URL enrichment in the analyze pipeline. The proposal mentions URLhaus and PhishTank but skips VT, which has 70+ engine consensus. Add as a `pipeline-vt-enrichment` Inngest with cost-brake — even on the free tier the rate-limit can starve the analyze path under load, so per-call budget tracking matters.

### 4.8 LinkedIn company-page monitoring via paid RSS (≈half-day, ~A$30/mo)

The proposal correctly notes ABA / IDCARE / NASC post primarily to LinkedIn. RSS.app and feedly.com expose company-page feeds for ~A$30/mo each. For ≤5 priority handles this is cheaper than self-hosting RSS-Bridge and more reliable than scraping. Worth a recurring subscription line item, not engineering.

### 4.9 What to **defer** or **skip outright**

- **State police RSS** — too low signal per source; only useful if bundled into one "AU law-enforcement" multi-source scraper, and even then mostly republishes ACSC/Scamwatch.
- **NCSC UK + Europol + Action Fraud** — international-only, low AU relevance. Defer until B2B has UK customers.
- **X/Twitter ingestion** — proposal is right that this is maintenance hell. Skip entirely until a specific user-facing feature demands it. **AskArthur is not a Twitter-monitoring product**.
- **Bluesky / Mastodon mirrors** — most AU gov accounts don't mirror there. Real coverage gap is too small to be worth a pipeline.
- **MISP / STIX-TAXII** — agreed with proposal: defer until a partner asks.
- **Newsletter SaaS aggregators (Feedly / RSS.app)** — except for the LinkedIn use case above, prefer first-party sources.

---

## 5. Risks the proposal does not flag

1. **`feed_items` is on the hot-table list** in `CLAUDE.md`. Adding 10+ new narrative scrapers writing to it amplifies the May 9 2026 incident risk. Mitigations: (a) every new scraper uses the `acnc_register.py` chunked-retryable pattern, (b) `statement_timeout = '300s'` cap, (c) never put a new index on `feed_items`; sibling tables only.
2. **Claude cost discipline lives in Wave 3, not at ingestion**. Ingestion scrapers don't call Claude per item — they just write to `feed_items`. The only Claude-per-item step is the optional Wave 3 regulator clustering (Sonnet 4.6, ~5–10 new items/day, weekly cadence, Batch API). Brake `regulator_intel` at A$5/day applies there. Inbound-email Worker writes raw text, no per-message Claude.
3. **Schema-drift defence**: Claude extraction against a Zod schema is non-negotiable. Quarantine table for failed extractions is missing from the proposal's schema. Existing pattern: see `cost_telemetry WHERE feature='reddit-intel-error'`.
4. **GovDelivery email link-rewriting** wraps every link in tracking redirects. The proposal mentions this; the implementation must resolve redirects _before_ Claude extraction or the model will hallucinate destinations.
5. **`curl_cffi` is not currently in `pipeline/scrapers/requirements.txt`**. Adding it requires a CI re-test of every existing scraper, since changing the HTTP stack default could regress 26 working scrapers. Recommendation: introduce `curl_cffi` as an opt-in helper in `common/http_impersonate.py`, not a default.
6. **`pg-stuck-query-watchdog` will fire** if any new scraper's per-chunk write exceeds 10 min. Document expected duration in each scraper's header per `CLAUDE.md` rule.

---

## 6. Final build plan — item × feature flag × improvement value × cost

Each item ships as one PR, feature-flagged for independent rollout. **Default state for every new flag is OFF**, matching the codebase convention (`NEXT_PUBLIC_FF_*` for consumer surfaces, `ENABLE_*` for ingestion gates, `feature_brakes` row for cost ceilings). Costs are Sydney-region 2026 estimates in AUD.

### Flag-naming conventions (match existing patterns)

| Pattern                        | Use for                             | Example in repo                                        |
| ------------------------------ | ----------------------------------- | ------------------------------------------------------ |
| `ENABLE_<SOURCE>_INGEST`       | New scraper / ingestion path on/off | `ENABLE_CHARITY_CHECK_INGEST`, `ENABLE_VULN_SCRAPER`   |
| `FF_<FEATURE>` (server)        | New downstream surface or B2B path  | `FF_REDDIT_INTEL_B2B_API`, `FF_ANALYZE_INNGEST_WEB`    |
| `NEXT_PUBLIC_FF_<FEATURE>`     | Consumer-facing UI gate             | `NEXT_PUBLIC_FF_REDDIT_INTEL_PUBLIC_PAGES`             |
| `feature_brakes.<feature>` row | Daily-spend cost ceiling            | `reddit_intel` (A$10/day), `phone_footprint` (A$5/day) |

---

### Cost model — why "free" actually means free

The existing 26 scrapers cost ~A$0/mo because they follow a strict pattern:

1. Scraper (GitHub Actions free tier) pulls source → writes rows to `feed_items` / `vulnerability_iocs` / `scam_entities`. **Zero Claude calls in this step.**
2. The existing `feed-items-embed` Inngest (every 30 min) runs Voyage 3 embeddings on new rows at ~A$0.12 / 1M tokens — pennies per month.
3. Downstream features (Reddit Intel clustering, regulator-alert-push) consume from `feed_items`; only the **opt-in** Sonnet classifier in Reddit Intel costs real money (A$10/day brake).

**Every new ingestion item below follows the same pattern: write to `feed_items`, let existing infra embed it, defer Claude work to Wave 3 clustering (which is the only Claude-per-item step, and is itself optional).** The inbound-email pipeline writes to `feed_items` like any scraper — no per-email Claude call required.

That correction removes ~A$200/mo from the totals in the previous version of this plan. Real recurring cost across all four waves is ~A$17/mo if Wave 5 LinkedIn is skipped, dominated by the Fly.io CertStream worker.

---

### Cadence schedule — when each source runs

Most new sources update weekly or monthly. Slotting them into the existing 4-tier GitHub Actions schedule (`0 */3`, `0 */6`, `0 */12`, `0 16 * * *` in `.github/workflows/scrape-feeds.yml`) avoids per-tier overhead. Wave 3 clustering moves to **weekly** Sunday before the Monday blog/digest crons.

| Item                        | Source-update cadence | Recommended scrape                    | Why                                                          |
| --------------------------- | --------------------- | ------------------------------------- | ------------------------------------------------------------ |
| NASC                        | Monthly               | Daily 16:00 UTC                       | Cheap check, source update rare                              |
| ACMA alerts                 | Weekly                | Daily 16:00 UTC                       | Same                                                         |
| ACMA quarterly PDF          | Quarterly             | Weekly (HEAD check)                   | One file every 13 weeks                                      |
| AUSTRAC RSS                 | Weekly                | Daily 16:00 UTC                       | RSS — feedparser-cheap                                       |
| OAIC NDB                    | 6-monthly             | Weekly (HEAD check)                   | Two PDFs/year                                                |
| AFP media                   | Daily                 | Daily 16:00 UTC                       | Matches source cadence                                       |
| Services Australia          | Monthly               | Weekly                                | Low volume                                                   |
| AusCERT public RSS          | Weekly                | Daily 16:00 UTC                       | RSS                                                          |
| Risky Biz / Krebs Substack  | 3–5/week              | Daily 16:00 UTC                       | RSS                                                          |
| FTC Consumer Alerts         | 3/week                | **Event-driven** (inbound email push) | No polling needed                                            |
| Cloudflare Radar Top AU     | Weekly                | Weekly                                | Source itself only changes weekly                            |
| Wave 3 regulator clustering | —                     | **Weekly Sun 06:00 UTC**              | Only consumers (Mon 12:00 blog, Mon 14:00 digest) are weekly |
| Quarterly PDF ingester      | —                     | Event-driven on `feed_items` insert   | Fires only when new PDF row lands                            |
| CertStream                  | Live                  | Persistent Fly.io worker              | Streaming, can't batch                                       |
| VirusTotal v3               | On-demand             | Event-driven from analyze path        | Already event-driven                                         |

This is the cadence that produces the ~A$2/mo Wave 3 number — at higher cadence (daily), Wave 3 would creep toward A$15–30/mo.

---

### Batching & cost-reduction levers

Apply these at build time, not as a later optimisation:

1. **Anthropic Batch API for Wave 3 clustering** — 50% off list price, 24h SLA. The weekly Sunday cron fits the SLA trivially. Reddit Intel pipeline could pick this up as a follow-up optimisation.
2. **Prompt caching on the clustering classifier** — 90% off the cached prefix. The system prompt + few-shot examples (~2–3k tokens) don't change between calls; mark them with `cache_control`. Combined with Batch, effective rate drops to ~10–25% of list price.
3. **Weekly clustering, not daily** — already encoded in the cadence table above. 7× fewer Sonnet calls.
4. **Fan-in scraper → embed → cluster** — instead of N daily scrapers each kicking off N embed jobs, one nightly Inngest function reads "new since yesterday", batch-embeds via Voyage, then queues Sunday clustering. Fewer cold starts, simpler retry logic.
5. **Voyage 3 batch endpoint** — existing `feed-items-embed` polls every 30 min with 40-row batches; move to hourly + 200-row batches to reduce request overhead. Cost is already pennies/mo so this is hygiene, not savings.
6. **GitHub Actions caching of `pip install`** — already in `.github/workflows/scrape-feeds.yml` per project conventions; verify the new scrapers don't introduce unique deps that bust the cache.

---

### Voyage embedding integration — what every new narrative source needs

The existing `feed-items-embed` Inngest function (`packages/scam-engine/src/inngest/functions.ts`) calls the RPC `get_unembedded_narrative_feed_items()`, which has a **hardcoded source allowlist**:

```sql
WHERE embedding IS NULL
  AND source IN ('scamwatch_alert', 'acsc', 'asic_investor')
```

The RPC lives in `supabase/migrations/v97-news-intel-narrative.sql` (line ~124), and the `feed_items_source_check` constraint sits in the same file (lines ~40–49).

**Per-source checklist for every new narrative scraper:**

1. Add slug to `feed_items_source_check` constraint (1 line).
2. Add slug to `get_unembedded_narrative_feed_items()` allowlist (1 line).
3. Both go in a new migration `vNNN-news-intel-add-<source>.sql`.
4. Scraper imports `bulk_upsert_narrative_feed_items` from `common/db.py`, calls `conditional_get` from `common/http_cache.py` (ETag/Last-Modified caching), logs to `feed_ingestion_log` via `log_ingestion`.
5. `feed-items-embed` picks up new rows on its next 30-min tick automatically — no TypeScript change required.

Batch size is `BATCH_LIMIT = 40` per invocation; cost telemetry tag is `feature: "news-intel-embed"`. Voyage 3 at ~A$0.12 / 1M tokens × ~500 tokens/item × ~10 new items/day ≈ ~A$0.02/mo total. **Voyage is in the plan but its cost is too small to break out separately.**

---

### Wave 1 — Infrastructure (≈6 eng-days, ~A$0/mo recurring)

**1. `feed_sources` config table + scraper refactor**

- **Flags:** none (one-time schema migration v100; `feed_sources.enabled` column gates each row).
- **Cost brake:** —
- **Improvement value:** Source config moves from hardcoded scraper slugs to DB rows. Enable/disable per-source without redeploy; `consecutive_failures >= 3 → auto-disabled` defence; one query lists every active feed.
- **Eng:** 1–2 days
- **Recurring:** A$0

**2. Inbound-email ingestion pipeline**

- **Flags:** `ENABLE_INTEL_INBOUND_EMAIL` (server) — when off, Worker drops mail with `204`.
- **Cost brake:** none required at MVP; add `feature_brakes.intel_inbound_email` at A$1/day only if quarantine-path Claude calls become non-trivial.
- **Improvement value:** Unlocks ≥8 sources in one piece of infra (Scamwatch, FTC Consumer Alerts, AusCERT digest, IDCARE Insights, AUSTRAC, OAIC, AFP, Risky Biz backup). Replaces every "no RSS / Drupal scrape" path. Address tagging gives free attribution.
- **Eng:** 3–4 days (Cloudflare Email Routing config, Worker, Supabase Edge Function, Inngest `email/received`, link-redirect resolution, Zod-validated `feed_items` insert).
- **Recurring:** A$0. Cloudflare Email Routing free. Worker free within 100k req/day tier. Supabase Edge Function free within existing tier. No per-email Claude call — the Worker strips GovDelivery wrapper redirects and writes raw body text to `feed_items`; existing `feed-items-embed` and Wave 3 clustering handle the rest. Claude only fires on the quarantine path when a parse fails — measured in dollars/year, not month.

**3. `common/http_impersonate.py` helper (curl_cffi)**

- **Flags:** none (opt-in import per scraper).
- **Cost brake:** —
- **Improvement value:** Cloudflare-protected article-body extraction for ACSC + AusCERT bodies (RSS works without it; bodies don't). Avoids regressing the existing 26-scraper HTTP stack by being opt-in only.
- **Eng:** 1 day (including CI smoke-test on one existing scraper).
- **Recurring:** A$0

---

### Wave 2 — High-signal AU government sources (≈6 eng-days, ~A$0/mo recurring)

**Every Wave 2 scraper writes to `feed_items` with no per-item Claude call.** Voyage embedding via existing `feed-items-embed` Inngest costs pennies/month at this volume. The Sonnet classifier in Wave 3 is the only Claude-per-item step — it runs once over all sources combined, gated by its own flag and brake. No `intel_gov_news` brake is needed at the ingestion layer.

**4. NASC news + Fusion Cell reports**

- **Flags:** `ENABLE_NASC_INGEST` (server, default off). `feed_sources` row `slug='nasc'`.
- **Cost brake:** —
- **Improvement value:** Fusion Cell PDFs (job-scam, investment, romance) are the **highest-signal trend reports** the NASC produces; not in any other source.
- **Eng:** 1 day
- **Recurring:** A$0

**5. ACMA scam alerts + quarterly "Action on Scams" PDF**

- **Flags:** `ENABLE_ACMA_INGEST` (server). `feed_sources` rows `slug='acma_alerts'`, `slug='acma_quarterly'`.
- **Cost brake:** —
- **Improvement value:** Telco-blocking stats (156.8m+ blocked calls/quarter) and joint Scamwatch/ACMA alerts. Dedupe-critical against Scamwatch.
- **Eng:** 1.5 days
- **Recurring:** A$0

**6. AUSTRAC media release RSS**

- **Flags:** `ENABLE_AUSTRAC_INGEST` (server). `feed_sources` row `slug='austrac'`.
- **Cost brake:** —
- **Improvement value:** Money-mule and payment-fraud typology reports — direct input to romance-scam and investment-scam blog content.
- **Eng:** 0.5 days
- **Recurring:** A$0

**7. OAIC NDB releases**

- **Flags:** `ENABLE_OAIC_NDB_INGEST` (server). Coordinate with the Breach Defence Suite paused PR set.
- **Cost brake:** —
- **Improvement value:** 6-monthly breach dataset directly tells us which sectors are in scammer crosshairs over the next 90 days.
- **Eng:** 1 day
- **Recurring:** A$0

**8. AFP media releases (cyber/fraud-filtered)**

- **Flags:** `ENABLE_AFP_INGEST` (server). `feed_sources` row `slug='afp'`.
- **Cost brake:** —
- **Improvement value:** Cybercrime op announcements (Operation Firestorm, JPC3). Keyword pre-filter for `scam | fraud | cyber | phishing` at ingestion (no Claude needed).
- **Eng:** 1 day
- **Recurring:** A$0

**9. Services Australia scam alerts**

- **Flags:** `ENABLE_SERVICESAUSTRALIA_INGEST` (server). `feed_sources` row `slug='services_australia'`.
- **Cost brake:** —
- **Improvement value:** myGov / Centrelink / Medicare impersonation source-of-truth. Weekly cadence — very low volume, very high signal.
- **Eng:** 1 day
- **Recurring:** A$0

---

### Wave 3 — Cross-cut machinery, the actual multiplier (≈4 eng-days, ~A$30/mo recurring)

**This wave is where all Claude-per-item cost lives.** It is optional — turning off `FF_REGULATOR_INTEL_THEMES` reverts the whole platform to "ingest + embed + push raw alerts", which is still useful and costs A$0.

**10. Regulator-narrative theme clustering**

- **Flags:** `FF_REGULATOR_INTEL_THEMES` (server). When off, Wave 2 ingestion still happens, but clustering doesn't run.
- **Cost brake:** new `feature_brakes.regulator_intel` row at A$5/day (parallels the existing `reddit_intel` A$10/day brake). Brake is defensive — typical spend should sit two orders of magnitude below the cap.
- **Improvement value:** **The real multiplier in this plan.** Reuses the proven Sonnet 4.6 → Voyage 3 → greedy-cosine-cluster pipeline that already powers Reddit Intel. Turns 12 item-level feeds into clustered themes feeding blog + digest + B2B API. New table `regulator_intel_themes` (mirrors `reddit_intel_themes` schema).
- **Cadence:** **Weekly Sunday 06:00 UTC**, 8h before the Monday 12:00 UTC blog cron and 14h before the Monday 14:00 UTC digest cron. Reddit Intel keeps its existing daily cadence; regulator narratives drift slowly enough that weekly is correct.
- **Batching:** Anthropic **Batch API** (50% discount, 24h SLA — fits weekly cron) + **prompt caching** on the classifier system prompt + few-shot examples (~90% discount on cached prefix). Effective Sonnet rate ≈ 10–25% of list.
- **Eng:** 2 days (refactor `reddit-intel-daily` / `reddit-intel-cluster` to accept `source_filter`; add weekly `regulator-intel-cluster` Inngest cron; wire Batch API + prompt cache).
- **Recurring:** **~A$2/mo realistic.** ~30–60 new narratives per week × Sonnet 4.6 @ effective ~A$0.003/item after Batch + caching. Brake cap A$5/day = A$150/mo absolute worst case (would only fire on a runaway loop).

**11. Blog generator extension to consume regulator themes**

- **Flags:** `FF_BLOG_REGULATOR_THEMES` (server). When off, `generateWeeklyBlogPost()` falls back to `verified_scams`-only sourcing (current behaviour).
- **Cost brake:** none (within existing weekly blog budget).
- **Improvement value:** Blog generator stops being a user-report rehash; gains structured regulator-narrative input. Higher SEO E-E-A-T (citing government sources) and faster topic-currency.
- **Eng:** 1 day
- **Recurring:** A$0 (existing weekly blog budget unchanged)

**12. Quarterly / annual PDF ingester**

- **Flags:** `ENABLE_REGULATOR_PDF_INGEST` (server). `feed_sources` row per release `slug='accc_targeting_scams_2026q1'` etc.
- **Cost brake:** —
- **Improvement value:** ACCC Targeting Scams, ACMA quarterly Action on Scams, AFCA quarterly, OAIC NDB, APWG quarterly, FBI IC3 annual — **highest signal-density documents in the AU scam ecosystem**. One Inngest function, fixed URL list, Claude → `regulator_report_extracts` table.
- **Eng:** 1 day
- **Recurring:** ~A$1/mo (one Sonnet call per release × ~10 releases/year = cents/month; rounded up).

---

### Wave 4 — International high-signal + supplements (≈5 eng-days, ~A$15/mo recurring)

**13. FTC Consumer Alerts (via Wave 1 inbound email)**

- **Flags:** no new code flag — flip on once Wave 1 is live by subscribing `ftc+ingest@intel.askarthur.au` to GovDelivery.
- **Cost brake:** —
- **Improvement value:** Top US consumer-protection editorial. ~3 posts/week, lightweight, useful for blog-comparison and explainer-writing.
- **Eng:** 0 days (operational, not engineering).
- **Recurring:** A$0

**14. Risky Biz + Krebs Substack RSS**

- **Flags:** `ENABLE_NEWSLETTER_RSS_INGEST` (server). `feed_sources` rows for each newsletter.
- **Cost brake:** —
- **Improvement value:** AU-coverage commentary (Risky Biz is a Sydney-based publication). Low-volume, trivial to ingest.
- **Eng:** 0.5 days
- **Recurring:** A$0

**15. AusCERT public RSS**

- **Flags:** `ENABLE_AUSCERT_INGEST` (server). `feed_sources` row `slug='auscert_public'`.
- **Cost brake:** —
- **Improvement value:** Vulnerability awareness summaries (body content is members-only — defer paid membership until proven).
- **Eng:** 0.5 days
- **Recurring:** A$0

**16. CertStream live WebSocket on Fly.io**

- **Flags:** `ENABLE_CERTSTREAM_BRAND_WATCH` (Fly.io worker env). When off, `crtsh.py` 12h batch remains the only CT source.
- **Cost brake:** `feature_brakes.certstream_brand_watch` at A$1/day (Claude only fires on watchlist matches — rare; defensive cap only).
- **Improvement value:** **Real-time** brand-impersonation detection (vs. the existing 12h batch). For `auspost / mygov / ato / commbank` the latency difference is the difference between catching first-100-victims and first-10,000.
- **Eng:** 3 days (Fly.io worker setup, persistent WebSocket, watchlist sync with Supabase, alert pipeline).
- **Recurring:** ~A$15/mo. Fly.io shared-cpu-1x is ~US$5/mo ≈ A$8/mo; round to A$15 to cover bandwidth + occasional Claude calls on brand-watchlist hits.

**17. VirusTotal v3 enrichment in analyze pipeline**

- **Flags:** `ENABLE_VT_ENRICHMENT` (server) — gates the new Inngest `pipeline-vt-enrichment`.
- **Cost brake:** `feature_brakes.vt_enrichment` at A$0 — free tier only; brake fires on rate-limit (4 req/min) not spend.
- **Improvement value:** 70+ AV-engine consensus on every URL the analyze path sees. Cheap, high-confidence corroboration layer for SUSPICIOUS verdicts.
- **Eng:** 1 day
- **Recurring:** A$0 (free tier)

---

### Wave 5 — Discretionary low-priority adds (defer until Wave 1–4 prove value)

**18. Cross-link regulator narratives → CT watchlist auto-seed**

- **Flags:** `ENABLE_REGULATOR_BRAND_AUTOSEED` (server). Depends on Wave 3 (#10) being live.
- **Cost brake:** none (write-only).
- **Improvement value:** When ACSC names "ATO" in an alert, auto-enqueue `ato-*.com`, `myato.au`, etc. into the existing `pipeline-ct-monitor` watchlist. Connects two systems that already exist.
- **Eng:** 0.5 days
- **Recurring:** A$0

**19. Cloudflare Radar `Top Domains AU` snapshot**

- **Flags:** `ENABLE_CF_RADAR_TOP_AU` (server). `feed_sources` row `slug='cf_radar_top_au'`.
- **Cost brake:** none.
- **Improvement value:** Auto-update brand-impersonation watchlist from real AU traffic data (vs. hardcoded `auspost / mygov / commbank` list).
- **Eng:** 0.5 days
- **Recurring:** A$0 (Cloudflare Radar public API).

**20. LinkedIn company-page paid RSS aggregator**

- **Flags:** `ENABLE_LINKEDIN_RSS_INGEST` (server). `feed_sources` rows per handle.
- **Cost brake:** shared `feature_brakes.intel_gov_news`.
- **Improvement value:** ABA / IDCARE / NASC post primarily to LinkedIn; this is the only channel that catches their content. ≤5 priority handles only.
- **Eng:** 0.5 days
- **Recurring:** ~A$30/mo (RSS.app or feedly.com).

**21. Passive DNS (CIRCL free tier)**

- **Flags:** `ENABLE_PASSIVE_DNS_INGEST` (server). Prereq for the Breach Defence Suite typosquat feature.
- **Cost brake:** none (free tier, rate-limited).
- **Improvement value:** Typosquat detection prerequisite. Only ship when Breach Defence Suite resumes from its 2026-04-29 pause.
- **Eng:** 2 days
- **Recurring:** A$0 (CIRCL free) or A$50/mo (DomainTools Iris) — defer commercial.

---

### Summary table

Two numbers per row: **Build** is one-time engineering cost (person-days). **Recurring** is the new monthly spend the feature adds when its flag is on.

| #   | Item                                               | Wave | Flag                              | Brake                          | Build (days) | Recurring (A$/mo) |
| --- | -------------------------------------------------- | ---- | --------------------------------- | ------------------------------ | ------------ | ----------------- |
| 1   | `feed_sources` table                               | 1    | —                                 | —                              | 1–2          | 0                 |
| 2   | Inbound-email pipeline                             | 1    | `ENABLE_INTEL_INBOUND_EMAIL`      | (defer)                        | 3–4          | 0                 |
| 3   | `curl_cffi` helper                                 | 1    | — (opt-in)                        | —                              | 1            | 0                 |
| 4   | NASC                                               | 2    | `ENABLE_NASC_INGEST`              | —                              | 1            | 0                 |
| 5   | ACMA                                               | 2    | `ENABLE_ACMA_INGEST`              | —                              | 1.5          | 0                 |
| 6   | AUSTRAC                                            | 2    | `ENABLE_AUSTRAC_INGEST`           | —                              | 0.5          | 0                 |
| 7   | OAIC NDB                                           | 2    | `ENABLE_OAIC_NDB_INGEST`          | —                              | 1            | 0                 |
| 8   | AFP                                                | 2    | `ENABLE_AFP_INGEST`               | —                              | 1            | 0                 |
| 9   | Services Australia                                 | 2    | `ENABLE_SERVICESAUSTRALIA_INGEST` | —                              | 1            | 0                 |
| 10  | Regulator theme clustering (weekly, Batch + cache) | 3    | `FF_REGULATOR_INTEL_THEMES`       | `regulator_intel` A$5/d        | 2            | ~2                |
| 11  | Blog generator extension                           | 3    | `FF_BLOG_REGULATOR_THEMES`        | —                              | 1            | 0                 |
| 12  | Quarterly/annual PDF ingester                      | 3    | `ENABLE_REGULATOR_PDF_INGEST`     | —                              | 1            | ~1                |
| 13  | FTC Consumer Alerts (email)                        | 4    | (Wave 1 flag)                     | —                              | 0            | 0                 |
| 14  | Risky Biz + Krebs RSS                              | 4    | `ENABLE_NEWSLETTER_RSS_INGEST`    | —                              | 0.5          | 0                 |
| 15  | AusCERT public RSS                                 | 4    | `ENABLE_AUSCERT_INGEST`           | —                              | 0.5          | 0                 |
| 16  | CertStream brand watch                             | 4    | `ENABLE_CERTSTREAM_BRAND_WATCH`   | `certstream_brand_watch` A$1/d | 3            | ~15               |
| 17  | VirusTotal v3 enrichment                           | 4    | `ENABLE_VT_ENRICHMENT`            | `vt_enrichment` (rate, not $)  | 1            | 0                 |
| 18  | Regulator→CT autoseed                              | 5    | `ENABLE_REGULATOR_BRAND_AUTOSEED` | —                              | 0.5          | 0                 |
| 19  | Cloudflare Radar Top AU                            | 5    | `ENABLE_CF_RADAR_TOP_AU`          | —                              | 0.5          | 0                 |
| 20  | LinkedIn paid RSS                                  | 5    | `ENABLE_LINKEDIN_RSS_INGEST`      | —                              | 0.5          | ~30               |
| 21  | Passive DNS (CIRCL)                                | 5    | `ENABLE_PASSIVE_DNS_INGEST`       | —                              | 2            | 0                 |
|     | **TOTALS**                                         |      |                                   |                                | **~24 days** | **~A$18/mo**      |

### Where the A$18/mo recurring actually lives

- **#16 CertStream worker (~A$15/mo)** — Fly.io shared-cpu-1x ~US$5/mo + bandwidth + occasional Claude on watchlist hits. Real recurring infra cost, not Claude. Dominates the bill.
- **#10 Regulator clustering (~A$2/mo)** — Sonnet 4.6 via Batch API + prompt caching, weekly cadence, ~30–60 new items/week. **Optional**: `FF_REGULATOR_INTEL_THEMES` off → A$0, platform still gets `regulator-alert-push` raw alerts and weekly digest. Brake cap A$5/day = A$150/mo absolute worst case.
- **#12 Quarterly PDF ingester (~A$1/mo)** — ~10 PDFs/year, one Sonnet call each.
- **Everything else: A$0/mo.** Scrapers write to `feed_items`, Voyage embedding runs in the existing 30-min Inngest at pennies/mo, no per-item Claude.
- **Wave 5 #20 LinkedIn RSS.app (+A$30/mo)** is paid SaaS; ship only if ABA / IDCARE / NASC LinkedIn coverage proves missing after Waves 1–4 are live.

### Headline scenarios

| What you ship                                                      | Build (days) | Recurring (A$/mo) |
| ------------------------------------------------------------------ | ------------ | ----------------- |
| Ingestion only (Waves 1+2+4 minus #16, no clustering, no LinkedIn) | ~17          | **A$0**           |
| Add Wave 3 regulator clustering (weekly, Batch + cache)            | ~21          | **~A$2**          |
| Add CertStream Fly.io worker (Wave 4 #16)                          | ~24          | **~A$17**         |
| Add LinkedIn RSS.app (Wave 5 #20)                                  | ~25          | **~A$47**         |
| Worst case if every brake fires daily                              | —            | A$180 ceiling     |

### Why this is so much cheaper than I first quoted

The previous version of this plan modelled every new ingestion source as if it called Claude per item (the Reddit Intel model — A$10/day brake). It doesn't. The shipped pattern is **scraper → `feed_items` (no Claude) → existing `feed-items-embed` job (Voyage, pennies/month) → optional downstream Sonnet classifier (Wave 3, gated)**. Once you separate ingestion from classification, ingestion is free. The only Claude-per-item spend is the _opt-in_ clustering in Wave 3, plus rare Sonnet calls on CertStream matches and quarterly PDFs.

The other previous mistake: pricing Cloudflare Email Routing inbound at ~A$90/mo. Cloudflare Routing, the Worker, the Supabase Edge Function, and the Inngest event are all free at this volume. The pipeline only needs Claude if we choose to do structured normalisation in the Worker — and we don't, because the same clustering job that handles RSS items in Wave 3 will handle email-sourced items identically.

### Explicitly deferred / dropped

Sources removed from the plan entirely (won't ship, even behind a flag):

- All state police RSS — too low signal per source.
- NCSC UK, Europol, Action Fraud — international-only, defer until B2B has UK customers.
- X / Twitter ingestion (Nitter, RSS-Bridge, socialdata.tools, twitterapi.io, Apify).
- Bluesky / Mastodon mirrors — too few AU gov accounts present.
- MISP / STIX-TAXII — defer until a partner asks.
- Commercial threat-intel (Recorded Future, Flashpoint) — overkill for a consumer scam product.
- ABA news, eSafety newsroom, AFCA Datacube widget — low scam-specific signal.
- RBA, Comms Alliance — adjacent but not scam-specific.
- ReportCyber — confirmed no public API.

---

## 7. Implementation PR sequence

Each numbered PR is independently shippable, gated by its own flag (default off), and follows the standard `CLAUDE.md` ship workflow (typecheck → explicit-files commit → push → apply migration via `mcp__supabase__apply_migration` → `get_advisors` → preview build → squash-merge → verify prod).

### Phase A — Foundation (≤1 sprint, 3 PRs)

**PR-A1 — `feed_sources` config table (item #1, ~1 day) — SHIPPED as #224**

- Migration `supabase/migration-v127-feed-sources.sql`: `CREATE TABLE feed_sources (...)` per §2 schema. Seed rows for all 26 existing scrapers + Wave 2 sources (initially `enabled=false` for new ones).
- No code refactor yet — existing scrapers stay hardcoded. The table is read-only state for now; subsequent PRs will start querying it.
- Files touched: 1 migration.

**PR-A2 — `common/http_impersonate.py` opt-in helper (item #3, ~1 day) — SHIPPED as #225**

- `pipeline/scrapers/requirements.txt`: add `curl_cffi==0.7.x` (pin minor).
- `pipeline/scrapers/common/http_impersonate.py`: thin wrapper around `curl_cffi.requests` with default `impersonate="chrome120"`.
- One smoke test in `pipeline/scrapers/tests/test_http_impersonate.py` against `https://cyber.gov.au/`.
- No existing scraper changes — opt-in only.

**PR-A3 — Inbound-email pipeline foundation (item #2, ~3 days) — SHIPPED as #226 (+ #239/#240/#241 follow-ups)**

- `apps/cloudflare-email-worker/` (new package, separate `wrangler.toml`): receives RFC822, strips GovDelivery wrapper redirects, POSTs to Supabase Edge Function.
- `supabase/functions/intel-inbound-email/index.ts`: Zod-validates payload, attributes source by tag (`acsc+ingest@` → `source='inbound_acsc'`), inserts into `feed_items`.
- Migration `v128-inbound-email-sources.sql`: add `inbound_<source>` slugs to `feed_items_source_check` + `get_unembedded_narrative_feed_items()` allowlist.
- v129 follow-on: 5 high-signal newsletter additions (ATO, SANS, TLDR, THN, SecurityWeek) on the same channel.
- v130 follow-on (#240): backfill `feed_sources` rows for the 12 v128 inbound\_\* slugs that v128 missed.
- `ENABLE_INTEL_INBOUND_EMAIL` env var; Worker returns `204` when off.
- Operational docs: Cloudflare Email Routing setup, address-tagging conventions.

**Phase A learnings baked into Phase B (see template below):**

- Migration filenames live at `supabase/migration-vN-name.sql` (top level), not `supabase/migrations/vN-name.sql`. The plan's earlier hardcoded version numbers (v100/v101) drifted to v127/v128/v129/v130 in flight — use "next available version" instead.
- Every new slug added to `feed_items_source_check` MUST be paired with a `feed_sources` INSERT in the same migration. v128 missed this; v130 backfilled it. The skill enforces this from now on.
- Pre-deploy SQL smoke step is now mandatory — PR-A3 shipped two schema bugs found only post-deploy.
- HTML-extraction is shared via `pipeline/scrapers/common/html_extract.py` (trafilatura wrapper, PR-A3e #241) so each new HTML scraper doesn't re-roll the regex that bit the Worker (#238 `htmlToText`).
- Worker has a vitest test file as of #239 — any future change to `apps/cloudflare-email-worker/` adds a regression test there.

### Phase B — Wave 2 government sources (≤1 sprint, 6 PRs)

Each PR follows an identical template — copying `pipeline/scrapers/scamwatch_alerts.py` as the reference shape:

**Template PR shape (apply to PRs B1–B6)**

0. **Pre-deploy SQL smoke** _(new since Phase A — PR-A3 shipped two schema bugs found only post-deploy)_: paste the migration into `mcp__supabase__execute_sql` against a Supabase preview branch (or wrap in `BEGIN; ... ROLLBACK;` on prod) before `apply_migration`. Validates the constraint syntax, RPC function body, and partial-index WHERE clause in one shot.
1. **Migration** `supabase/migration-vN-news-intel-add-<source>.sql` where `vN` is the **next available version** (`git ls-tree origin/main 'supabase/migration-v*' | tail -3` to find the highest current; as of 2026-05-16 the next is `v131`):
   - Add slug to `feed_items_source_check` constraint.
   - Add slug to `get_unembedded_narrative_feed_items()` RPC IN-list.
   - Recreate `idx_feed_items_unembedded_narrative` with the slug in the WHERE clause (partial index must match).
   - **Insert a row into `feed_sources`** for the slug with `enabled=false`, `category='narrative'`, jurisdiction, source URL, and notes. Required — v128 missed this and v130 had to backfill; the skill enforces it from now on.
2. **Scraper** `pipeline/scrapers/<source>.py` — imports `bulk_upsert_narrative_feed_items`, `conditional_get`, `log_ingestion` from `common/`; schema-mirror of `scamwatch_alerts.py`.
   - **For HTML sources**: use `from common.html_extract import extract_article_body` (PR-A3e #241) for body extraction. Don't hand-roll regex tag-stripping — same class of bug as #238 in the Worker.
   - **For RSS sources**: feedparser gives clean text directly; no helper needed.
3. **Workflow** `.github/workflows/scrape-feeds.yml`: add scraper to the daily-16:00 tier (or weekly for low-volume sources).
4. **Tests** `pipeline/scrapers/tests/test_<source>.py`: parsing + idempotency. Mock external HTTP via `unittest.mock.patch`; add an opt-in live test gated on `ASKARTHUR_<SOURCE>_LIVE=1` (matches `test_http_impersonate.py` pattern).
5. **Env var** `ENABLE_<SOURCE>_INGEST` added to `turbo.json` `globalEnv` + `.env.example`.
6. **System map** `docs/system-map/background-workers.md`: append row to the scraper table.

**PR-B1a** — NASC news HTML (item #4, ~1 day). Slug: `nasc`. Daily 16:00 UTC tier. Ships in Phase B.
**PR-B1b** — NASC Fusion Cell PDF ingestion. **Deferred until PR-C3 ships** so the PDF rows have a consumer. Cross-reference: any PDF-row insert in PR-B1a / PR-B2 should be gated behind `ENABLE_REGULATOR_PDF_INGEST` to avoid stranded rows in `feed_items`.
**PR-B2** — ACMA scam alerts + quarterly Action PDF (item #5, ~1.5 days). Slugs: `acma_alerts`, `acma_quarterly`. Daily + weekly tiers. Same PDF-row gating as PR-B1b.
**PR-B3** — AUSTRAC media release RSS (item #6, ~0.5 day). Slug: `austrac`. Daily tier. **Simplest of the set — recommended vertical-slice candidate to validate the corrected Phase B template.**
**PR-B4** — OAIC NDB releases (item #7, ~1 day). Slug: `oaic_ndb`. Weekly HEAD check. PDF; same gating note.
**PR-B5** — AFP media releases (item #8, ~1 day). Slug: `afp`. Daily tier. Keyword pre-filter for scam/fraud/cyber.
**PR-B6** — Services Australia scam alerts (item #9, ~1 day). Slug: `services_australia`. Weekly tier.

### Phase C — Cross-cut machinery (≤1 sprint, 3 PRs)

**PR-C1 — Regulator-narrative theme clustering (item #10, ~2 days)**

- Refactor `reddit-intel-daily` / `reddit-intel-cluster` in `packages/scam-engine/src/inngest/functions.ts` to accept `{ source_filter: string[] }` parameter.
- Migration `supabase/migration-vN-regulator-intel-themes.sql` (next available `vN`): new table `regulator_intel_themes` mirroring `reddit_intel_themes` schema; new `feature_brakes.regulator_intel` row at A$5/day.
- New Inngest cron `regulator-intel-cluster` weekly Sunday 06:00 UTC; reads `feed_items` for last 7d × Phase B source slugs + existing ACSC/Scamwatch/ASIC.
- **Batch API** integration: submit Sonnet 4.6 classifier as batch with 24h SLA.
- **Prompt caching**: mark classifier system prompt + few-shot examples with `cache_control: {type: "ephemeral"}`.
- `FF_REGULATOR_INTEL_THEMES` gate.

**PR-C2 — Blog generator extension (item #11, ~1 day)**

- `apps/web/app/api/cron/weekly-blog/route.ts`: query `regulator_intel_themes` alongside `verified_scams` when `FF_BLOG_REGULATOR_THEMES=true`.
- Update Haiku prompt to optionally cite regulator sources.

**PR-C3 — Quarterly / annual PDF ingester (item #12, ~1 day)**

- Migration `supabase/migration-vN-regulator-report-extracts.sql` (next available `vN`): new table for Claude-extracted PDF structure.
- Event-driven Inngest function `regulator-pdf-ingest` triggered when `feed_items.source IN ('acma_quarterly', 'oaic_ndb', 'accc_targeting_scams', ...)` inserts a row with `evidence_r2_key` set.
- One-shot Sonnet call per PDF, JSON-schema validation.

### Phase D — International + supplements (≤0.5 sprint, 5 PRs)

**PR-D1** — Newsletter RSS scrapers (item #14, ~0.5 day). Risky Biz + Krebs Substack via existing scraper template.
**PR-D2** — AusCERT public RSS (item #15, ~0.5 day). Same template.
**PR-D3** — FTC Consumer Alerts ops-only (item #13, 0 days). Subscribe `ftc+ingest@intel.askarthur.au` to GovDelivery. No code.
**PR-D4** — CertStream Fly.io worker (item #16, ~3 days). New repo or subdirectory; persistent WebSocket; brand-watchlist sync via Supabase Realtime.
**PR-D5** — VirusTotal v3 enrichment Inngest (item #17, ~1 day). Event-driven from analyze pipeline.

### Phase E — Discretionary (defer until Phase A–D ship and prove value)

PR-E1–E4: items #18–21. Build only when:

- E1 (autoseed): Phase C-1 has shipped and has > 4 weeks of clustering data.
- E2 (CF Radar): brand watchlist starts to look stale.
- E3 (LinkedIn RSS): ABA/IDCARE/NASC LinkedIn-only content is provably missing from Phase B coverage.
- E4 (Passive DNS): Breach Defence Suite resumes from its 2026-04-29 pause.

---

## 8. Implementation verification (per-PR checklist)

Lifted from the standard `CLAUDE.md` ship workflow. Apply to every PR above.

1. **Local typecheck**: `pnpm turbo typecheck`.
2. **Python tests** (PRs A2, B1–B6, D1–D4): `cd pipeline/scrapers && python -m pytest tests/test_<source>.py -v`.
3. **Scraper dry-run** (PRs B1–B6, D1, D2): run scraper locally against staging Supabase, confirm `feed_items` row count + `feed_ingestion_log` entry.
4. **Migration apply** via `mcp__supabase__apply_migration` on project `rquomhcgnodxzkhokwni`. Idempotent.
5. **Advisor check**: `mcp__supabase__get_advisors` (security + performance). New ERRORs must be fixed before merge.
6. **Embedding smoke test** (PRs B1–B6): wait one `feed-items-embed` tick (≤30 min), confirm new rows have `embedding IS NOT NULL`.
7. **Vercel preview green** before squash-merge.
8. **Prod smoke** (PRs B1–B6): run scraper from main branch, watch `feed_ingestion_log` for first successful run, confirm no `scraper-brake-alert` Telegram page.
9. **Flag flip protocol**: each `ENABLE_*` flag flips from `false → true` in Vercel env after PR merges. Soak 48h. If `consecutive_failures >= 3` on the new `feed_sources` row, auto-disable.

---

## 9. Locked decisions (this session)

- **Build scope:** Full Phase A (PR-A1 `feed_sources` table + PR-A2 `curl_cffi` helper + PR-A3 inbound-email pipeline). **All three PRs shipped 2026-05-15** (#224, #225, #226).
- **Phase A tightening (2026-05-16)** — landed before Phase B opens, per plan `melodic-growing-biscuit`:
  - **PR-A3c (#239)** — Worker bug fixes #237 (extractFirstUrl trailing punct) + #238 (htmlToText drops anchor hrefs). First vitest tests in the Worker package.
  - **PR-A3d (#240)** — Migration v130 backfills `feed_sources` rows for the 12 v128 inbound\_\* slugs (v128 missed them; v129 only seeded its 5 additions).
  - **News-intel-embed stall — non-finding.** The audit caught a transient mid-tick state, not a stall. The cron is healthy on its 30-min cadence. Monitoring queries (§11.4) now use a 1h threshold so future audits don't repeat the false-positive.
  - **PR-A3e (#241)** — `pipeline/scrapers/common/html_extract.py` (trafilatura wrapper) so Phase B HTML scrapers inherit a single anchor-preserving body extractor. Same regression contract as Worker #238.
  - **PR-A3f (this PR)** — Plan + skill doc updates per the learnings above.
- **Inbound-email vendor:** Cloudflare Email Routing → Cloudflare Worker → Supabase Edge Function → direct insert into `feed_items`. Free tier across the stack.
- **Inbound-email domain:** **`askarthur-inbound.com`** (registered through Cloudflare Registrar, A$16/year). Chosen over `intel.askarthur.au` to avoid touching production DNS and to keep inbound newsletter mail cleanly separated from Resend outbound traffic on `askarthur.au`.
- **Deployed surface (PR-A3):**
  - Cloudflare Worker: `https://askarthur-intel-inbound-email.matchmoments.workers.dev` (Email Workers binding only — no public HTTP route).
  - Supabase Edge Function: `https://rquomhcgnodxzkhokwni.functions.supabase.co/intel-inbound-email` (deployed with `--no-verify-jwt`; auth via X-Webhook-Secret).
  - Kill switch `ENABLE_INTEL_INBOUND_EMAIL=true` in Supabase secrets.
- **Cost ceiling:** A$0/mo recurring confirmed (no per-email Claude). Wave-3 clustering adds ~A$2/mo when it ships.
- **Phase B vertical slice + side-find fixes (2026-05-16, second batch)** — same session as Phase A tightening:
  - **PR #243** — `crtsh.py` None-handling regression fix (issue #227). Auto-closed #227. The original ops alert hypothesised a WAF change; the actual cause was `cert.get(k, "")` failing when the upstream emitted explicit JSON nulls. Two-line code change + regression test pinned the contract.
  - **PR #244** — Reddit Intel `classifyWithRetry` helper (issue #228). Auto-closed #228. Adds bounded retry-with-feedback on Sonnet schema-mismatch, plus makes `dailySummary` optional with consumer guard. New `reddit-intel-classify-retry` cost-telemetry tag for retry-frequency monitoring.
  - **PR #245** — `docs/system-map/background-workers.md` gains a "Cloudflare Workers" section for the inbound-email Worker. Ops doc gains a "Redeploy after a code change" subsection (Worker is NOT auto-redeployed when source merges to main — Vercel auto-deploys `apps/web`, Cloudflare deploys are manual).
  - **PR #246** — `harden(auth)` of 5 protected API routes (`apps/web/app/api/family/*` + `apps/web/app/api/user/{delete-account,export-data}`). Adds `getSupabaseUserOrThrow` helper to `apps/web/lib/auth.ts` so each route doesn't inline Promise.race × 6. 503 + `Retry-After: 30` on degraded Auth (NOT 401 — that would log the user out on a transient outage).
  - **PR #247 — PR-B3 AUSTRAC RSS** — first Phase B vertical slice. Validates the corrected Phase B template encoded in PR-A3f. Migration v131 applied; advisors clean. Future Phase B scrapers (B5 AFP, B1a NASC, B6 Services AU, B2 ACMA, B4 OAIC) copy this shape.
  - **Issues #230 + #231 closed without code change.** Both alerts originated from the external "Daily Founder Briefing" Claude Code Routine that replaced legacy digests in f9c2fe1, not from repo code. Documented + closed with the find.
  - **News-intel-embed cron healthy.** Confirmed via end-to-end DB check + cost-telemetry sweep during the session zoom-out. Embed timestamp 2026-05-16 01:01:43 UTC processing 5 backlog rows. Monitoring SQL threshold corrected to 1h.
- **Phase B template confirmed via PR-B3 #247:**
  - Migration shape: extend `feed_items_source_check` + extend `get_unembedded_narrative_feed_items()` RPC + recreate `idx_feed_items_unembedded_narrative` partial index + either INSERT or UPDATE `feed_sources` row (UPDATE if pre-seeded by v127, otherwise INSERT). All four in the same migration — no v128-style omissions.
  - Scraper shape: copy `acsc_alerts.py` (RSS) or `scamwatch_alerts.py` (HTML). HTML scrapers use `from common.html_extract import extract_article_body` instead of hand-rolled bs4.
  - Workflow shape: add to `workflow_dispatch` choice list + a step under the appropriate cron tier. No per-source `ENABLE_<SOURCE>_INGEST` gate by default — circuit breaker + `feed_sources.enabled` give the operator enough control.
  - Category inference: specific patterns BEFORE generic `scam|fraud` (caught by PR-B3's `test_pig_butchering_is_investment_fraud` — `'investment scam'` matches generic `scam` first otherwise).

## 10. Outstanding questions (deferred — not blocking Phase A)

Resolve before Phase C (#10–#12) ships:

- **Scope choice**: build all four waves, or just Wave 1 + Wave 3 (infrastructure + clustering multiplier) and let new sources be added opportunistically?
- **Primary downstream surface**: should new narrative sources feed primarily into the **weekly digest email**, the **blog generator**, the **B2B intel API**, or all three? This determines whether Wave 3 ships before or in parallel with Wave 2.
- **Cost ceiling**: is A$3/day inbound-email + A$3/day intel-clustering acceptable, or does this need to land under the existing A$10/day Reddit Intel brake as a shared budget?
- **Inbound-email vendor**: ~~Cloudflare Email Routing~~ ✅ chosen + deployed.

---

## 11. Finalising PR-A3 — operational rollout

**Status at 2026-05-15 end-of-session:** code is shipped (PR #226 merged-ready), backend is deployed and verified end-to-end via curl. The Edge Function correctly rejects bad auth (401), validates payloads (422), and the kill switch is ON. **One Cloudflare routing rule is still missing**, after which a smoke email proves the full path. Then it's pure operational rollout — no more code today.

Scope confirmed: smoke test + doc fix + ops rollout. PR-A4 (sender-domain allowlist + volume telemetry) is deferred until subscriptions go live and we have a baseline volume to alert against.

### 11.1 — Wave 1: smoke test (user action + my SQL verify)

**User does:**

1. Cloudflare → `askarthur-inbound.com` → Email → Email Routing → **Routing rules** → "Create address":
   - Custom address: `acsc`
   - Action: Send to a Worker
   - Destination: `askarthur-intel-inbound-email`
   - Save.
2. Send a test email from any account → `acsc+ingest@askarthur-inbound.com` with subject `Pipeline smoke test`.

**I run (verification — already have MCP access):**

```sql
SELECT id, source, title, substring(body_md, 1, 100) AS body, created_at
FROM public.feed_items
WHERE source = 'inbound_acsc'
ORDER BY created_at DESC
LIMIT 5;
```

**Pass criteria:** one row with the test subject as `title`. If it doesn't land, I diagnose via `pnpm wrangler tail` (Worker logs) + the Supabase Edge Function logs URL.

### 11.2 — Wave 2: doc-fix PR (PR-A3b)

Tiny doc-only PR — no code, no migrations.

**File:** `docs/ops/inbound-email-config.md`

**Changes:**

- Replace every `intel.askarthur.au` → `askarthur-inbound.com` (whole-file find/replace).
- Add a small **"Deployed state"** section at the top noting the live URLs (Edge Function + Worker), kill-switch state, secret-rotation procedure (regenerate via `openssl rand -hex 32`, then `supabase secrets set` + `wrangler secret put` to both sides).
- Add a **"Monitoring queries"** section with the volume / embedding / per-source SQL snippets from §11.4 below.
- Note that PR-A4 (sender-domain allowlist + telemetry) is the planned next-step defense-in-depth, deferred.

**Ship workflow:** branch off main, single commit, push, `gh pr create`, no migration apply needed. Vercel preview is a no-op (no app code changed).

### 11.3 — Wave 3: operational rollout (user-driven, ~30 min total)

After the smoke test passes, the rest is repetition.

#### 11.3.1 — 10 more Cloudflare routing rules

In Cloudflare → `askarthur-inbound.com` → Email Routing → Routing rules, click "Create address" once per row below. Every row uses **Action: Send to a Worker → `askarthur-intel-inbound-email`**.

| Custom address | Resulting source slug |
| -------------- | --------------------- |
| `scamwatch`    | `inbound_scamwatch`   |
| `austrac`      | `inbound_austrac`     |
| `oaic`         | `inbound_oaic`        |
| `afp`          | `inbound_afp`         |
| `acma`         | `inbound_acma`        |
| `idcare`       | `inbound_idcare`      |
| `auscert`      | `inbound_auscert`     |
| `ftc`          | `inbound_ftc`         |
| `riskybiz`     | `inbound_riskybiz`    |
| `krebs`        | `inbound_krebs`       |

(Subaddressing is ON, so each rule matches both `<tag>@` and `<tag>+anything@`.)

#### 11.3.2 — 11 newsletter subscriptions

Sign up to each using the matching tagged address. Confirmation emails will arrive in `feed_items` — click the confirm link out of `body_md`.

| Subscription                      | URL                                                                                  | Subscribe with                           |
| --------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------- |
| Scamwatch alerts                  | https://www.scamwatch.gov.au/about-us/news-and-alerts/subscribe-to-scam-alert-emails | `scamwatch+ingest@askarthur-inbound.com` |
| ACSC Alert Service                | https://www.cyber.gov.au/about-us/about-asd-acsc/alert-service                       | `acsc+ingest@askarthur-inbound.com`      |
| AUSTRAC media releases            | https://www.austrac.gov.au/subscribing-media-release-alerts                          | `austrac+ingest@askarthur-inbound.com`   |
| OAIC newsletter                   | https://www.oaic.gov.au/contact-us/subscribe                                         | `oaic+ingest@askarthur-inbound.com`      |
| AFP media releases                | https://www.afp.gov.au/news-centre/subscribe                                         | `afp+ingest@askarthur-inbound.com`       |
| ACMA scam + spam updates          | https://www.acma.gov.au/subscribe-acma-updates                                       | `acma+ingest@askarthur-inbound.com`      |
| IDCARE Insights                   | https://www.idcare.org/contact (request mailing list)                                | `idcare+ingest@askarthur-inbound.com`    |
| AusCERT (members)                 | https://www.auscert.org.au/contact-us/                                               | `auscert+ingest@askarthur-inbound.com`   |
| FTC Consumer Alerts (GovDelivery) | https://public.govdelivery.com/accounts/USFTCCONSUMER/subscriber/new                 | `ftc+ingest@askarthur-inbound.com`       |
| Risky Biz News                    | https://risky.biz/subscribe/                                                         | `riskybiz+ingest@askarthur-inbound.com`  |
| Krebs on Security                 | https://krebsonsecurity.com/ (footer email widget)                                   | `krebs+ingest@askarthur-inbound.com`     |

#### 11.3.3 — Security cleanup

- **Revoke the temporary Supabase PAT** at https://supabase.com/dashboard/account/tokens (find `AskArthur CLI deploy` → ⋮ → Revoke). The token is in chat history and only needed for today's deploy.
- Confirm `~/.askarthur-inbound-email-secret.txt` is `mode 600` (already set). Keep it — needed for future secret rotations.

### 11.4 — Monitoring queries (paste into Supabase SQL editor)

Drop these into `docs/ops/inbound-email-config.md` as part of PR-A3b.

```sql
-- A. Right after a test email — did it land?
SELECT id, source, title, substring(body_md, 1, 100) AS body, created_at
FROM public.feed_items
WHERE source LIKE 'inbound_%'
ORDER BY created_at DESC
LIMIT 10;

-- B. After ≤30 min — did Voyage embed it?
SELECT id, source, embedding IS NOT NULL AS embedded, created_at
FROM public.feed_items
WHERE source LIKE 'inbound_%'
ORDER BY created_at DESC
LIMIT 10;

-- C. Per-source volume in last 24h — sanity-check subscriptions.
SELECT source, count(*) AS items_24h, max(created_at) AS most_recent
FROM public.feed_items
WHERE source LIKE 'inbound_%'
  AND created_at >= now() - interval '24 hours'
GROUP BY source
ORDER BY items_24h DESC;

-- D. Backfill check — anything not embedded after >30 min?
-- Embed cron runs every 30 min; rows landing mid-tick wait up to ~30 min
-- before the next pass. Any inbound_* row with embedding IS NULL after
-- 30 min indicates either (a) the cron has just missed this tick, or
-- (b) a real backlog. For an alerting threshold use query E.
SELECT source, count(*) AS stale_unembedded
FROM public.feed_items
WHERE source LIKE 'inbound_%'
  AND embedding IS NULL
  AND created_at < now() - interval '30 minutes'
GROUP BY source;

-- E. Embed-cron health — alert if narrative rows >1h old still unembedded.
-- Covers the inbound channel AND every other narrative source (scamwatch,
-- ACSC, ASIC, Phase B sources). Threshold of 1h gives the 30-min cron
-- two ticks to clear a row before it's considered stuck. Replace the
-- LIKE filter with a join to feed_sources if you want to scope to enabled
-- sources only.
SELECT fi.source, count(*) AS stale_unembedded, min(fi.created_at) AS oldest
FROM public.feed_items fi
WHERE fi.embedding IS NULL
  AND fi.source IN (
    SELECT slug FROM public.feed_sources WHERE category = 'narrative'
  )
  AND fi.created_at < now() - interval '1 hour'
GROUP BY fi.source;
```

### 11.5 — Deferred (PR-A4, not shipping today)

Captured here so future me (or future Claude) knows it exists. **Don't build until needed.**

- **Worker-side sender-domain allowlist:** `TAG_SENDER_ALLOWLIST` map in `apps/cloudflare-email-worker/src/index.ts`. Per-tag regex list of allowed `from` domains. Drops mail with mismatched senders. Triggered if someone discovers a `+ingest@` tag and tries to flood it.
- **`cost_telemetry` rows from Edge Function:** insert `(feature='intel-inbound-email', provider='cloudflare', operation='email-receive', units=1, unit_cost_usd=0, estimated_cost_usd=0, metadata={source, from, subject_len})` per accepted email. Gives `cost-daily-check` cron a count-based alert (`count >= 500/day` = suspicious volume spike).
- **Estimated build: ~1.5 hours.** Build trigger: first observed abuse OR first volume-spike alert from real subscriptions.

### 11.6 — Verification

End-of-session pass criteria for "PR-A3 finished":

1. ✅ Smoke-test email shows in `feed_items WHERE source='inbound_acsc'` within ~10s of send.
2. ✅ Embedding column populates within 30 min (Voyage embed cron).
3. ✅ PR-A3b (doc-fix) merged.
4. ✅ All 11 Cloudflare routing rules created.
5. ✅ At least 3 subscriptions live, with confirmation emails captured in `feed_items`.
6. ✅ Temporary PAT revoked.

After all six, Phase A is fully shipped + operational. Phase B (Wave-2 government scrapers) is the next session.
