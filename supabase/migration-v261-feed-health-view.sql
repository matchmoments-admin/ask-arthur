-- migration-v261-feed-health-view.sql
--
-- Makes health-digest capable of SEEING a dead feed. Three defects, measured
-- 2026-07-30, all of which let it print "all clear" while three non-muted feeds
-- were 31-86 days dead:
--
--   1. It read `.limit(500)` from feed_ingestion_log. Those newest 500 rows span
--      6.7 days and contain 15 of 20 feeds — and the 5 absent were exactly the
--      dead ones. A feed that stops writing entirely drops out of any query that
--      groups by what is present, so THE HARDER A FEED FAILS THE MORE CERTAINLY
--      IT IS INVISIBLE.
--   2. Staleness came from MAX(created_at) of ANY status. The latched backoff
--      writes a fresh 'partial:backoff_active' row every ~1.8h, so acsc read as
--      permanently 1.8h fresh while having ZERO successes in 1,167 runs.
--   3. KNOWN_DORMANT_FEEDS, a hardcoded Set commented "dormant by choice",
--      muted 12 feeds of which 7 were actively producing — including 5 of the
--      platform's top 6 by volume (ipsum 210,643 rows/30d, phishing_army 33,374,
--      openphish 14,488, abuseipdb 6,146, phishtank 5,796). Effective coverage
--      was 4 live feeds.
--
-- THE THREE ALARMS THIS ENABLES. The old code had one notion of "stale", which
-- conflated three genuinely different failures:
--
--   never_succeeds   runs, never once status='success'      → acsc, phishstats
--   silent_success   succeeds, records_new always 0         → phishing_database,
--                                                             crtsh, feodo
--   absent           enabled in the roster, no rows at all  → acnc_register,
--                                                             pfra_members
--
-- The third is only detectable by starting from an explicit roster and LEFT
-- JOINing the log, which is what feed_health does.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Two columns that replace the hardcoded suppression list with data
-- ---------------------------------------------------------------------------

-- Productivity expectation. If a feed has produced no NEW rows in this many
-- days it is reported as silent_success. NULL = do not check productivity,
-- which is correct for feeds whose upstream is legitimately static (feodo's
-- list is 5 entries) or which are retained purely as a staleness keep-alive
-- (crtsh — see the scrape-feeds.yml comment).
ALTER TABLE public.feed_sources
  ADD COLUMN IF NOT EXISTS expect_new_rows_days integer;

-- A DATED mute. This is the honest replacement for KNOWN_DORMANT_FEEDS: that
-- Set had no expiry and no visibility, so it silently hid 7 live feeds for
-- months. A mute that expires cannot rot unnoticed, and the digest reports the
-- muted count in its footer so a muted feed is never fully invisible.
ALTER TABLE public.feed_sources
  ADD COLUMN IF NOT EXISTS muted_until timestamptz;

ALTER TABLE public.feed_sources
  ADD COLUMN IF NOT EXISTS muted_reason text;

COMMENT ON COLUMN public.feed_sources.expect_new_rows_days IS
  'Flag silent_success if no new rows in this many days. NULL = skip the productivity check (legitimately static upstream, or a keep-alive).';
COMMENT ON COLUMN public.feed_sources.muted_until IS
  'Dated alarm mute. NULL = not muted. Deliberately has an expiry — the hardcoded Set this replaces hid 7 actively-producing feeds indefinitely.';

-- ---------------------------------------------------------------------------
-- 2. Correct the roster so it describes what actually runs
-- ---------------------------------------------------------------------------
-- feed_sources was a static registry: last_success_at is NULL and
-- consecutive_failures is 0 on all 68 rows, i.e. it has never had a writer. It
-- is therefore usable as the ROSTER but not as a freshness source, and several
-- of its descriptive values had drifted from the workflow.

-- Retired on the schedule by PR #879, each with measured evidence. Kept
-- dispatchable via `gh workflow run scrape-feeds.yml -f feed=<slug>`.
UPDATE public.feed_sources SET enabled = false,
  muted_reason = 'Upstream returns HTTP 200 with a 1-byte body (probed 2026-07-30). 244 runs, all success, records_fetched=0 on every one. Sole source for 0 active rows.'
 WHERE slug = 'phishing_database';

UPDATE public.feed_sources SET enabled = false,
  muted_reason = 'cyber.gov.au blocks GitHub Actions egress at the edge (proven 2026-05-11). 15/15 runs failed with a 60s read timeout. Manual-only since PR #879.'
 WHERE slug = 'cert_au_vuln';

UPDATE public.feed_sources SET enabled = false,
  muted_reason = 'Orphan module: pipeline/scrapers/cert_au.py scrape() is invoked by NO workflow, and feed_ingestion_log has 0 rows for its feed names across its full history.'
 WHERE slug = 'cert_au';

UPDATE public.feed_sources SET enabled = false,
  muted_reason = 'AUSTRAC sits behind Akamai, which drops GitHub Actions datacenter IPs regardless of User-Agent. De-scheduled 2026-06-29; manual-only.'
 WHERE slug = 'austrac';

-- acsc: kept in the roster but muted with an EXPIRY rather than hidden. The
-- direct scraper has never succeeded (0 successes in 1,167 runs) because of the
-- same cyber.gov.au egress block, and it was additionally latched in backoff
-- (fixed in PR #880). The mute expires so that once `-f feed=probe_acsc` settles
-- reachability, the feed re-enters alarms instead of staying quietly dead. ACSC
-- content does still reach the platform via the inbound-email pipeline as
-- `inbound_acsc`.
UPDATE public.feed_sources SET
  enabled = true,
  muted_until = now() + interval '30 days',
  muted_reason = 'Direct scraper blocked at cyber.gov.au edge; 0 successes in 1,167 runs. Backoff latch fixed in #880 — run `gh workflow run scrape-feeds.yml -f feed=probe_acsc` to settle reachability before this mute expires. ACSC content still arrives as inbound_acsc.'
 WHERE slug = 'acsc';

-- Cadence corrections — these were describing a schedule the workflow does not
-- have, which is the same docs-vs-reality class this whole audit is about.
UPDATE public.feed_sources SET poll_schedule = 'daily 16:00 UTC' WHERE slug IN ('crtsh','feodo','spamhaus');
UPDATE public.feed_sources SET poll_schedule = 'every 6h'         WHERE slug = 'reddit';
UPDATE public.feed_sources SET poll_schedule = 'every 12h'        WHERE slug IN ('phishstats','phishing_army');

-- Productivity expectations. Generous, because a false silent_success alarm is
-- worse than a slow one: these are the feeds where 0 new rows genuinely means
-- something is wrong.
UPDATE public.feed_sources SET expect_new_rows_days = 3  WHERE slug IN ('urlhaus','openphish','phishtank','phishing_army','ipsum','abuseipdb','reddit');
UPDATE public.feed_sources SET expect_new_rows_days = 30 WHERE slug IN ('scamwatch_alert','asic_investor','acnc_register','pfra_members');
UPDATE public.feed_sources SET expect_new_rows_days = 14 WHERE slug = 'spamhaus';
-- NULL (no productivity check) is deliberate for these:
--   crtsh  — retained purely as a staleness keep-alive; produces nothing by design
--   feodo  — upstream list is a static 5 entries, 0 new in 82 days is correct
--   phishstats — currently never succeeds; the never_succeeds alarm covers it
UPDATE public.feed_sources SET expect_new_rows_days = NULL WHERE slug IN ('crtsh','feodo','phishstats');

-- ---------------------------------------------------------------------------
-- 3. feed_health — one row per ENABLED feed, present or not
-- ---------------------------------------------------------------------------
-- The LEFT JOIN is the load-bearing part: a feed with no log rows at all still
-- gets a row here, with NULL timestamps, so "absent" becomes detectable instead
-- of silently dropping out of the result set.
--
-- Unions both log tables because the vulnerability scrapers write to
-- vulnerability_ingestion_log while sharing the same roster. Without the union,
-- cisa_kev/osv_feed/nvd_recent/github_advisory would all read as absent.
CREATE OR REPLACE VIEW public.feed_health AS
WITH logs AS (
  SELECT feed_name, status, records_new, created_at AS at
    FROM public.feed_ingestion_log
   WHERE created_at > now() - interval '90 days'
  UNION ALL
  SELECT feed_name, status, records_new, run_at AS at
    FROM public.vulnerability_ingestion_log
   WHERE run_at > now() - interval '90 days'
),
agg AS (
  SELECT feed_name,
         max(at)                                                              AS last_run_at,
         max(at) FILTER (WHERE status = 'success')                             AS last_success_at,
         max(at) FILTER (WHERE status = 'success'
                           AND coalesce(records_new, 0) > 0)                   AS last_useful_at,
         count(*)                                                             AS runs_90d,
         count(*) FILTER (WHERE status = 'success')                            AS successes_90d,
         count(*) FILTER (WHERE at > now() - interval '7 days')                AS runs_7d,
         coalesce(sum(records_new) FILTER (WHERE at > now() - interval '7 days'), 0) AS new_rows_7d
    FROM logs
   GROUP BY feed_name
)
SELECT s.slug                       AS feed_name,
       s.poll_schedule,
       s.expect_new_rows_days,
       s.muted_until,
       s.muted_reason,
       (s.muted_until IS NOT NULL AND s.muted_until > now()) AS is_muted,
       a.last_run_at,
       a.last_success_at,
       a.last_useful_at,
       coalesce(a.runs_90d, 0)      AS runs_90d,
       coalesce(a.successes_90d, 0) AS successes_90d,
       coalesce(a.runs_7d, 0)       AS runs_7d,
       coalesce(a.new_rows_7d, 0)   AS new_rows_7d,
       -- Hours since the last SUCCESS, not since the last row of any status.
       -- NULL when the feed has never succeeded — the caller must treat NULL as
       -- infinitely stale, not as "no data so probably fine".
       CASE WHEN a.last_success_at IS NULL THEN NULL
            ELSE extract(epoch FROM (now() - a.last_success_at)) / 3600 END AS hours_since_success,
       CASE WHEN a.last_useful_at IS NULL THEN NULL
            ELSE extract(epoch FROM (now() - a.last_useful_at)) / 86400 END AS days_since_useful
  FROM public.feed_sources s
  LEFT JOIN agg a ON a.feed_name = s.slug
 WHERE s.enabled;

COMMENT ON VIEW public.feed_health IS
  'One row per ENABLED feed whether or not it has logged anything — the LEFT JOIN is what makes an absent feed detectable. NULL last_success_at means never succeeded and must be read as infinitely stale. See migration-v261.';

REVOKE ALL ON public.feed_health FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.feed_health TO service_role;
