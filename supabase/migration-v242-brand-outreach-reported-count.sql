-- migration-v242-brand-outreach-reported-count.sql
--
-- Adds `reported_count_30d` to get_brand_outreach_worklist() (v241): the count
-- of a brand's lookalike domains we've submitted to a takedown vendor (Netcraft
-- submit OR a filed re-review issue) in the last 30 days.
--
-- WHY: the pilot-outreach email now leads with a live sample of "clones we've
-- reported for {brand} in the last 30 days". The composer uses this count to
-- warn when a brand's data story is too thin to pitch on (< 3) — so the founder
-- never sends a data-backed pitch that has almost no data behind it.
--
-- The RETURNS TABLE signature changes (a new column), so the function must be
-- DROPped and recreated — CREATE OR REPLACE cannot change the output columns.
-- Everything else (candidate set, ranking, contact resolution, RLS/grants) is
-- carried over from v241 verbatim.
--
-- Idempotent (DROP ... IF EXISTS + CREATE). Reverse: re-apply v241 to restore
-- the prior signature.

DROP FUNCTION IF EXISTS public.get_brand_outreach_worklist();
CREATE OR REPLACE FUNCTION public.get_brand_outreach_worklist()
RETURNS TABLE (
  brand_key             text,
  brand_name            text,
  weaponised_count      integer,
  live_unactioned_count integer,
  total_clones          integer,
  reported_count_30d    integer,
  in_campaign           boolean,
  campaign_domain_count integer,
  latest_weaponised_at  timestamptz,
  has_contact           boolean,
  contact_recipient     text,
  contact_channel       text,
  contacted_recently    boolean,
  last_contacted_at     timestamptz,
  likely_enterprise     boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH campaign_sizes AS (
    SELECT sca.campaign_key, count(*)::int AS domain_count
    FROM public.shopfront_clone_alerts sca
    WHERE sca.campaign_key IS NOT NULL
      AND sca.campaign_key <> 'insufficient'
    GROUP BY sca.campaign_key
  ),
  per_brand AS (
    SELECT
      lower(sca.inferred_target_domain) AS brand_domain,
      count(*)::int AS total_clones,
      count(*) FILTER (WHERE sca.lifecycle_state = 'weaponised')::int
        AS weaponised_count,
      count(*) FILTER (WHERE sca.lifecycle_state IN ('detected', 'declined'))::int
        AS live_unactioned_count,
      -- Lookalikes reported to a takedown vendor in the last 30 days: a Netcraft
      -- submission (submitted_to.netcraft) OR a filed re-review issue
      -- (submitted_to.netcraft_issue). jsonb_exists (not the `?` operator) so it
      -- resolves cleanly under the empty search_path and in prepared statements.
      count(*) FILTER (
        WHERE sca.first_seen_at > now() - interval '30 days'
          AND (
            jsonb_exists(sca.submitted_to, 'netcraft')
            OR jsonb_exists(sca.submitted_to, 'netcraft_issue')
          )
      )::int AS reported_count_30d,
      bool_or(sca.campaign_key IS NOT NULL AND sca.campaign_key <> 'insufficient')
        AS in_campaign,
      max(sca.weaponised_at) AS latest_weaponised_at,
      max(sca.target_brand_normalized) AS brand_normalized,
      max(cs.domain_count) AS campaign_domain_count
    FROM public.shopfront_clone_alerts sca
    LEFT JOIN campaign_sizes cs ON cs.campaign_key = sca.campaign_key
    WHERE sca.inferred_target_domain IS NOT NULL
    GROUP BY lower(sca.inferred_target_domain)
  ),
  contacts AS (
    SELECT
      lower(bcd.legitimate_domain) AS brand_domain,
      bcd.recipient AS recipient,
      bcd.channel_type AS channel,
      CASE bcd.channel_type WHEN 'security_txt' THEN 1 ELSE 2 END AS priority
    FROM public.brand_contact_directory bcd
    WHERE bcd.recipient IS NOT NULL
      AND position('@' in bcd.recipient) > 0
      AND bcd.channel_type IN ('security_txt', 'fraud_inbox')
      AND split_part(lower(bcd.recipient), '@', 1) NOT IN (
        'info', 'hello', 'contact', 'support', 'sales', 'marketing',
        'enquiries', 'admin', 'noreply', 'no-reply', 'help', 'service')
    UNION ALL
    SELECT
      lower(kb.brand_domain), kb.security_contact_email, 'known_brands', 3
    FROM public.known_brands kb
    WHERE kb.brand_domain IS NOT NULL
      AND kb.security_contact_email IS NOT NULL
      AND position('@' in kb.security_contact_email) > 0
      AND split_part(lower(kb.security_contact_email), '@', 1) NOT IN (
        'info', 'hello', 'contact', 'support', 'sales', 'marketing',
        'enquiries', 'admin', 'noreply', 'no-reply', 'help', 'service')
    UNION ALL
    SELECT
      lower(kb.brand_domain), bsr.recipient_email, 'stewardship', 4
    FROM public.brand_stewardship_reports bsr
    JOIN public.known_brands kb ON kb.brand_key = bsr.brand_key
    WHERE kb.brand_domain IS NOT NULL
      AND bsr.recipient_email IS NOT NULL
      AND position('@' in bsr.recipient_email) > 0
  ),
  best_contact AS (
    SELECT DISTINCT ON (c.brand_domain)
      c.brand_domain, c.recipient, c.channel
    FROM contacts c
    ORDER BY c.brand_domain, c.priority
  ),
  recent_outreach AS (
    SELECT lower(bol.brand_key) AS brand_domain, max(bol.sent_at) AS last_sent
    FROM public.brand_outreach_log bol
    WHERE bol.status = 'sent'
      AND bol.brand_key IS NOT NULL
      AND bol.sent_at > now() - interval '30 days'
    GROUP BY lower(bol.brand_key)
  )
  SELECT
    pb.brand_domain AS brand_key,
    coalesce(pb.brand_normalized, initcap(split_part(pb.brand_domain, '.', 1)))
      AS brand_name,
    pb.weaponised_count,
    pb.live_unactioned_count,
    pb.total_clones,
    pb.reported_count_30d,
    pb.in_campaign,
    pb.campaign_domain_count,
    pb.latest_weaponised_at,
    (bc.recipient IS NOT NULL) AS has_contact,
    bc.recipient AS contact_recipient,
    bc.channel AS contact_channel,
    (ro.last_sent IS NOT NULL) AS contacted_recently,
    ro.last_sent AS last_contacted_at,
    (
      lower(coalesce(pb.brand_normalized, split_part(pb.brand_domain, '.', 1))) IN (
        'commonwealth bank', 'cba', 'commbank', 'westpac', 'nab',
        'national australia bank', 'anz', 'apple', 'amazon', 'paypal',
        'optus', 'telstra', 'qantas', 'coles', 'woolworths')
      OR pb.brand_domain ~ '(^|\.)(cba|commbank|westpac|nab|anz|apple|amazon|paypal|optus|telstra|qantas|coles|woolworths)\.'
      OR bc.recipient LIKE '%@nab.com.au'
      OR bc.recipient LIKE '%@westpac.com.au'
      OR bc.recipient LIKE '%@cba.com.au'
      OR bc.recipient LIKE '%@anz.com'
    ) AS likely_enterprise
  FROM per_brand pb
  JOIN best_contact bc ON bc.brand_domain = pb.brand_domain
  LEFT JOIN recent_outreach ro ON ro.brand_domain = pb.brand_domain
  ORDER BY
    pb.weaponised_count DESC,
    pb.live_unactioned_count DESC,
    pb.in_campaign DESC,
    pb.latest_weaponised_at DESC NULLS LAST,
    pb.total_clones DESC;
$$;

REVOKE ALL ON FUNCTION public.get_brand_outreach_worklist()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_brand_outreach_worklist()
  TO service_role;

COMMENT ON FUNCTION public.get_brand_outreach_worklist() IS
  'Ranked "next brand to email" worklist for /admin/brand-outreach. Candidates = brands with shopfront_clone_alerts AND a resolvable non-generic email contact. Per-brand signals (weaponised / live-unactioned / campaign) + reported_count_30d (lookalikes submitted to a takedown vendor in 30d, powers the composer thin-data warning) + already-contacted flag (brand_outreach_log, 30d) + likely_enterprise tag. Service-role only. (v242)';
