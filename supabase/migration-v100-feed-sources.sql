-- v100 — feed_sources config table.
--
-- Why: scraper inventory has grown to 26 active + several disabled/new
-- entries. Slugs, URLs, and on/off state live in Python constants today,
-- so flipping a source requires a redeploy. This table moves that config
-- into the DB so:
--   * /api/cron/scraper-brake-alert can list sources to monitor
--   * `consecutive_failures >= 3` can auto-disable a flaky source
--   * adding a Wave 2 source (NASC, ACMA, AUSTRAC, OAIC, AFP, …) becomes
--     an INSERT plus a scraper file rather than a code change in N places
--
-- Scope of this migration:
--   * CREATE TABLE feed_sources (idempotent)
--   * RLS service_role only (mirrors feed_http_cache)
--   * Seed every currently-known source. New (not-yet-built) Wave 2 / Wave
--     4 sources are seeded enabled=false so they appear in the registry
--     but don't run until their scraper PR ships.
--
-- Out of scope: no scraper code changes. Existing scrapers keep their
-- hardcoded FEED_NAME constants until a follow-up PR refactors them to
-- look up runtime config from this table.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, INSERT ... ON CONFLICT DO NOTHING.

-- ── 1. Table ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.feed_sources (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                  TEXT UNIQUE NOT NULL,
  name                  TEXT NOT NULL,
  url                   TEXT,
  source_type           TEXT NOT NULL,
  category              TEXT NOT NULL,
  jurisdiction          TEXT NOT NULL DEFAULT 'AU',
  enabled               BOOLEAN NOT NULL DEFAULT false,
  poll_schedule         TEXT,
  last_fetched_at       TIMESTAMPTZ,
  last_success_at       TIMESTAMPTZ,
  consecutive_failures  INT NOT NULL DEFAULT 0,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.feed_sources DROP CONSTRAINT IF EXISTS feed_sources_source_type_check;
ALTER TABLE public.feed_sources ADD CONSTRAINT feed_sources_source_type_check
  CHECK (source_type = ANY (ARRAY[
    'rss',        -- RSS / Atom feed
    'html',       -- HTML scrape (Drupal listing, etc.)
    'csv',        -- CSV/TSV download (URLhaus, OpenPhish text feed)
    'json',       -- JSON API / file download
    'pdf',        -- one-off PDF ingestion (NDB reports, ACCC Targeting Scams)
    'email',      -- inbound email (Cloudflare Email Routing → Worker)
    'api',        -- structured 3rd-party API (HIBP, VirusTotal, CKAN)
    'ws',         -- WebSocket stream (CertStream)
    'mixed'       -- multi-channel scraper (e.g. cert_au narrative + vuln)
  ]));

ALTER TABLE public.feed_sources DROP CONSTRAINT IF EXISTS feed_sources_category_check;
ALTER TABLE public.feed_sources ADD CONSTRAINT feed_sources_category_check
  CHECK (category = ANY (ARRAY[
    'narrative',      -- writes to feed_items with body text + tags
    'ioc',            -- writes to scam_entities / vulnerability_iocs
    'vulnerability',  -- writes to vulnerabilities (CVE-style)
    'reference',      -- writes to acnc_charities / pfra_members / similar
    'derived'         -- not a scraper; computed from other sources
  ]));

COMMENT ON TABLE public.feed_sources IS
  'Inventory of every ingestion source the platform polls. Source of truth for slugs, URLs, on/off state, and failure-count auto-disable. ETag/Last-Modified live in feed_http_cache keyed by (source, url) — not duplicated here.';

COMMENT ON COLUMN public.feed_sources.slug IS
  'Stable identifier matching pipeline/scrapers/<slug>.py FEED_NAME or pipeline/scrapers/vulnerabilities/<slug>.py.';
COMMENT ON COLUMN public.feed_sources.poll_schedule IS
  'Human-readable schedule (cron string, "on-demand", "streaming", "weekly Sun 06:00 UTC"). Informational — the actual cron lives in .github/workflows/scrape-feeds.yml or apps/web/vercel.json.';
COMMENT ON COLUMN public.feed_sources.consecutive_failures IS
  'Increments on each scraper failure, resets to 0 on success. /api/cron/scraper-brake-alert pages on >=3.';

-- Index for the auto-disable health check.
CREATE INDEX IF NOT EXISTS idx_feed_sources_enabled_failures
  ON public.feed_sources (enabled, consecutive_failures DESC)
  WHERE enabled = true;

-- ── 2. RLS — service_role only ────────────────────────────────────────────

ALTER TABLE public.feed_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS feed_sources_service ON public.feed_sources;
CREATE POLICY feed_sources_service ON public.feed_sources
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 3. Seeds ──────────────────────────────────────────────────────────────
--
-- Seeded in slug groups. ON CONFLICT DO NOTHING so re-applying the migration
-- never overwrites operator-edited rows (enabled flips, notes, etc.).

INSERT INTO public.feed_sources (slug, name, url, source_type, category, jurisdiction, enabled, poll_schedule, notes) VALUES
  -- ── Active narrative scrapers (write to feed_items) ────────────────────
  ('scamwatch_alert', 'Scamwatch alerts',                  'https://www.scamwatch.gov.au/about-us/news-and-alerts/browse-news-and-alerts', 'html',  'narrative', 'AU', true, 'every 3h',        'pipeline/scrapers/scamwatch_alerts.py'),
  ('acsc',            'ACSC alerts + advisories',          'https://www.cyber.gov.au/rss/alerts',                                          'rss',   'narrative', 'AU', true, 'every 3h',        'pipeline/scrapers/acsc_alerts.py — WAF fallback to UA-impersonate'),
  ('asic_investor',   'ASIC Moneysmart investor alerts',   'https://moneysmart.gov.au/investor-alert-list',                                'json',  'narrative', 'AU', true, 'daily 16:00 UTC', 'pipeline/scrapers/asic_investor_alerts.py'),
  ('reddit',          'Reddit r/Scams narratives',         'https://www.reddit.com/r/Scams/.json',                                         'json',  'narrative', 'AU', true, 'daily 06:00 UTC', 'pipeline/scrapers/reddit_scams.py — Reddit Intel pipeline consumer'),
  ('cert_au',         'CERT-AU advisories (narrative)',    'https://www.cyber.gov.au/about-us/view-all-content/advisories/rss.xml',        'rss',   'narrative', 'AU', true, 'weekly Sun 04:00','pipeline/scrapers/cert_au.py — narrative variant'),

  -- ── Active reference scrapers ──────────────────────────────────────────
  ('acnc_register',   'ACNC charity register',             'https://data.gov.au/data/api/3/action/datastore_search',                       'api',   'reference', 'AU', true, 'daily 16:00 UTC', 'pipeline/scrapers/acnc_register.py — chunked-retryable pattern reference'),
  ('pfra_members',    'PFRA accredited fundraiser list',   'https://www.pfra.org.au/find-a-member',                                        'html',  'reference', 'AU', true, 'daily 16:00 UTC', 'pipeline/scrapers/pfra_members.py — gated ENABLE_CHARITY_CHECK_INGEST'),

  -- ── Active IOC scrapers ────────────────────────────────────────────────
  ('urlhaus',         'abuse.ch URLhaus',                  'https://urlhaus.abuse.ch/downloads/csv_recent/',                               'csv',   'ioc', 'INT', true, 'tiered 6h/12h/daily', 'pipeline/scrapers/urlhaus.py'),
  ('openphish',       'OpenPhish community feed',          'https://openphish.com/feed.txt',                                               'csv',   'ioc', 'INT', true, 'tiered 6h/12h/daily', 'pipeline/scrapers/openphish.py'),
  ('phishtank',       'PhishTank',                         'https://data.phishtank.com/data/online-valid.csv',                             'csv',   'ioc', 'INT', true, 'tiered 6h/12h/daily', 'pipeline/scrapers/phishtank.py'),
  ('phishstats',      'PhishStats',                        'https://phishstats.info/phish_score.csv',                                      'csv',   'ioc', 'INT', true, 'tiered 12h/daily',    'pipeline/scrapers/phishstats.py'),
  ('phishing_database','Phishing Database mirror',         'https://raw.githubusercontent.com/mitchellkrogza/Phishing.Database/master/phishing-links-ACTIVE.txt', 'csv', 'ioc', 'INT', true, 'tiered 12h/daily', 'pipeline/scrapers/phishing_database.py'),
  ('phishing_army',   'Phishing Army',                     'https://phishing.army/download/phishing_army_blocklist_extended.txt',          'csv',   'ioc', 'INT', true, 'tiered 12h/daily',    'pipeline/scrapers/phishing_army.py'),
  ('feodo',           'Feodo Tracker (C2 IPs)',            'https://feodotracker.abuse.ch/downloads/ipblocklist.csv',                      'csv',   'ioc', 'INT', true, 'tiered 12h/daily',    'pipeline/scrapers/feodo.py'),
  ('spamhaus',        'Spamhaus DROP/EDROP',               'https://www.spamhaus.org/drop/drop.txt',                                       'csv',   'ioc', 'INT', true, 'tiered 12h/daily',    'pipeline/scrapers/spamhaus.py'),
  ('ipsum',           'IPSUM proxy/abuse list',            'https://raw.githubusercontent.com/stamparm/ipsum/master/ipsum.txt',            'csv',   'ioc', 'INT', true, 'daily 16:00 UTC',     'pipeline/scrapers/ipsum.py'),
  ('abuseipdb',       'AbuseIPDB reputation',              'https://api.abuseipdb.com/api/v2/blacklist',                                   'api',   'ioc', 'INT', true, 'daily 16:00 UTC',     'pipeline/scrapers/abuseipdb.py'),
  ('crtsh',           'crt.sh CT logs (AU brand watch)',   'https://crt.sh/',                                                              'api',   'ioc', 'AU',  true, 'every 12h',           'pipeline/scrapers/crtsh.py — brand-impersonation detection'),

  -- ── Active vulnerability scrapers ──────────────────────────────────────
  ('cisa_kev',        'CISA Known Exploited Vulnerabilities','https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json', 'json', 'vulnerability', 'INT', true, 'weekly Sun 04:00', 'pipeline/scrapers/vulnerabilities/cisa_kev.py'),
  ('nvd_recent',      'NVD (7-day delta)',                 'https://services.nvd.nist.gov/rest/json/cves/2.0',                             'api',   'vulnerability', 'INT', true, 'weekly Sun 04:00', 'pipeline/scrapers/vulnerabilities/nvd_recent.py'),
  ('github_advisory', 'GitHub Security Advisories',        'https://api.github.com/graphql',                                               'api',   'vulnerability', 'INT', true, 'weekly Sun 04:00', 'pipeline/scrapers/vulnerabilities/github_advisory.py — gated GHSA_PAT'),
  ('osv_feed',        'OSV.dev (npm + pypi)',              'https://osv-vulnerabilities.storage.googleapis.com/',                          'json',  'vulnerability', 'INT', true, 'weekly Sun 04:00', 'pipeline/scrapers/vulnerabilities/osv_feed.py'),
  ('cert_au_vuln',    'CERT-AU CVE advisories',            'https://www.cyber.gov.au/about-us/view-all-content/advisories/rss.xml',        'rss',   'vulnerability', 'AU',  true, 'weekly Sun 04:00', 'pipeline/scrapers/cert_au.py — vuln variant'),

  -- ── Disabled scrapers (kept in registry for ops visibility) ────────────
  ('threatfox',       'abuse.ch ThreatFox',                'https://threatfox-api.abuse.ch/api/v1/',                                       'api',   'ioc', 'INT', false, 'disabled', 'Disabled 2026-05-11: auth-key 401 for 80+ days; coverage overlaps urlhaus/phishtank'),
  ('cryptoscamdb',    'CryptoScamDB',                      'https://github.com/CryptoScamDB/blacklist',                                    'json',  'ioc', 'INT', false, 'disabled', 'Disabled 2026-05-11: upstream repo archived'),

  -- ── Wave 2 new AU government sources (default-off until scraper ships) ──
  ('nasc',                 'National Anti-Scam Centre news + Fusion Cell',   'https://www.nasc.gov.au/news',                                               'html', 'narrative', 'AU', false, 'daily 16:00 UTC', 'PR-B1 — Fusion Cell PDFs (job/investment/romance) are highest-signal'),
  ('acma_alerts',          'ACMA scam alerts',                                'https://www.acma.gov.au/scam-alerts',                                        'html', 'narrative', 'AU', false, 'daily 16:00 UTC', 'PR-B2 — dedupe-critical against scamwatch_alert'),
  ('acma_quarterly',       'ACMA Action on Scams quarterly PDF',              'https://www.acma.gov.au/publications/',                                      'pdf',  'narrative', 'AU', false, 'weekly HEAD',     'PR-B2 — telco-blocking stats'),
  ('austrac',              'AUSTRAC media releases',                          'https://www.austrac.gov.au/news-and-media/media-releases',                   'rss',  'narrative', 'AU', false, 'daily 16:00 UTC', 'PR-B3 — money-mule, payments-fraud typologies'),
  ('oaic_ndb',             'OAIC Notifiable Data Breaches report',            'https://www.oaic.gov.au/privacy/notifiable-data-breaches/notifiable-data-breaches-publications', 'pdf', 'narrative', 'AU', false, 'weekly HEAD', 'PR-B4 — coordinate with Breach Defence Suite (paused)'),
  ('afp',                  'AFP media releases (cyber/fraud-filtered)',       'https://www.afp.gov.au/news-centre/news',                                    'rss',  'narrative', 'AU', false, 'daily 16:00 UTC', 'PR-B5 — keyword pre-filter scam|fraud|cyber|phishing'),
  ('services_australia',   'Services Australia scam alerts',                  'https://www.servicesaustralia.gov.au/scams',                                 'html', 'narrative', 'AU', false, 'weekly',          'PR-B6 — myGov/Centrelink/Medicare impersonation source-of-truth'),

  -- ── Wave 4 new international + supplementary sources ───────────────────
  ('auscert_public',       'AusCERT public RSS',                              'https://www.auscert.org.au/rss/bulletins/',                                  'rss',  'narrative', 'AU', false, 'daily 16:00 UTC', 'PR-D2 — body content members-only'),
  ('risky_biz',            'Risky Biz News (Substack)',                       'https://risky.biz/feeds/risky-business-news/',                               'rss',  'narrative', 'INT', false, 'daily 16:00 UTC', 'PR-D1 — Sydney-based commentary'),
  ('krebs',                'Krebs on Security',                               'https://krebsonsecurity.com/feed/',                                          'rss',  'narrative', 'INT', false, 'daily 16:00 UTC', 'PR-D1 — international scam commentary'),
  ('cf_radar_top_au',      'Cloudflare Radar Top Domains AU',                 'https://api.cloudflare.com/client/v4/radar/datasets/top',                    'api',  'reference', 'AU', false, 'weekly',          'PR-E2 — brand-watchlist auto-update source'),
  ('vt_enrichment',        'VirusTotal v3 enrichment',                        'https://www.virustotal.com/api/v3/',                                         'api',  'derived',   'INT', false, 'on-demand',       'PR-D5 — event-driven from analyze pipeline'),
  ('certstream',           'CertStream live CT WebSocket',                    'wss://certstream.calidog.io/',                                               'ws',   'ioc',       'INT', false, 'streaming',       'PR-D4 — Fly.io persistent worker; brand-watchlist alerts'),

  -- ── Inbound-email channel (used by PR-A3) ──────────────────────────────
  ('inbound_email',        'Inbound email ingestion (multi-source)',          NULL,                                                                         'email','narrative', 'INT', false, 'event-driven',    'PR-A3 — Cloudflare Email Routing → Worker → Supabase Edge Function. Tag attribution: acsc+ingest@, scamwatch+ingest@, etc.')
ON CONFLICT (slug) DO NOTHING;

-- ── 4. updated_at trigger ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.feed_sources_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS feed_sources_updated_at ON public.feed_sources;
CREATE TRIGGER feed_sources_updated_at
  BEFORE UPDATE ON public.feed_sources
  FOR EACH ROW
  EXECUTE FUNCTION public.feed_sources_set_updated_at();
