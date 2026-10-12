-- v343 — the urlscan submit DNS precheck is stored as a Domain DNS State
-- reading in its own columns, not as a fake urlscan HTTP 400 (#1297, map #1294).
--
-- WHY. Since 2026-09-23 the submit precheck (apps/web/lib/clone-watch/
-- urlscan-submit-one.ts) skipped urlscan for a name that points at no host
-- (and, from 09-25, for an A+AAAA SERVFAIL) and recorded that by writing
-- `serialiseSubmitFailure(code, 400, …)` INTO urlscan_evidence, so the v277/
-- v279 dead-domain cadence (`urlscan_evidence->>'status' = '400'`) would pick
-- it up. record_clone_alert_urlscan_submit replaces urlscan_evidence wholesale,
-- so on the recheck lane the fake 400 overwrote whatever the row already held.
-- Measured in prod 2026-10-13 (read-only):
--   - 731 alerts carry a precheck stamp (730 dns_no_host_precheck + 1 legacy
--     dns_nxdomain_precheck; 0 dns_servfail_precheck survive); 420 of them
--     were stamped in the last 7 days.
--   - 280 of those had been urlscan-scanned before the precheck overwrote the
--     evidence; 255 had a retrieved render (urlscan_uuid, screenshot_url,
--     server, technologies) and lost it. 218 of the 280 have an earlier render
--     still in clone_watch_scan_transitions (recoverable; NOT done here).
--   - 23 likely_phishing alerts lost the Google Safe Browsing reputation hit
--     their verdict rests on: their stored reputation now reads
--     {is_malicious:false, sources:[]} — the precheck's placeholder.
--   - Genuine urlscan 400s (error 'rejected') are a different population:
--     293 rows, 289 of them urlscan's own "DNS Error - Could not resolve
--     domain". Those are real urlscan answers and keep their meaning.
--
-- WHAT.
--   1. Two columns: dns_precheck (the submit precheck's reading of the Domain
--      DNS State — `submitPrecheckOf`: host | no_host | servfail | unknown)
--      and dns_precheck_at. Named for the reading, not "presence": the
--      presence vocabulary (gone/resolves/no_host/unverified) cannot tell a
--      SERVFAIL — which the precheck treats as dead — from a timeout, which it
--      scans. The weaponised sweep (liveness_last_verdict) and the recheck
--      gate (recheck_dns_fingerprint) already persist their own readings the
--      same way.
--   2. record_clone_alert_urlscan_submit gains p_dns_precheck. Every submit
--      that reached the precheck records the reading (host/unknown on the
--      urlscan paths), so a name that comes back to life clears its own dead
--      reading. The precheck path now sends p_evidence NULL — the existing
--      COALESCE keeps whatever evidence the row holds. The overwrite stops.
--   3. ONE predicate, public.clone_alert_dns_dead(dns_precheck, evidence):
--        COALESCE(dns_precheck IN ('no_host','servfail'), false)
--        OR COALESCE(evidence->>'status', '') = '400'
--      OR, not "column else evidence": the 400 arm is not only legacy — a real
--      urlscan "could not resolve" refusal still lands there (precheck said
--      host/unknown, urlscan disagreed) and must keep the dead cadence. A row
--      written before v343 has dns_precheck NULL, so it is read exactly as
--      before (NULL-comparison trap: the COALESCE makes NULL false, never
--      NULL). Every function that tested the fake 400 now calls it:
--        list_clone_alerts_for_recheck        (v334 body; dead cadence + v326
--                                              dead-dormancy hold-out)
--        count_clone_recheck_dormant_dead     (v326; twin of the hold-out)
--        reset_clone_alert_dead_dormancy      (v325; month-end reset)
--        list_clone_alerts_pending_urlscan_submit (v315 body; 400 streak
--                                              bypass + 168 h dead cadence,
--                                              clock = the later of
--                                              dns_precheck_at and the
--                                              evidence's attempted_at)
--        clone_watch_urlscan_stranded_count   (v293; submit_lane_retries)
--      Bodies are the prod definitions (pg_get_functiondef, 2026-10-13) with
--      only the dead predicate swapped (and a function-level statement_timeout
--      added where one was missing).
--
-- NOT HERE (open for the founder): restoring the 255 overwritten renders /
-- 23 reputation hits from clone_watch_scan_transitions; and the genuine
-- urlscan-400 overwrite on the recheck path (151 rejected rows had a scan).
--
-- DEPLOY ORDER: apply BEFORE the code merges. The new TS passes
-- p_dns_precheck and selects dns_precheck; against the pre-v343 schema the
-- submit RPC call would 404 (PostgREST: no such signature). The pre-v343 code
-- against the post-v343 schema is fine (the new param defaults NULL).
-- Idempotent: ADD COLUMN IF NOT EXISTS, constraint dropped+added, DROP
-- FUNCTION IF EXISTS on the old 3-arg signature, CREATE OR REPLACE elsewhere.

BEGIN;

-- ── 1. The reading's columns ───────────────────────────────────────────────
ALTER TABLE public.shopfront_clone_alerts
  ADD COLUMN IF NOT EXISTS dns_precheck text,
  ADD COLUMN IF NOT EXISTS dns_precheck_at timestamptz;

ALTER TABLE public.shopfront_clone_alerts
  DROP CONSTRAINT IF EXISTS shopfront_clone_alerts_dns_precheck_check;
ALTER TABLE public.shopfront_clone_alerts
  ADD CONSTRAINT shopfront_clone_alerts_dns_precheck_check
  CHECK (dns_precheck IS NULL OR dns_precheck IN ('host', 'no_host', 'servfail', 'unknown'));

COMMENT ON COLUMN public.shopfront_clone_alerts.dns_precheck IS
  'v343 (#1297): the urlscan submit DNS precheck''s last reading of the Domain DNS State (submitPrecheckOf): host | no_host | servfail | unknown. no_host/servfail = not submitted to urlscan; the row is dead for the dead-domain cadence (clone_alert_dns_dead). NULL = no precheck recorded since v343 (legacy rows: the fake urlscan 400 in urlscan_evidence still decides).';
COMMENT ON COLUMN public.shopfront_clone_alerts.dns_precheck_at IS
  'v343 (#1297): when dns_precheck was read. The submit lane''s dead-cadence clock (with urlscan_evidence.attempted_at for urlscan''s own 400s).';

-- ── 2. The ONE dead predicate ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.clone_alert_dns_dead(
  p_dns_precheck text,
  p_urlscan_evidence jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO ''
AS $function$
  -- Never NULL: a row with neither reading is not dead.
  SELECT COALESCE(p_dns_precheck IN ('no_host', 'servfail'), false)
      OR COALESCE(p_urlscan_evidence ->> 'status', '') = '400';
$function$;

REVOKE ALL ON FUNCTION public.clone_alert_dns_dead(text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clone_alert_dns_dead(text, jsonb) TO service_role;

COMMENT ON FUNCTION public.clone_alert_dns_dead(text, jsonb) IS
  'v343 (#1297): is this clone alert dead for the dead-domain cadence? The submit precheck read no_host/servfail (dns_precheck), OR urlscan refused it with a 400 (urlscan_evidence.status; also every pre-v343 precheck stamp). NULL-safe: never returns NULL. Called by every worklist that used to test status 400.';

-- ── 3. The writer ──────────────────────────────────────────────────────────
-- Signature changes (a 4th param), so the old 3-arg function is dropped first:
-- leaving both would make PostgREST's named-arg call ambiguous.
DROP FUNCTION IF EXISTS public.record_clone_alert_urlscan_submit(bigint, text, jsonb);

CREATE OR REPLACE FUNCTION public.record_clone_alert_urlscan_submit(
  p_alert_id bigint,
  p_urlscan_uuid text,
  p_evidence jsonb DEFAULT NULL::jsonb,
  p_dns_precheck text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
SET statement_timeout TO '30s'
AS $function$
BEGIN
  UPDATE public.shopfront_clone_alerts sca
  SET urlscan_uuid = COALESCE(p_urlscan_uuid, sca.urlscan_uuid),
      -- Only a real submission sets the clock. A NULL uuid means the POST
      -- failed (or the precheck skipped it), so the row was never handed to
      -- urlscan and must not read as in-flight to anything downstream.
      urlscan_submitted_at = CASE
        WHEN p_urlscan_uuid IS NULL THEN sca.urlscan_submitted_at
        ELSE pg_catalog.now()
      END,
      -- v343: the DNS precheck passes NULL here, so a skip never overwrites a
      -- retrieved render or a stored reputation hit.
      urlscan_evidence = COALESCE(p_evidence, sca.urlscan_evidence),
      urlscan_failure_streak = CASE
        WHEN p_urlscan_uuid IS NULL THEN sca.urlscan_failure_streak + 1
        ELSE 0  -- successful submit → clear stale failures (v224)
      END,
      -- v343: the precheck's reading, on every submit that reached it.
      dns_precheck = COALESCE(p_dns_precheck, sca.dns_precheck),
      dns_precheck_at = CASE
        WHEN p_dns_precheck IS NULL THEN sca.dns_precheck_at
        ELSE pg_catalog.now()
      END
  WHERE sca.id = p_alert_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_clone_alert_urlscan_submit(bigint, text, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_clone_alert_urlscan_submit(bigint, text, jsonb, text)
  TO service_role;

COMMENT ON FUNCTION public.record_clone_alert_urlscan_submit(bigint, text, jsonb, text) IS
  'Record a urlscan submit attempt. Stamps urlscan_submitted_at ONLY on success (v272); bumps urlscan_failure_streak on a NULL uuid, resets it on success (v224). v343: p_dns_precheck records the submit DNS precheck reading (dns_precheck + dns_precheck_at); a precheck skip passes p_evidence NULL so existing evidence is kept.';

-- ── 4. Recheck worklist (v334 body; dead predicate swapped) ────────────────
CREATE OR REPLACE FUNCTION public.list_clone_alerts_for_recheck(p_limit integer DEFAULT 50, p_cadence_hours integer DEFAULT 6, p_dead_cadence_hours integer DEFAULT 168)
 RETURNS TABLE(id bigint, candidate_domain text, candidate_url text, lifecycle_state text, urlscan_classification text, recheck_count integer, last_rechecked_at timestamp with time zone, signals jsonb, attribution jsonb, clf_is_clone boolean, clf_confidence real, clf_attack_intent text, clf_clone_tactic text, brand_category text, due_total bigint, first_seen_at timestamp with time zone, recheck_dns_fingerprint text, recheck_dns_checked_at timestamp with time zone, queue_clock_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '30s'
AS $function$
  SELECT
    sca.id, sca.candidate_domain, sca.candidate_url, sca.lifecycle_state,
    sca.urlscan_classification, sca.recheck_count, sca.last_rechecked_at,
    sca.signals, sca.attribution, cwc.is_clone, cwc.confidence,
    cwc.attack_intent, cwc.clone_tactic, kb.brand_category,
    -- v328: rows due in total, computed over the filtered set BEFORE the
    -- LIMIT — the backlog the batch cap leaves, on every returned row.
    pg_catalog.count(*) OVER () AS due_total,
    -- v334: the DNS gate's inputs.
    sca.first_seen_at, sca.recheck_dns_fingerprint, sca.recheck_dns_checked_at,
    clk.at AS queue_clock_at
  FROM public.shopfront_clone_alerts sca
  LEFT JOIN public.clone_watch_classifications cwc ON cwc.alert_id = sca.id
  LEFT JOIN LATERAL (
    SELECT kb2.brand_category FROM public.known_brands kb2
    WHERE kb2.brand_domain = sca.inferred_target_domain LIMIT 1
  ) kb ON true
  -- v330: is this a not-a-clone audit sample still judged is_clone=false?
  LEFT JOIN LATERAL (
    SELECT (cwc.is_clone IS NOT TRUE AND EXISTS (
      SELECT 1 FROM public.clone_watch_not_a_clone_samples nac
      WHERE nac.alert_id = sca.id
    )) AS nac_audit
  ) aud ON true
  -- v334: the queue clock, defined ONCE.
  LEFT JOIN LATERAL (
    SELECT GREATEST(
      CASE WHEN aud.nac_audit THEN COALESCE(sca.last_rechecked_at, sca.urlscan_scanned_at)
           ELSE sca.last_rechecked_at END,
      sca.recheck_dns_checked_at
    ) AS at
  ) clk ON true
  -- v343: the ONE dead predicate (never NULL).
  CROSS JOIN LATERAL (
    SELECT public.clone_alert_dns_dead(sca.dns_precheck, sca.urlscan_evidence) AS dead
  ) dd
  WHERE sca.source = 'nrd'
    AND sca.lifecycle_state IN ('monitoring', 'declined')
    AND sca.first_seen_at > pg_catalog.now() - pg_catalog.make_interval(days => 90)
    -- v326: dead-domain dormancy. Same predicate as
    -- count_clone_recheck_dormant_dead — change both together.
    AND NOT (
      sca.urlscan_uuid IS NULL
      AND sca.urlscan_failure_streak >= 8
      AND dd.dead
    )
    AND (
      clk.at IS NULL
      OR clk.at
         < pg_catalog.now() - pg_catalog.make_interval(
             hours => CASE
               WHEN dd.dead
                 THEN GREATEST(1, p_dead_cadence_hours)
               -- v330: sampled not-a-clones are low-yield — weekly.
               WHEN aud.nac_audit
                 THEN GREATEST(p_cadence_hours, 168)
               -- v317: a row rechecked 8+ times without leaving the pool has
               -- shown nothing to watch for; weekly, not every 6 h.
               WHEN sca.recheck_count >= 8
                 THEN GREATEST(p_cadence_hours, 168)
               -- v326: older than 45 days → daily (79% of flips happen earlier).
               WHEN sca.first_seen_at < pg_catalog.now() - pg_catalog.make_interval(days => 45)
                 THEN GREATEST(p_cadence_hours, 24)
               ELSE GREATEST(1, p_cadence_hours)
             END
           )
    )
  ORDER BY clk.at ASC NULLS FIRST,
           sca.id ASC
  LIMIT GREATEST(1, LEAST(p_limit, 1000));
$function$;

-- ── 5. Dead-dormancy count + reset (v326 / v325 bodies) ────────────────────
CREATE OR REPLACE FUNCTION public.count_clone_recheck_dormant_dead()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '30s'
AS $function$
  SELECT count(*)::integer
  FROM public.shopfront_clone_alerts sca
  WHERE sca.source = 'nrd'
    AND sca.lifecycle_state IN ('monitoring', 'declined')
    AND sca.first_seen_at > pg_catalog.now() - pg_catalog.make_interval(days => 90)
    AND sca.urlscan_uuid IS NULL
    AND sca.urlscan_failure_streak >= 8
    AND public.clone_alert_dns_dead(sca.dns_precheck, sca.urlscan_evidence);
$function$;

CREATE OR REPLACE FUNCTION public.reset_clone_alert_dead_dormancy(p_alert_ids bigint[])
 RETURNS bigint[]
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '30s'
AS $function$
  WITH reset AS (
    UPDATE public.shopfront_clone_alerts sca
    SET urlscan_failure_streak = 0
    WHERE sca.id = ANY (COALESCE(p_alert_ids, '{}'::bigint[]))
      AND sca.urlscan_uuid IS NULL
      AND sca.urlscan_failure_streak >= 8
      AND public.clone_alert_dns_dead(sca.dns_precheck, sca.urlscan_evidence)
    RETURNING sca.id
  )
  SELECT COALESCE(array_agg(id ORDER BY id), '{}'::bigint[]) FROM reset;
$function$;

-- ── 6. Submit worklist (v315 body; dead predicate + clock swapped) ─────────
CREATE OR REPLACE FUNCTION public.list_clone_alerts_pending_urlscan_submit(p_limit integer DEFAULT 30, p_min_confidence real DEFAULT 0.4, p_max_failure_streak integer DEFAULT 3, p_dead_cadence_hours integer DEFAULT 168)
 RETURNS TABLE(id bigint, candidate_url text, candidate_domain text, inferred_target_domain text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
 SET statement_timeout TO '30s'
AS $function$
  WITH bounds AS (
    SELECT
      GREATEST(1, LEAST(p_limit, 100)) AS cap,
      -- One third of every batch is reserved for the oldest eligible rows so
      -- fresh inflow can never again starve the backlog to death (D2).
      GREATEST(1, LEAST(p_limit, 100) / 3) AS stale_slots
  ),
  eligible AS (
    SELECT
      sca.id,
      sca.candidate_url,
      sca.candidate_domain,
      sca.inferred_target_domain,
      sca.first_seen_at
    FROM public.shopfront_clone_alerts sca
    -- v343: dead = the precheck read no_host/servfail OR urlscan said 400;
    -- dead_at = the later of the two readings' clocks (GREATEST skips NULLs).
    CROSS JOIN LATERAL (
      SELECT
        public.clone_alert_dns_dead(sca.dns_precheck, sca.urlscan_evidence) AS dead,
        GREATEST(
          CASE WHEN sca.dns_precheck IN ('no_host', 'servfail')
               THEN sca.dns_precheck_at END,
          CASE WHEN sca.urlscan_evidence ->> 'status' = '400'
               THEN (sca.urlscan_evidence ->> 'attempted_at')::timestamptz END
        ) AS dead_at
    ) dd
    WHERE sca.source = 'nrd'
      AND sca.urlscan_uuid IS NULL
      -- v285 (D1): a dead name is the state we are here to watch — it must
      -- not count toward the death streak. Everything else keeps the
      -- 3-strike rule unchanged.
      AND (
        dd.dead
        OR sca.urlscan_failure_streak < p_max_failure_streak
      )
      -- v285 (D2): 14 days -> 90 days, matching list_clone_alerts_for_recheck.
      AND sca.first_seen_at >= now() - interval '90 days'
      -- v279: a dead name waits out a long cadence before it is offered a
      -- slot again. Not an exclusion — the row returns on its own once the
      -- cadence lapses.
      AND (
        NOT dd.dead
        OR dd.dead_at IS NULL
        OR dd.dead_at < now() - make_interval(hours => GREATEST(1, p_dead_cadence_hours))
      )
      AND EXISTS (
        SELECT 1
        FROM public.clone_watch_classifications c
        WHERE c.alert_id = sca.id
          AND c.is_clone
          AND c.confidence >= p_min_confidence
      )
  ),
  ranked AS (
    SELECT
      e.*,
      row_number() OVER (ORDER BY e.first_seen_at DESC) AS fresh_rank,
      row_number() OVER (ORDER BY e.first_seen_at ASC)  AS stale_rank
    FROM eligible e
  )
  SELECT
    r.id,
    r.candidate_url,
    r.candidate_domain,
    r.inferred_target_domain
  FROM ranked r
  CROSS JOIN bounds b
  WHERE r.stale_rank <= b.stale_slots
     OR r.fresh_rank <= b.cap - b.stale_slots
  ORDER BY
    (r.stale_rank <= b.stale_slots) DESC,
    CASE WHEN r.stale_rank <= b.stale_slots
         THEN r.stale_rank    -- within the reserve: oldest first
         ELSE r.fresh_rank    -- within the remainder: newest first
    END ASC
  LIMIT (SELECT cap FROM bounds);
$function$;

-- ── 7. Stranded count (v293 body; submit_lane_retries swapped) ─────────────
CREATE OR REPLACE FUNCTION public.clone_watch_urlscan_stranded_count(p_max_failure_streak integer DEFAULT 3)
 RETURNS TABLE(stranded_total bigint, stranded_streak bigint, stranded_submitted_no_uuid bigint, stranded_uuid_no_submitted_at bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
 SET statement_timeout TO '30s'
AS $function$
  WITH scoped AS (
    SELECT
      sca.*,
      (sca.lifecycle_state IN ('monitoring', 'declined')
        AND sca.first_seen_at >= now() - interval '90 days')  AS recheck_lane_retries,
      (sca.urlscan_uuid IS NULL
        AND sca.first_seen_at >= now() - interval '90 days'
        AND (
          public.clone_alert_dns_dead(sca.dns_precheck, sca.urlscan_evidence)
          OR sca.urlscan_failure_streak < p_max_failure_streak
        ))                                                    AS submit_lane_retries,
      (sca.lifecycle_state IN ('taken_down', 'weaponised'))   AS terminal
    FROM public.shopfront_clone_alerts sca
    WHERE sca.source = 'nrd'
      AND sca.lifecycle_state <> 'dormant'
  ),
  flagged AS (
    SELECT
      s.*,
      (s.urlscan_failure_streak >= p_max_failure_streak
        AND s.urlscan_classification IS NULL
        AND NOT s.recheck_lane_retries
        AND NOT s.submit_lane_retries
        AND NOT s.terminal)                       AS is_streak_frozen,
      (s.urlscan_submitted_at IS NOT NULL
        AND s.urlscan_uuid IS NULL
        AND s.urlscan_scanned_at IS NULL
        AND NOT s.recheck_lane_retries
        AND NOT s.submit_lane_retries
        AND NOT s.terminal)                       AS is_submitted_no_uuid,
      (s.urlscan_uuid IS NOT NULL
        AND s.urlscan_submitted_at IS NULL
        AND s.urlscan_classification IS NULL
        AND NOT s.recheck_lane_retries
        AND NOT s.terminal)                       AS is_uuid_no_submitted_at
    FROM scoped s
  )
  SELECT
    count(*) FILTER (
      WHERE f.is_streak_frozen
         OR f.is_submitted_no_uuid
         OR f.is_uuid_no_submitted_at
    ),
    count(*) FILTER (WHERE f.is_streak_frozen),
    count(*) FILTER (WHERE f.is_submitted_no_uuid),
    count(*) FILTER (WHERE f.is_uuid_no_submitted_at)
  FROM flagged f;
$function$;

-- CREATE OR REPLACE keeps each function's ACL; restated so the file is the
-- whole truth (migration lint, supabase/CLAUDE.md §7).
REVOKE ALL ON FUNCTION public.list_clone_alerts_for_recheck(integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_clone_alerts_for_recheck(integer, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.count_clone_recheck_dormant_dead() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_clone_recheck_dormant_dead() TO service_role;
REVOKE ALL ON FUNCTION public.reset_clone_alert_dead_dormancy(bigint[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_clone_alert_dead_dormancy(bigint[]) TO service_role;
REVOKE ALL ON FUNCTION public.list_clone_alerts_pending_urlscan_submit(integer, real, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_clone_alerts_pending_urlscan_submit(integer, real, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.clone_watch_urlscan_stranded_count(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clone_watch_urlscan_stranded_count(integer) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
