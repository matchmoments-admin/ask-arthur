-- migration-v262-staleness-exempt-feeds.sql
--
-- Lets a feed be retired without silently deleting its findings from the
-- blocklist, which is what blocked retiring crt.sh in PR #879.
--
-- THE PROBLEM. mark_stale_urls (migration-v11, run daily 03:00 UTC by
-- pipeline-staleness-check) sets is_active=FALSE on any scam_urls row whose
-- last_seen_in_feed is older than 7 days, exempting only
-- unique_reporter_count >= 3 or confidence_level IN ('high','confirmed').
-- That is correct for feeds which list CURRENTLY-LIVE threats — urlhaus,
-- openphish, phishtank — where "not in the feed any more" genuinely means
-- "probably not a live threat any more".
--
-- It is wrong for a feed whose signal is a HISTORICAL FACT. crt.sh reports that
-- a certificate resembling an AU brand was issued. That does not stop being
-- true, and there is no upstream that will keep re-asserting it. So the crtsh
-- scraper's only remaining function was to re-touch last_seen_in_feed daily to
-- stop the sweep eating its own findings — 284 step-minutes per 29 days
-- (~US$1.77/mo) buying a keep-alive, and 0 new rows since 2026-06-05.
--
-- Measured 2026-07-30, the cost of just retiring it:
--   4,970 crtsh URLs, 1,726 active, 0 in any other feed, 0 sweep-exempt
--   → 1,726 would go is_active=FALSE within 7 days
-- and is_active=TRUE gates /api/scam-urls/lookup, /api/v1/threats/domains and
-- /api/v1/threats/urls/trending, so those would have silently vanished from what
-- the extension and B2B API read. They are AU brand lookalikes (mygov,
-- centrelink, ato.gov, medicare, auspost, commbank, nab, anz, westpac, telstra,
-- nbn, optus, woolworths, coles), i.e. the product's core signal.
--
-- THE TRADE-OFF, STATED PLAINLY. Exempting these rows means they stay active
-- with no further re-validation: nothing re-checks whether the domain still
-- resolves or is still a lookalike. That is a deliberate choice of "keep a weak
-- historical signal" over "silently drop 1,726 brand-impersonation domains",
-- and it is only defensible because the signal is cheap to act on (a warning,
-- not a block) and the alternative loses coverage invisibly. The better long-term
-- answer is periodic liveness re-validation of exempt rows, which is a new
-- worker, not a predicate — tracked in
-- docs/plans/ops-audit-gha-inngest-2026-07-30.md.
--
-- NOT DONE HERE: the 3,244 crtsh URLs the sweep has ALREADY deactivated stay
-- deactivated. Reactivating them would re-flag 3,244 domains in one step on the
-- basis of a certificate seen months ago, which is a product decision and not
-- something a migration should take.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Declare which feeds carry a historical signal
-- ---------------------------------------------------------------------------
ALTER TABLE public.feed_sources
  ADD COLUMN IF NOT EXISTS staleness_exempt boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.feed_sources.staleness_exempt IS
  'TRUE when this feed reports a historical fact (e.g. a certificate was issued) rather than a currently-live threat, so its findings must not expire on the 7-day feed-freshness clock. Only exempts rows for which this feed is the SOLE source. See migration-v262.';

-- crt.sh only. Do not add a feed here to silence a staleness alarm — the alarm
-- is the point. This is exclusively for feeds whose signal cannot go stale by
-- nature, and the exemption is what allows the scraper itself to be retired.
UPDATE public.feed_sources
   SET staleness_exempt = true
 WHERE slug = 'crtsh';

-- ---------------------------------------------------------------------------
-- 2. Teach mark_stale_urls about the exemption
-- ---------------------------------------------------------------------------
-- Recreated rather than edited (v11 is immutable). Two changes beyond the
-- exemption, both bringing it up to current convention:
--   * SET search_path = '' with fully-qualified names, per the SECURITY DEFINER
--     rule in supabase/CLAUDE.md — v11 predates it.
--   * a finite statement_timeout, per the 2026-05-09 incident rule.
--
-- The exemption uses `<@` (contained-by): a row is exempt only when EVERY entry
-- in its feed_sources is an exempt feed. A URL seen in both crtsh and urlhaus is
-- therefore NOT exempt — urlhaus keeps it fresh on its own, and if urlhaus drops
-- it, it should expire normally.
CREATE OR REPLACE FUNCTION public.mark_stale_urls(p_stale_days INT DEFAULT 7)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count  INT;
  v_exempt TEXT[];
BEGIN
  SET LOCAL statement_timeout = '300s';

  SELECT coalesce(array_agg(slug), ARRAY[]::text[])
    INTO v_exempt
    FROM public.feed_sources
   WHERE staleness_exempt;

  UPDATE public.scam_urls
     SET is_active = FALSE,
         staleness_checked_at = now()
   WHERE is_active = TRUE
     AND last_seen_in_feed IS NOT NULL
     AND last_seen_in_feed < now() - (p_stale_days || ' days')::INTERVAL
     -- Preserve community-validated URLs (3+ unique reporters)
     AND unique_reporter_count < 3
     -- Preserve high-confidence URLs from Claude analysis
     AND confidence_level NOT IN ('high', 'confirmed')
     -- Preserve historical-signal findings whose ONLY source is an exempt feed.
     -- `<@` on an empty v_exempt matches only empty arrays, so with no exempt
     -- feeds configured this clause is a no-op and behaviour is unchanged.
     AND NOT (feed_sources <@ v_exempt);

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN json_build_object(
    'deactivated_count', v_count,
    'stale_days', p_stale_days,
    'exempt_feeds', v_exempt
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_stale_urls(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_stale_urls(INT) TO service_role;
