-- v341 — record_weaponised_liveness APPLIES the Domain DNS State verdict
-- (PR-A of the clone-watch deepening plan, 2026-09-28).
--
-- WHY. v329 re-derived the stored verdict from the one boolean the sweep sent,
-- `gone`: gone = false → 'present'. `gone` is the LIFECYCLE question (NXDOMAIN
-- on A and NS), so a name whose NS still resolves but which has NO A/AAAA read
-- as 'present'. Two consequences:
--   - a dormant clone with its address pulled re-entered `weaponised` (the
--     re_emerged branch fired on `gone = false`);
--   - it counted in the reconcile lane's `stranded_live`
--     (liveness_last_verdict = 'present').
-- Every other exit-from-dormant bar requires an ADDRESS: the re-emergence
-- monitor (resolvesToHost), month-end stock (`no_host`) and the v326
-- dead-dormancy reset. Two bars for one question.
--
-- WHAT. The TS sweep now reads ONE DomainDnsState per name
-- (apps/web/lib/clone-watch/liveness.ts) and sends, per read:
--   verdict — 'present' (resolves to an address) | 'no_host' (the name answers
--             and A/AAAA answered empty) | 'gone' (NXDOMAIN) | 'inconclusive'
--   gone    — unchanged (the v329 body's only input)
--   hold    — the one TS registry-hold rule (isRegistryHold) over the stored
--             RDAP statuses, which list_weaponised_for_liveness now returns
-- This body APPLIES `verdict` instead of re-deriving it:
--   - dormant → weaponised ONLY on 'present' (an address). 'no_host' stays
--     dormant.
--   - 'no_host' on a weaponised row is NOT gone (the dormancy clock is NXDOMAIN
--     only, unchanged) and NOT present: it clears offline_since exactly as
--     v329's gone = false did, but is stored as 'no_host', so it never counts
--     in stranded_live.
--   - `hold` decides offline_cause when supplied; the v329 regex remains the
--     fallback for a caller that sends none.
--
-- SAFE WITH OLD CODE (no verdict / hold keys): verdict falls back to the v329
-- derivation from `gone`, hold to the v329 regex — byte-for-byte v329
-- behaviour. New code on the v329 body is also safe: it still sends `gone`.
--
-- Re-created from the LIVE prod bodies (pg_get_functiondef, 2026-09-28), not
-- from v329's file. Both functions change their RETURNS TABLE (a new trailing
-- column), which CREATE OR REPLACE cannot do, so each is dropped and
-- re-created in this transaction with its grants restated (live ACL:
-- postgres + service_role only).
--
-- Also: the v325 COMMENT on clone_liveness_snapshots.status listed the
-- precedence in the wrong order (comment-only statement, §4).
--
-- REVERSE: re-run v329 §2's CHECK (after UPDATE … SET liveness_last_verdict =
-- 'present' WHERE liveness_last_verdict = 'no_host'), and re-create both
-- functions from the v329 bodies quoted in this PR's description (DROP first —
-- the return types differ). The TS sweep keeps working on the v329 body.

BEGIN;

-- ── 1. The stored verdict gains 'no_host' ─────────────────────────────────
ALTER TABLE public.shopfront_clone_alerts
  DROP CONSTRAINT IF EXISTS clone_alert_liveness_last_verdict_check;
ALTER TABLE public.shopfront_clone_alerts
  ADD CONSTRAINT clone_alert_liveness_last_verdict_check
  CHECK (liveness_last_verdict IS NULL
         OR liveness_last_verdict IN ('present', 'no_host', 'gone', 'inconclusive'));

COMMENT ON COLUMN public.shopfront_clone_alerts.liveness_last_verdict IS
  'v329, v341. The latest DNS liveness read of this alert by the reconcile sweep, as the TS Domain DNS State reads it (liveness.ts livenessVerdictOf): present (resolves to an A/AAAA address) / no_host (the name exists and A/AAAA answered empty, e.g. NS-only — read present before v341; an address lookup that FAILED is inconclusive) / gone (NXDOMAIN) / inconclusive (the resolver proved nothing). NULL = never read.';

-- ── 2. The worklist returns the stored RDAP statuses ──────────────────────
-- Live body + one trailing column. whois_statuses is always a jsonb array
-- (empty when none are stored), so the TS hold rule always has an input.
DROP FUNCTION IF EXISTS public.list_weaponised_for_liveness(integer, integer, integer);
CREATE FUNCTION public.list_weaponised_for_liveness(
  p_limit integer DEFAULT 200,
  p_cadence_hours integer DEFAULT 20,
  p_dormant_cadence_hours integer DEFAULT 168
)
RETURNS TABLE(id bigint, candidate_domain text, lifecycle_state text, due_total bigint, whois_statuses jsonb)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
SET statement_timeout TO '30s'
AS $function$
  SELECT
    sca.id,
    sca.candidate_domain,
    sca.lifecycle_state,
    -- Window count runs BEFORE the LIMIT: a truncated sweep reports how much
    -- it left behind instead of looking complete.
    pg_catalog.count(*) OVER () AS due_total,
    -- v341: the TS registry-hold rule's input (liveness.ts isRegistryHold).
    CASE WHEN pg_catalog.jsonb_typeof(sca.attribution -> 'whois' -> 'statuses') = 'array'
         THEN sca.attribution -> 'whois' -> 'statuses'
         ELSE '[]'::jsonb END AS whois_statuses
  FROM public.shopfront_clone_alerts sca
  WHERE sca.candidate_domain IS NOT NULL
    AND (
      (
        sca.lifecycle_state = 'weaponised'
        -- NULL-safe: a never-probed row is admitted by the first disjunct.
        AND (
          sca.liveness_checked_at IS NULL
          OR sca.liveness_checked_at
               <= pg_catalog.now() - pg_catalog.make_interval(hours => GREATEST(1, p_cadence_hours))
        )
      )
      OR (
        sca.lifecycle_state = 'dormant'
        AND sca.offline_since IS NOT NULL
        AND sca.weaponised_at IS NOT NULL
        AND (
          sca.liveness_checked_at IS NULL
          OR sca.liveness_checked_at
               <= pg_catalog.now() - pg_catalog.make_interval(hours => GREATEST(1, p_dormant_cadence_hours))
        )
      )
    )
  -- Weaponised first (the live question), then stalest.
  ORDER BY (sca.lifecycle_state = 'weaponised') DESC,
           sca.liveness_checked_at ASC NULLS FIRST, sca.id ASC
  LIMIT GREATEST(1, LEAST(p_limit, 500));
$function$;

REVOKE ALL ON FUNCTION public.list_weaponised_for_liveness(integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_weaponised_for_liveness(integer, integer, integer)
  TO service_role;

COMMENT ON FUNCTION public.list_weaponised_for_liveness(integer, integer, integer) IS
  'v329, v341. Alerts due a DNS liveness read: weaponised every p_cadence_hours, and clones this sweep moved to dormant (offline_since + weaponised_at set) every p_dormant_cadence_hours so a lifted registrar hold is seen. Weaponised first, stalest first; due_total counts every due row before the LIMIT. No age cap. v341: whois_statuses (attribution.whois.statuses, [] when absent) feeds the TS registry-hold rule.';

-- ── 3. The recorder applies the TS verdict ────────────────────────────────
DROP FUNCTION IF EXISTS public.record_weaponised_liveness(jsonb, integer);
CREATE FUNCTION public.record_weaponised_liveness(
  p_results jsonb,
  p_confirm_hours integer DEFAULT 12
)
RETURNS TABLE(checked integer, present integer, gone_unconfirmed integer, offline_confirmed integer, inconclusive integer, re_emerged integer, no_host integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
SET statement_timeout TO '30s'
AS $function$
  WITH r0 AS (
    SELECT DISTINCT ON ((e ->> 'id')::bigint)
      (e ->> 'id')::bigint AS id,
      CASE WHEN pg_catalog.jsonb_typeof(e -> 'gone') = 'boolean'
           THEN (e ->> 'gone')::boolean END AS gone,
      -- v341: the TS verdict. Anything else (absent, null, unknown) → NULL,
      -- and the v329 derivation from `gone` applies below.
      CASE WHEN e ->> 'verdict' IN ('present', 'no_host', 'gone', 'inconclusive')
           THEN e ->> 'verdict' END AS verdict_in,
      CASE WHEN pg_catalog.jsonb_typeof(e -> 'hold') = 'boolean'
           THEN (e ->> 'hold')::boolean END AS hold_in
    FROM pg_catalog.jsonb_array_elements(COALESCE(p_results, '[]'::jsonb)) e
    WHERE (e ->> 'id') IS NOT NULL
  ),
  r AS (
    SELECT
      r0.id,
      r0.hold_in,
      COALESCE(
        r0.verdict_in,
        -- Pre-v341 caller: exactly v329's reading of `gone`.
        CASE WHEN r0.gone IS NULL THEN 'inconclusive'
             WHEN r0.gone THEN 'gone'
             ELSE 'present' END
      ) AS verdict
    FROM r0
  ),
  calc AS (
    SELECT
      sca.id,
      sca.lifecycle_state AS prior_state,
      r.verdict,
      CASE
        -- One exit-from-dormant bar: an ADDRESS (v341). 'no_host' stays.
        WHEN sca.lifecycle_state = 'dormant' THEN
          CASE WHEN r.verdict = 'present' THEN 're_emerged' ELSE 'dormant_still_gone' END
        WHEN r.verdict = 'inconclusive' THEN 'inconclusive'
        WHEN r.verdict = 'present' THEN 'present'
        -- Not gone (the dormancy clock is NXDOMAIN only) and not present.
        WHEN r.verdict = 'no_host' THEN 'no_host'
        WHEN sca.offline_since IS NULL THEN 'gone_first'
        WHEN sca.offline_since
             <= pg_catalog.now() - pg_catalog.make_interval(hours => GREATEST(1, p_confirm_hours))
        THEN 'offline_confirmed'
        -- A second NXDOMAIN too soon after the first (e.g. a retried step):
        -- keep waiting; the first observation stands.
        ELSE 'gone_pending'
      END AS outcome,
      -- The TS registry-hold rule when the caller sent it; else the v329
      -- regex over the RDAP statuses as stored ("client hold", "serverHold", …).
      COALESCE(
        r.hold_in,
        (sca.attribution -> 'whois' -> 'statuses')::text ~* '(client|server)[ _-]?hold',
        false
      ) AS on_hold
    FROM public.shopfront_clone_alerts sca
    JOIN r ON r.id = sca.id
    WHERE sca.lifecycle_state = 'weaponised'
       OR (sca.lifecycle_state = 'dormant'
           AND sca.offline_since IS NOT NULL
           AND sca.weaponised_at IS NOT NULL)
  ),
  upd AS (
    UPDATE public.shopfront_clone_alerts sca
    SET
      liveness_checked_at = pg_catalog.now(),
      liveness_last_verdict = c.verdict,
      offline_since = CASE c.outcome
        WHEN 'present'    THEN NULL
        WHEN 're_emerged' THEN NULL
        -- As v329's gone = false: the name answers, the NXDOMAIN clock resets.
        WHEN 'no_host'    THEN NULL
        WHEN 'gone_first' THEN pg_catalog.now()
        ELSE sca.offline_since
      END,
      offline_cause = CASE c.outcome
        WHEN 'offline_confirmed' THEN CASE WHEN c.on_hold THEN 'registrar_hold' ELSE 'nxdomain' END
        WHEN 're_emerged'        THEN NULL
        WHEN 'present'           THEN NULL
        WHEN 'no_host'           THEN NULL
        ELSE sca.offline_cause
      END,
      lifecycle_state = CASE c.outcome
        WHEN 'offline_confirmed' THEN 'dormant'
        WHEN 're_emerged'        THEN 'weaponised'
        ELSE sca.lifecycle_state
      END,
      -- v288 clone_alert_terminal_state_sync: dormant requires expired; a
      -- re-emerged clone is an open threat again.
      alert_state = CASE c.outcome
        WHEN 'offline_confirmed' THEN 'expired'
        WHEN 're_emerged'        THEN 'open'
        ELSE sca.alert_state
      END,
      updated_at = CASE WHEN c.outcome IN ('offline_confirmed', 're_emerged')
                        THEN pg_catalog.now() ELSE sca.updated_at END
    FROM calc c
    WHERE sca.id = c.id
      -- Re-checked at write time: a concurrent Netcraft takedown wins.
      AND sca.lifecycle_state = c.prior_state
    RETURNING c.outcome
  )
  SELECT
    count(*)::int,
    (count(*) FILTER (WHERE outcome = 'present'))::int,
    (count(*) FILTER (WHERE outcome IN ('gone_first', 'gone_pending')))::int,
    (count(*) FILTER (WHERE outcome = 'offline_confirmed'))::int,
    (count(*) FILTER (WHERE outcome = 'inconclusive'))::int,
    (count(*) FILTER (WHERE outcome = 're_emerged'))::int,
    (count(*) FILTER (WHERE outcome = 'no_host'))::int
  FROM upd;
$function$;

REVOKE ALL ON FUNCTION public.record_weaponised_liveness(jsonb, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_weaponised_liveness(jsonb, integer)
  TO service_role;

COMMENT ON FUNCTION public.record_weaponised_liveness(jsonb, integer) IS
  'v329, v341. Applies the DNS liveness reads of the TS Domain DNS State (liveness.ts): per element {id, verdict present|no_host|gone|inconclusive, gone, hold}. Weaponised: present or no_host clears offline_since; first gone (NXDOMAIN) sets it; a second >= p_confirm_hours later moves weaponised → dormant (alert_state expired, offline_cause registrar_hold | nxdomain from the TS hold, else the stored-RDAP regex). Dormant rows this sweep put there go back to weaponised / open ONLY on present — an address, the same bar as re-emergence, month-end stock and v326 (no_host stays dormant). A caller that sends no verdict gets v329: verdict from gone. An inconclusive read only stamps.';

-- ── 4. v325 COMMENT: the precedence as stockStatus actually applies it ─────
COMMENT ON COLUMN public.clone_liveness_snapshots.status IS
  'Rule: clone-metrics.ts stockStatus, a reading of the Domain DNS State (liveness.ts). gone (NXDOMAIN on A and NS) first; then, when the name resolves to an address: live_phishing (weaponised) > parked (parking NS or for-sale page) > live; when it answers with no address: parked (fresh parking NS) > held (clienthold/serverhold) > no_host; when the resolver proved nothing: held > unverified. unverified also = never probed (v325; order corrected v341).';

COMMIT;
