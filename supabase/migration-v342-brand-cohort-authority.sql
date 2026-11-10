-- migration-v342-brand-cohort-authority.sql
--
-- PR-E (#1296, map #1294): the Brand Cohort is ONE SQL predicate, and every
-- surface that counts a brand's lookalikes reads it instead of restating it.
--
-- ── Why ──────────────────────────────────────────────────────────────────────
--
-- "Which lookalike alerts count for a brand" was answered by five formulas:
-- applyCohortRules (TS: nrd, not fp, not an FP dictionary brand), the outreach
-- worklist (v269: every alert, fp included), the exposure teaser (v203), the
-- public impact panel (v340: nrd, not fp) and the pilot email (nrd, not fp).
-- Same class of defect as the +62% Kmart figure: two surfaces, two numbers,
-- each looking like a data disagreement. Measured 2026-10-13 (read-only):
-- the worklist the founder pitches from counted cleared false positives —
-- iinet.net.au 41 lookalikes (cohort: 10), ubank.com.au 46 (22),
-- my.gov.au 29 (12), wotif.com 22 (6), hellostake.com 233 (195); 8 of its 54
-- brands overstated, by 161 lookalikes in all.
--
-- ── The predicate ────────────────────────────────────────────────────────────
--
-- `clone_watch_brand_cohort` is shopfront_clone_alerts restricted to members:
--   1. source = 'nrd'                       — the NRD sweep, the only source
--                                              any brand number counts;
--   2. inferred_target_domain IS NOT NULL   — attributable to a brand;
--   3. triage_status IS DISTINCT FROM 'fp'  — a cleared false positive is not
--                                              a lookalike (NULL = untriaged,
--                                              the majority, KEPT);
--   4. brand not in the FP dictionary list  — FP_BRAND_DENYLIST
--                                              (fp-brand-denylist.ts), pinned
--                                              by fpBrandDenylistSqlDrift.test.
-- `brand` = lower(inferred_target_domain), the store's grain.
--
-- Membership only. Two things deliberately stay with the reader:
--   - the PERIOD (a month, a rolling 30 days, all time): a parameter of the
--     question, not of membership;
--   - DISCLOSURE filters (confirmed-only for anything that names a domain
--     publicly — /clone-watch's list, the exposure teaser's examples): a
--     subset of the cohort, never a different cohort.
-- The counting unit is one candidate domain per brand: counts use
-- count(DISTINCT candidate_domain), the SQL twin of aggregateClonesByDomain's
-- per-brand dedupe.
--
-- The not-a-clone audit withholding (#1256) is NOT membership — a withheld
-- sample stays a member (its match is lexical) — so it stays in TS
-- (withholdAuditVerdict), applied to rows read from this view.
--
-- Closed months are not re-derived from this view: they are served from the
-- frozen Monthly Brand Store (v319), whose alert_ids were selected by this
-- same rule at publication (month-facts.ts holds the open/closed rule).
--
-- ── Shape notes ──────────────────────────────────────────────────────────────
--
-- A plain (non-aggregating) view over one table, so PostgREST infers the
-- clone_watch_classifications / clone_watch_not_a_clone_samples embeds through
-- it (their alert_id FKs reference shopfront_clone_alerts.id, exposed as `id`)
-- and Postgres inlines the WHERE into each caller's plan. security_invoker:
-- the view never widens access; it is granted to service_role only.
-- `sca.*` is expanded at CREATE time — a column added to shopfront_clone_alerts
-- later does not appear here until this view is re-created (a reader selecting
-- it gets a loud PostgREST 400, not a silent undefined).
--
-- Read-only: no table is written. The view must exist before the code that
-- reads it deploys (apply this migration, then merge).

CREATE OR REPLACE VIEW public.clone_watch_brand_cohort
WITH (security_invoker = true) AS
SELECT
  sca.*,
  lower(sca.inferred_target_domain) AS brand
FROM public.shopfront_clone_alerts sca
WHERE sca.source = 'nrd'
  AND sca.inferred_target_domain IS NOT NULL
  AND sca.triage_status IS DISTINCT FROM 'fp'
  AND lower(sca.inferred_target_domain) NOT IN (
    'domain.com.au', 'allhomes.com.au', 'lendi.com.au');

REVOKE ALL ON public.clone_watch_brand_cohort FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.clone_watch_brand_cohort TO service_role;

COMMENT ON VIEW public.clone_watch_brand_cohort IS
  'v342 (#1296): THE Brand Cohort — the only membership authority for per-brand clone counts. nrd, brand-attributed, not triaged fp, not an FP dictionary brand. Period and disclosure filters are the reader''s; count distinct candidate_domain per brand. Service-role only.';

-- ── get_brand_outreach_worklist ─────────────────────────────────────────────
-- Re-created from the LIVE definition (pg_get_functiondef 2026-10-13, identical
-- to v269). Changes: per_brand and campaign_sizes read the cohort, counts are
-- distinct candidate domains, function-level statement_timeout. Signature and
-- return shape unchanged (CREATE OR REPLACE keeps the OID and ACL).
CREATE OR REPLACE FUNCTION public.get_brand_outreach_worklist()
RETURNS TABLE (
  brand_key             text,
  brand_name            text,
  weaponised_count      integer,
  live_unactioned_count integer,
  total_clones          integer,
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
SET statement_timeout = '30s'
AS $$
  WITH campaign_sizes AS (
    -- Domains per shared-infrastructure fingerprint, cohort members only (a
    -- cleared false positive on the same stack is not a lookalike).
    SELECT c.campaign_key, count(DISTINCT c.candidate_domain)::int AS domain_count
    FROM public.clone_watch_brand_cohort c
    WHERE c.campaign_key IS NOT NULL
      AND c.campaign_key <> 'insufficient'
    GROUP BY c.campaign_key
  ),
  per_brand AS (
    SELECT
      c.brand AS brand_domain,
      count(DISTINCT c.candidate_domain)::int AS total_clones,
      count(DISTINCT c.candidate_domain) FILTER (WHERE c.lifecycle_state = 'weaponised')::int
        AS weaponised_count,
      -- "still live but unactioned": detected (not yet scanned) + declined
      -- (Netcraft said no-threats but it's non-terminal, re-check eligible).
      count(DISTINCT c.candidate_domain) FILTER (WHERE c.lifecycle_state IN ('detected', 'declined'))::int
        AS live_unactioned_count,
      bool_or(c.campaign_key IS NOT NULL AND c.campaign_key <> 'insufficient')
        AS in_campaign,
      max(c.weaponised_at) AS latest_weaponised_at,
      max(c.target_brand_normalized) AS brand_normalized,
      max(cs.domain_count) AS campaign_domain_count
    FROM public.clone_watch_brand_cohort c
    LEFT JOIN campaign_sizes cs ON cs.campaign_key = c.campaign_key
    GROUP BY c.brand
  ),
  contacts AS (
    -- Directory: only email-capable, security-grade channels.
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
      AND bol.mode = 'real'
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
  'Ranked "next brand to email" worklist for /admin/brand-outreach. Counts are distinct lookalikes in the Brand Cohort (clone_watch_brand_cohort, v342) — fp-cleared alerts no longer inflate a pitch. Candidates = cohort brands with a resolvable non-generic email contact. Already-contacted = brand_outreach_log, 30d, real sends only (v269). Service-role only.';

-- ── brand_exposure_summary ──────────────────────────────────────────────────
-- Re-created from the LIVE definition (identical to v203). The cohort is the
-- membership; "adjudicated only" (tp_confirmed / tp_actioned) stays as this
-- teaser's DISCLOSURE filter — it names (masked) domains to the public.
-- detected_count is distinct candidate domains. Equality on the resolved key is
-- unchanged (the anti-scrape layer). search_path '' with qualified names.
CREATE OR REPLACE FUNCTION public.brand_exposure_summary(
  p_brand_normalized text
)
RETURNS TABLE (
  detected_count int,
  earliest timestamptz,
  examples jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '15s'
STABLE
AS $$
  WITH hits AS (
    SELECT DISTINCT ON (c.candidate_domain)
      c.candidate_domain, c.first_seen_at, c.urlscan_classification
    FROM public.clone_watch_brand_cohort c
    WHERE c.target_brand_normalized = p_brand_normalized   -- EXACT equality, never LIKE
      AND c.triage_status IN ('tp_confirmed', 'tp_actioned') -- disclosure: adjudicated only
    ORDER BY c.candidate_domain, c.first_seen_at
  )
  SELECT
    (SELECT count(*)::int FROM hits),
    (SELECT min(first_seen_at) FROM hits),
    COALESCE(
      (
        SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          -- mask: first char + *** + last char of the primary label, then TLD
          'masked',
          pg_catalog.left(pg_catalog.split_part(e.candidate_domain, '.', 1), 1)
            || pg_catalog.repeat('*', 3)
            || pg_catalog.right(pg_catalog.split_part(e.candidate_domain, '.', 1), 1)
            || '.'
            || pg_catalog.split_part(e.candidate_domain, '.', 2),
          'classification', e.urlscan_classification,
          'first_seen', pg_catalog.to_char(e.first_seen_at, 'YYYY-MM-DD')
        ))
        FROM (
          SELECT candidate_domain, first_seen_at, urlscan_classification
          FROM hits
          ORDER BY first_seen_at DESC
          LIMIT 5
        ) e
      ),
      '[]'::jsonb
    );
$$;

REVOKE ALL ON FUNCTION public.brand_exposure_summary(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_exposure_summary(text) TO service_role;

COMMENT ON FUNCTION public.brand_exposure_summary(text) IS
  'v342: scrape-proof masked exposure teaser over the Brand Cohort (clone_watch_brand_cohort). Equality match on an already-resolved brand key; adjudicated rows only (disclosure); distinct lookalikes; ≤5 masked examples. service_role only.';

-- ── clone_watch_public_impact ───────────────────────────────────────────────
-- Re-created from the LIVE definition (v340). v340 already restated half the
-- cohort rule (nrd + not fp) inline; it now reads the cohort, so a change to
-- membership reaches the /clone-watch panel without another migration.
-- Measured 2026-10-13: identical output (no brand-less or FP-dictionary rows
-- in the window), so this is an authority move, not a number change.
CREATE OR REPLACE FUNCTION public.clone_watch_public_impact(p_days integer DEFAULT 30)
 RETURNS TABLE(window_days integer, candidates_total bigint, tp_confirmed_total bigint, netcraft_submits_total bigint, brand_notifications_total bigint, brands_protected bigint, computed_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '30s'
AS $function$
  WITH window_rows AS (
    SELECT c.triage_status, c.submitted_to, c.inferred_target_domain
    FROM public.clone_watch_brand_cohort c
    WHERE c.first_seen_at >= pg_catalog.now() - (GREATEST(1, LEAST(p_days, 90)) * interval '1 day')
  )
  SELECT
    GREATEST(1, LEAST(p_days, 90)) AS window_days,
    COUNT(*) AS candidates_total,
    COUNT(*) FILTER (WHERE triage_status IN ('tp_confirmed','tp_actioned')) AS tp_confirmed_total,
    COUNT(*) FILTER (WHERE submitted_to ? 'netcraft') AS netcraft_submits_total,
    COUNT(*) FILTER (WHERE submitted_to ? 'brand_notification') AS brand_notifications_total,
    -- Brands where we actively took action (submitted to Netcraft OR notified
    -- the brand). A row that was triaged TP but never acted on doesn't count.
    COUNT(DISTINCT inferred_target_domain) FILTER (
      WHERE submitted_to ? 'netcraft' OR submitted_to ? 'brand_notification'
    ) AS brands_protected,
    pg_catalog.now() AS computed_at
  FROM window_rows;
$function$;

REVOKE ALL ON FUNCTION public.clone_watch_public_impact(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clone_watch_public_impact(integer) TO service_role;

-- PostgREST must see the new relation (and its embeds) before the code reads it.
NOTIFY pgrst, 'reload schema';
