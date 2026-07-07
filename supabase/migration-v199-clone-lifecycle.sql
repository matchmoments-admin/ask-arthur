-- v199 — clone-alert enforcement lifecycle
--        (Wave 0 of docs/plans/clone-watch-enforcement-and-monetisation.md)
--
-- WHY: Netcraft grades on LIVE malicious content. Our NRD sweep catches
-- lookalikes AT REGISTRATION — parked / no-content / cloaked at scan time — so
-- Netcraft's automated pass returns "no threats" and declines. Today
-- clone-watch-poll-netcraft.ts treats that verdict as a TERMINAL takedown
-- (stamps submitted_to.netcraft.takedown_at), so a domain that weaponises days
-- later is never re-checked AND is miscounted as a takedown (inflating the
-- median-time-to-takedown KPI). This migration introduces the enforcement
-- LIFECYCLE that owns "what do we do with this domain over time", so a declined
-- lookalike stays under observation instead of being silently resolved.
--
-- DESIGN (docs/adr/0015 + 0016): a NEW `lifecycle_state` column — NOT a reuse
-- of the existing `alert_state`. `alert_state` ('open'/'acknowledged'/
-- 'taken_down'/'dismissed'/'expired') is the COARSE operator disposition and is
-- the "is this alert live" filter for the public /clone-watch page and the
-- v198 brand-register open-count. Overloading it with fine-grained lifecycle
-- values would make monitored alerts vanish from both surfaces. `lifecycle_state`
-- is the orthogonal detect→weaponise→report→takedown pipeline. The two are kept
-- consistent ONLY at terminal transitions (taken_down / dormant), done in
-- advance_clone_lifecycle() below, so existing alert_state consumers stay correct.
--
-- SCOPE:
--   1. lifecycle_state + recheck bookkeeping + evidence jsonb on
--      shopfront_clone_alerts (all additive, IF NOT EXISTS).
--   2. Partial btree index for the re-check candidate query (live states only).
--   3. Chunked backfill deriving lifecycle_state from existing signals.
--   4. RPC list_clone_alerts_for_recheck() — the re-check worklist.
--   5. RPC advance_clone_lifecycle() — the single guarded transition, keeps the
--      alert_state disposition in sync at terminal states.
--
-- NOT IN SCOPE: visual pHash/TLSH (ADR-0016 Phase C) — evidence.visual_hash slot
-- is reserved, nothing computes it yet. Netcraft submission stays dark.
--
-- Idempotent + re-appliable. shopfront_clone_alerts is a hot write-frequent
-- table, so the backfill is chunked (≤5K/iteration, statement_timeout capped).

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Columns
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.shopfront_clone_alerts
  ADD COLUMN IF NOT EXISTS lifecycle_state text NOT NULL DEFAULT 'detected'
    CHECK (lifecycle_state IN (
      'detected',    -- NRD hit, not yet scanned
      'monitoring',  -- scanned, currently benign (parked / neutral / unresolved)
      'weaponised',  -- urlscan flipped to likely_phishing → fan-out trigger
      'reported',    -- submitted to a takedown channel (Netcraft), polling
      'declined',    -- Netcraft returned "no threats" — NOT terminal, re-check eligible
      'taken_down',  -- terminal: Netcraft malicious/already_blocked or confirmed down
      'dormant'      -- NXDOMAIN for N re-checks / domain dropped
    )),
  ADD COLUMN IF NOT EXISTS last_rechecked_at    timestamptz,
  ADD COLUMN IF NOT EXISTS recheck_count        integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS weaponised_at        timestamptz,
  ADD COLUMN IF NOT EXISTS netcraft_declined_at timestamptz,
  -- evidence: { screenshot_url, dom_hash, tls:{issuer,san[]}, dns:{a[],ns[]},
  --             http_status, content_diff_at, visual_hash? } — captured once,
  --             a property of the DOMAIN (enforcement cases reference it).
  ADD COLUMN IF NOT EXISTS evidence             jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Partial index for the re-check worklist. Small: only the two live re-check
-- states. NULLS FIRST so never-rechecked alerts sort to the front. This is a
-- narrow partial btree (not HNSW/GIN) so it stays safe on the hot parent.
CREATE INDEX IF NOT EXISTS idx_clone_alerts_recheck
  ON public.shopfront_clone_alerts (last_rechecked_at NULLS FIRST)
  WHERE lifecycle_state IN ('monitoring', 'declined');

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Backfill — derive lifecycle_state from existing signals.
--    Bounded to rows still at the default 'detected' that carry a signal worth
--    deriving from (≈862 of 1,253 rows at v199 time — measured, well under the
--    5K single-statement threshold, so no chunking needed). Virgin 'detected'
--    rows correctly stay 'detected'. Idempotent: a re-run only sees rows still
--    at 'detected', so it never clobbers a value a later transition already set.
-- ─────────────────────────────────────────────────────────────────────────
UPDATE public.shopfront_clone_alerts sca
SET lifecycle_state = CASE
      -- terminal: a real Netcraft takedown was recorded (0 rows at v199 time)
      WHEN (sca.submitted_to->'netcraft'->>'takedown_at') IS NOT NULL
        THEN 'taken_down'
      -- our scanner already saw the phish
      WHEN sca.urlscan_classification = 'likely_phishing'
        THEN 'weaponised'
      -- submitted, awaiting verdict
      WHEN sca.submitted_to ? 'netcraft'
        AND (sca.submitted_to->'netcraft'->>'uuid') IS NOT NULL
        THEN 'reported'
      -- scanned, currently benign
      WHEN sca.urlscan_classification IN ('parked_for_sale', 'neutral', 'unresolved')
        THEN 'monitoring'
      ELSE 'detected'
    END,
    weaponised_at = CASE
      WHEN sca.urlscan_classification = 'likely_phishing'
        THEN COALESCE(sca.weaponised_at, sca.urlscan_scanned_at, sca.updated_at)
      ELSE sca.weaponised_at
    END,
    updated_at = now()
WHERE sca.lifecycle_state = 'detected'
  AND (sca.urlscan_classification IS NOT NULL OR sca.submitted_to ? 'netcraft');

-- ─────────────────────────────────────────────────────────────────────────
-- 3. RPC — re-check worklist. Alerts in the two live re-check states whose
--    cadence has elapsed, oldest first. Mirrors the shape of
--    list_clone_alerts_pending_netcraft_poll (v145). service_role only.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_clone_alerts_for_recheck(
  p_limit int DEFAULT 50,
  p_cadence_hours int DEFAULT 6
)
RETURNS TABLE (
  id bigint,
  candidate_domain text,
  candidate_url text,
  lifecycle_state text,
  urlscan_classification text,
  recheck_count int,
  last_rechecked_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
  SELECT
    sca.id,
    sca.candidate_domain,
    sca.candidate_url,
    sca.lifecycle_state,
    sca.urlscan_classification,
    sca.recheck_count,
    sca.last_rechecked_at
  FROM public.shopfront_clone_alerts sca
  WHERE sca.source = 'nrd'
    AND sca.lifecycle_state IN ('monitoring', 'declined')
    AND (
      sca.last_rechecked_at IS NULL
      OR sca.last_rechecked_at < now() - make_interval(hours => GREATEST(1, p_cadence_hours))
    )
  ORDER BY sca.last_rechecked_at ASC NULLS FIRST
  LIMIT GREATEST(1, LEAST(p_limit, 500));
$$;

REVOKE EXECUTE ON FUNCTION public.list_clone_alerts_for_recheck(int, int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_clone_alerts_for_recheck(int, int)
  TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. RPC — the single guarded lifecycle transition. Every path (poll, re-check,
--    submit) goes through here so the state machine can't diverge. Validates
--    the target state, stamps the matching timestamp, merges evidence, and
--    keeps the coarse alert_state disposition in sync at terminal states.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.advance_clone_lifecycle(
  p_alert_id bigint,
  p_to_state text,
  p_evidence jsonb DEFAULT NULL,
  p_mark_rechecked boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_to_state NOT IN (
    'detected','monitoring','weaponised','reported','declined','taken_down','dormant'
  ) THEN
    RAISE EXCEPTION 'advance_clone_lifecycle: invalid target state %', p_to_state
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.shopfront_clone_alerts
  SET lifecycle_state = p_to_state,
      -- first-touch timestamps (COALESCE so a re-entry doesn't reset them)
      weaponised_at = CASE WHEN p_to_state = 'weaponised'
                           THEN COALESCE(weaponised_at, now()) ELSE weaponised_at END,
      netcraft_declined_at = CASE WHEN p_to_state = 'declined'
                                  THEN now() ELSE netcraft_declined_at END,
      -- keep the coarse disposition consistent at terminal states so the public
      -- page + brand-register open-count drop a resolved/dead clone.
      alert_state = CASE
                      WHEN p_to_state = 'taken_down' THEN 'taken_down'
                      WHEN p_to_state = 'dormant'    THEN 'expired'
                      ELSE alert_state
                    END,
      evidence = CASE WHEN p_evidence IS NULL THEN evidence
                      ELSE evidence || p_evidence END,
      recheck_count = recheck_count + (CASE WHEN p_mark_rechecked THEN 1 ELSE 0 END),
      last_rechecked_at = CASE WHEN p_mark_rechecked THEN now() ELSE last_rechecked_at END,
      updated_at = now()
  WHERE id = p_alert_id;
END
$$;

REVOKE EXECUTE ON FUNCTION public.advance_clone_lifecycle(bigint, text, jsonb, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_clone_lifecycle(bigint, text, jsonb, boolean)
  TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Redefine the Netcraft poll worklist to respect the lifecycle.
--    The v145 definition filtered only on `takedown_at IS NULL`, so a DECLINED
--    alert — which correctly has no takedown_at — would be re-polled against its
--    dead submission for 30 days. Once Netcraft has declined (or actioned) an
--    alert, it leaves the poll set: declined alerts are handed to the re-check
--    loop (list_clone_alerts_for_recheck), and are only re-submitted — as a
--    FRESH submission — on a weaponisation transition. Signature + grants
--    unchanged from v145.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_clone_alerts_pending_netcraft_poll(
  p_limit int DEFAULT 50
)
RETURNS TABLE (
  id bigint,
  netcraft_uuid text,
  candidate_url text,
  submitted_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
  SELECT
    sca.id,
    (sca.submitted_to->'netcraft'->>'uuid')::text AS netcraft_uuid,
    sca.candidate_url,
    (sca.submitted_to->'netcraft'->>'submitted_at')::timestamptz AS submitted_at
  FROM public.shopfront_clone_alerts sca
  WHERE sca.source = 'nrd'
    AND sca.submitted_to ? 'netcraft'
    AND (sca.submitted_to->'netcraft'->>'uuid') IS NOT NULL
    AND (sca.submitted_to->'netcraft'->>'takedown_at') IS NULL
    -- v199: a declined/actioned/dropped alert leaves the poll set — no more
    -- spinning on a dead Netcraft submission.
    AND sca.lifecycle_state NOT IN ('declined', 'taken_down', 'dormant')
    -- Don't keep polling indefinitely — give up after 30 days unresolved.
    AND (sca.submitted_to->'netcraft'->>'submitted_at')::timestamptz
        > now() - interval '30 days'
  ORDER BY (sca.submitted_to->'netcraft'->>'submitted_at')::timestamptz ASC
  LIMIT GREATEST(1, LEAST(p_limit, 200));
$$;

REVOKE EXECUTE ON FUNCTION public.list_clone_alerts_pending_netcraft_poll(int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_clone_alerts_pending_netcraft_poll(int)
  TO service_role;

COMMENT ON COLUMN public.shopfront_clone_alerts.lifecycle_state IS
  'Enforcement lifecycle (v199): detected→monitoring→weaponised→reported→{declined↺,taken_down}. Orthogonal to alert_state (coarse disposition). See docs/plans/clone-watch-enforcement-and-monetisation.md.';
