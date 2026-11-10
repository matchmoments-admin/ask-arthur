-- migration-v346-persist-urlscan-stamps-triage-source.sql — the urlscan
-- writer of triage_status stamps who set it, and a machine may only ever
-- park or action (#1301, child of map #1294).
--
-- WHY. triage_status has four writers and, until this change, no written
-- spec. The spec now lives at apps/web/lib/clone-watch/triage.ts (beside
-- lifecycle.ts). triage_source (v335) records who set the CURRENT status.
-- Three writers stamp it:
--   - set_clone_alert_triage (v335): p_source (the admin route = 'human')
--   - auto-park (apps/web/lib/clone-watch/auto-park.ts): 'machine'
--   - merge_clone_alert_submission (v338): 'machine' on a change, except
--     tp_confirmed → tp_actioned (Netcraft executing a human verdict)
-- The fourth, persist_clone_alert_urlscan (v307), moves pending /
-- needs_investigation / NULL → needs_investigation when a scan reads
-- parked_for_sale or unresolved, and stamps nothing. The row then carries
-- the PREVIOUS writer's triage_source and triage_at under a status a machine
-- set. If that previous writer was a human (say an operator un-parked a row
-- to pending, and the recheck later found it parked again),
-- clone_watch_readiness_inputs (v335) counts the machine's deferral as
-- human_deferred inside the human's triage_at month.
--
-- MEASURED 2026-10-13 (prod, read-only):
--   - human_deferred inflated by this writer: 0 rows in the last 30 days,
--     0 in 90, 1 all-time (id 469, triage_at 2026-05-27, no admin and no
--     note; its scan classification is now NULL, so whether a scan set its
--     status is unknowable — no status history). Latent, like v338 was: the
--     path needs a human status on the row first, and there are ZERO rows
--     with triage_source = 'human' — no operator verdict has been recorded
--     since v335. The first one arms the bug, which is why it ships now.
--   - 3 rows are needs_investigation with triage_at NULL and source NULL
--     (ids 3826, 3833, 3849, all lifecycle monitoring, 2 still
--     parked_for_sale). Only this function writes needs_investigation
--     without triage_at, so they are its writes; backfilled to 'machine'
--     below. They were never counted (no triage_at), so no scorecard moves.
--
-- WHAT CHANGES
--   1. persist_clone_alert_urlscan, re-created from its LIVE prod body
--      (pg_get_functiondef 2026-10-13, identical to v307 apart from
--      formatting):
--      - when it CHANGES triage_status it stamps triage_source = 'machine'
--        (the v338 rule; unchanged status keeps its origin, a decided row
--        is still never touched). triage_at is untouched, as merge does:
--        the source is what excludes the row from the human counts.
--      - p_set_triage_status accepts only NULL or 'needs_investigation'
--        (was any of the five statuses). The only caller that passes one is
--        urlscan-retrieve via suggestTriageTransition, which returns exactly
--        that or null; anything else would be a machine verdict, which the
--        CHECK below forbids — this raises the clear error first.
--      - function-level SET statement_timeout = '30s' (supabase/CLAUDE.md
--        §4: it runs from Inngest through .rpc(), under authenticator's 8 s
--        until now; the in-file SET LOCAL of v307 was decorative for calls).
--   2. CHECK shopfront_clone_alerts_machine_triage_status_check: a row whose
--      status a machine set is needs_investigation or tp_actioned. Machines
--      park and action; tp_confirmed, fp and pending (a reset) are human
--      decisions. Verified 2026-10-13: 0 of 4,094 rows violate it (62
--      machine rows: 42 needs_investigation, 20 tp_actioned).
--      WHY A CHECK AND NOT A LOG. A CHECK cannot see the old row, so it
--      guards who-may-write-what, not every transition; the per-writer
--      from-states are guarded inside each writer (persist and merge skip
--      decided rows; auto-park filters pending in its UPDATE) and stated in
--      triage.ts with tests. A log trigger (the v339 shape) would add a write
--      to every UPDATE of a table nine crons update, to measure moves that
--      the writers already refuse; the one rule no writer enforced — that a
--      machine never issues a verdict — is a property of the row, which a
--      CHECK makes impossible for free. Revisit with a log if triage.ts
--      grows a writer whose from-states the SQL cannot pin.
--
-- Signature unchanged → CREATE OR REPLACE keeps the ACL; REVOKE/GRANT
-- restated (§7). Idempotent: CREATE OR REPLACE; DROP CONSTRAINT IF EXISTS
-- before ADD; the backfill touches only NULL-source rows.
-- Rollback: re-apply v307's persist_clone_alert_urlscan, and
--   ALTER TABLE public.shopfront_clone_alerts
--     DROP CONSTRAINT IF EXISTS shopfront_clone_alerts_machine_triage_status_check;
-- (the 3 backfilled stamps are correct either way).

BEGIN;

CREATE OR REPLACE FUNCTION public.persist_clone_alert_urlscan(
  p_alert_id bigint,
  p_urlscan_uuid text,
  p_urlscan_evidence jsonb,
  p_classification text,
  p_set_triage_status text DEFAULT NULL
)
RETURNS TABLE (
  id bigint,
  urlscan_classification text,
  triage_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s'
AS $$
#variable_conflict use_column
DECLARE
  v_found boolean;
  v_prior_classification text;
  v_prior_evidence jsonb;
  v_prior_lifecycle_state text;
  v_prior_urlscan_submitted_at timestamptz;
BEGIN
  IF p_classification IS NOT NULL
     AND p_classification NOT IN ('parked_for_sale','unresolved','likely_phishing','neutral') THEN
    RAISE EXCEPTION 'invalid urlscan classification: %', p_classification
      USING ERRCODE = '22023';
  END IF;
  -- v346: a scan may only PARK (triage.ts, "persist" writer). A verdict is
  -- a human's.
  IF p_set_triage_status IS NOT NULL
     AND p_set_triage_status <> 'needs_investigation' THEN
    RAISE EXCEPTION 'invalid triage status for a scan: % (only needs_investigation)', p_set_triage_status
      USING ERRCODE = '22023';
  END IF;

  -- Snapshot prior values under the row lock. FOR UPDATE serialises this fn
  -- with apply_clone_urlscan_verdict (v200), which locks the same row.
  SELECT sca.urlscan_classification, sca.urlscan_evidence,
         sca.lifecycle_state, sca.urlscan_submitted_at
    INTO v_prior_classification, v_prior_evidence,
         v_prior_lifecycle_state, v_prior_urlscan_submitted_at
    FROM public.shopfront_clone_alerts sca
   WHERE sca.id = p_alert_id
     FOR UPDATE;
  v_found := FOUND;

  RETURN QUERY
  UPDATE public.shopfront_clone_alerts sca
  SET urlscan_uuid = COALESCE(p_urlscan_uuid, sca.urlscan_uuid),
      urlscan_evidence = COALESCE(p_urlscan_evidence, sca.urlscan_evidence),
      urlscan_classification = COALESCE(p_classification, sca.urlscan_classification),
      -- A failed rescan must remain newer than the last completed scan.
      urlscan_scanned_at = CASE WHEN p_classification IS NOT NULL
                               THEN now() ELSE sca.urlscan_scanned_at END,
      -- A null classification means the scan failed (submit_failed /
      -- retrieval_timeout). Count the streak; a successful scan resets it.
      urlscan_failure_streak = CASE
        WHEN p_classification IS NULL THEN sca.urlscan_failure_streak + 1
        ELSE 0
      END,
      -- Never demote: if a row is already tp_confirmed/tp_actioned/fp,
      -- the operator has decided — don't let auto-classify revert it.
      -- Only apply the suggested transition when the row is still pending
      -- or needs_investigation.
      triage_status = CASE
        WHEN sca.triage_status IN ('tp_confirmed','tp_actioned','fp')
          THEN sca.triage_status
        WHEN p_set_triage_status IS NULL
          THEN sca.triage_status
        ELSE p_set_triage_status
      END,
      -- v346 (#1301): a status this function CHANGES was set by a machine.
      -- Same guards as triage_status above, then IS DISTINCT FROM so an
      -- unchanged status (or a NULL prior one being set) is judged right.
      -- sca.* in a SET list is the OLD row.
      triage_source = CASE
        WHEN sca.triage_status IN ('tp_confirmed','tp_actioned','fp')
          THEN sca.triage_source
        WHEN p_set_triage_status IS NULL
          THEN sca.triage_source
        WHEN p_set_triage_status IS DISTINCT FROM sca.triage_status
          THEN 'machine'
        ELSE sca.triage_source
      END
  WHERE sca.id = p_alert_id
  RETURNING sca.id, sca.urlscan_classification, sca.triage_status;

  -- Transition-only archive (v230). Guarded on v_found so a nonexistent
  -- alert id stays the silent no-op it always was (no FK violation).
  IF v_found
     AND p_classification IS NOT NULL
     AND p_classification IS DISTINCT FROM v_prior_classification THEN
    INSERT INTO public.clone_watch_scan_transitions
      (alert_id, prior_classification, new_classification,
       prior_evidence, new_evidence, lifecycle_state_at_scan,
       urlscan_uuid, urlscan_submitted_at, scanned_at)
    VALUES
      (p_alert_id, v_prior_classification, p_classification,
       v_prior_evidence, p_urlscan_evidence, v_prior_lifecycle_state,
       p_urlscan_uuid, v_prior_urlscan_submitted_at, now())
    ON CONFLICT (alert_id, COALESCE(urlscan_uuid, ''), new_classification)
    DO NOTHING;
  END IF;
  -- Same transaction and row lock as the verdict/archive write. Any failure
  -- rolls everything back, keeping this submission eligible for retrieval.
  IF v_found AND p_classification IS NOT NULL THEN
    PERFORM public.apply_clone_urlscan_verdict(p_alert_id, p_classification);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_clone_alert_urlscan(bigint, text, jsonb, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_clone_alert_urlscan(bigint, text, jsonb, text, text)
  TO service_role;

COMMENT ON FUNCTION public.persist_clone_alert_urlscan(bigint, text, jsonb, text, text) IS
  'v346 (#1301): as v307 (atomic verdict, archive and lifecycle), plus: a triage_status change made here stamps triage_source = ''machine''; p_set_triage_status accepts only needs_investigation. Spec: apps/web/lib/clone-watch/triage.ts.';

-- ── Backfill: this function's past unstamped writes (3 rows, 2026-10-13) ──
UPDATE public.shopfront_clone_alerts
   SET triage_source = 'machine'
 WHERE triage_status = 'needs_investigation'
   AND triage_at IS NULL
   AND triage_source IS NULL;

-- ── A machine parks or actions; it never issues a verdict ─────────────────
ALTER TABLE public.shopfront_clone_alerts
  DROP CONSTRAINT IF EXISTS shopfront_clone_alerts_machine_triage_status_check;
ALTER TABLE public.shopfront_clone_alerts
  ADD CONSTRAINT shopfront_clone_alerts_machine_triage_status_check
  CHECK (
    triage_source IS DISTINCT FROM 'machine'
    OR triage_status IN ('needs_investigation', 'tp_actioned')
  );

COMMENT ON COLUMN public.shopfront_clone_alerts.triage_source IS
  'v335 (#1237), v346 (#1301): who set the current triage_status — human (set_clone_alert_triage from the admin triage route) or machine (auto-park, merge_clone_alert_submission on a change other than tp_confirmed→tp_actioned, persist_clone_alert_urlscan on a change). NULL = written before v335; judged by note marker. A machine row is needs_investigation or tp_actioned (CHECK). Spec: apps/web/lib/clone-watch/triage.ts.';

COMMIT;
