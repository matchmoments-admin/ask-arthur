-- migration-v241-brand-outreach-log.sql
--
-- Records every founder-composed brand reach-out send (the manual, four-eyes
-- pilot outreach path — /admin/brand-outreach). One row per send attempt:
-- 'sent' on a successful Resend send, 'failed' otherwise. This is the audit
-- ledger AND the "who have we already contacted" memory that makes the
-- composer's "Next brand to email" worklist meaningful — without it, "next"
-- has no notion of "already done".
--
-- This table is NOT a hot write-frequent table (a founder sends a handful of
-- these by hand), so no chunking / sibling-index concerns apply.
--
-- Idempotent DDL (CREATE ... IF NOT EXISTS, DROP POLICY IF EXISTS). Service-
-- role-only RLS mirrors public.brand_stewardship_reports (v166). Reverse:
-- DROP TABLE public.brand_outreach_log + DROP FUNCTION
-- public.get_brand_outreach_worklist().

-- ── 1. Ledger table ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.brand_outreach_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Optional stable brand key (the composer passes the worklist's brand_key,
  -- which is the brand's legit domain, e.g. 'kmart.com.au'). Nullable because
  -- an ad-hoc send to a brand not in the worklist may not carry one.
  brand_key           TEXT,
  brand_name          TEXT NOT NULL,
  recipient           TEXT NOT NULL,
  subject             TEXT NOT NULL,
  mode                TEXT NOT NULL CHECK (mode IN ('real', 'shadow')),
  status              TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
  provider_message_id TEXT,
  sent_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- Recency lookup per brand (worklist's contacted_recently / last_contacted_at).
CREATE INDEX IF NOT EXISTS brand_outreach_log_brand_sent_idx
  ON public.brand_outreach_log (brand_key, sent_at DESC);
-- Chronological scan (admin history views).
CREATE INDEX IF NOT EXISTS brand_outreach_log_sent_idx
  ON public.brand_outreach_log (sent_at DESC);

ALTER TABLE public.brand_outreach_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brand_outreach_log_service_all ON public.brand_outreach_log;
CREATE POLICY brand_outreach_log_service_all
  ON public.brand_outreach_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.brand_outreach_log IS
  'Audit ledger of founder-composed brand reach-out / pilot email sends (the manual four-eyes path, /admin/brand-outreach). One row per send attempt (sent|failed). Powers the "Next brand to email" worklist''s already-contacted memory. Not a hot table.';

-- ── 2. Worklist RPC ──────────────────────────────────────────────────────
-- Ranked candidate brands to email next, computed LIVE from clone-alert
-- signals + a resolvable contact. Returns ALL candidates (the UI splits
-- recently-contacted / enterprise-parked); does NOT filter those out.
--
-- CANDIDATE SET: brands with rows in shopfront_clone_alerts (keyed by the
-- legit domain, inferred_target_domain) AND a resolvable, non-generic email
-- contact from one of: brand_contact_directory (security_txt / fraud_inbox),
-- known_brands.security_contact_email, or a brand_stewardship_reports
-- recipient (bridged via known_brands.brand_key).
--
-- SECURITY DEFINER + empty search_path (pg_catalog is still implicitly
-- searched, so built-ins resolve; no extension operators are used here).
-- LANGUAGE sql, so no #variable_conflict directive is needed.
DROP FUNCTION IF EXISTS public.get_brand_outreach_worklist();
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
AS $$
  WITH campaign_sizes AS (
    -- Global domains-per-campaign, so a brand can show "part of an N-domain
    -- coordinated campaign".
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
      -- "still live but unactioned": detected (not yet scanned) + declined
      -- (Netcraft said no-threats but it's non-terminal, re-check eligible).
      count(*) FILTER (WHERE sca.lifecycle_state IN ('detected', 'declined'))::int
        AS live_unactioned_count,
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
  'Ranked "next brand to email" worklist for /admin/brand-outreach. Candidates = brands with shopfront_clone_alerts AND a resolvable non-generic email contact. Returns per-brand signals (weaponised / live-unactioned / campaign) + already-contacted flag (brand_outreach_log, 30d) + likely_enterprise tag. Service-role only.';
