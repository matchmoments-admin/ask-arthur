-- v230: clone_watch_scan_transitions — transition-only urlscan evidence archive
--
-- CONTEXT. urlscan evidence on shopfront_clone_alerts is overwritten in place on
-- every rescan (persist_clone_alert_urlscan, live body v169; the v224 submit RPC
-- record_clone_alert_urlscan_submit also overwrites urlscan_evidence with the
-- submit-stage stub). When a clone flips parked/neutral -> likely_phishing
-- (weaponisation), the "before" state is destroyed — we know WHEN it flipped
-- (weaponised_at) but not WHAT changed. The v199 evidence slots (dom_hash /
-- visual_hash / content_diff_at) are reserved but nothing computes them.
--
-- FIX. Append-only archive of classification TRANSITIONS: a row is written only
-- when urlscan_classification changes value (including NULL -> first
-- classification). Classification changes are rare (~handful/day worst case),
-- so this table stays tiny — no retention policy; revisit at >10k rows.
-- Capture point is INSIDE persist_clone_alert_urlscan: it is the only writer of
-- urlscan_classification in the codebase, and it is the one place where prior
-- and new values are visible in a single transaction (app-side capture would be
-- a racy read-before-write and would miss the reputation-fallback caller).
--
-- Downstream readers (shipping in the follow-up report PRs): detection-lag
-- (scanned_at - urlscan_submitted_at WHERE new_classification='likely_phishing')
-- and the before/after weaponisation research. Readers must tolerate an empty
-- table — data accrues only from deploy time.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE + IF NOT EXISTS
-- index. Function signature and RETURNS shape unchanged from v169 — zero caller
-- changes.

-- 1. The append-only archive table.
CREATE TABLE IF NOT EXISTS public.clone_watch_scan_transitions (
  id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alert_id                bigint NOT NULL
                            REFERENCES public.shopfront_clone_alerts(id)
                            ON DELETE CASCADE,
  prior_classification    text,             -- NULL = first-ever classification
  new_classification      text NOT NULL,
  prior_evidence          jsonb,
  new_evidence            jsonb,
  lifecycle_state_at_scan text,             -- state BEFORE apply_clone_urlscan_verdict
                                            -- runs; the resulting state is derivable
                                            -- from the v200 edge table (single-writer
                                            -- by design — v200 does not touch this row)
  urlscan_uuid            text,             -- uuid of the flipping scan (NULL possible
                                            -- on the reputation-fallback path)
  urlscan_submitted_at    timestamptz,      -- snapshot at persist time; detection-lag
                                            -- numerator (scanned_at - this)
  scanned_at              timestamptz NOT NULL DEFAULT now(),
  created_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.clone_watch_scan_transitions IS
  'Append-only archive of urlscan classification transitions on shopfront_clone_alerts (written by persist_clone_alert_urlscan only when the classification value changes). NOTE: prior_evidence at persist time is usually the v224 submit-stage stub (submit overwrites urlscan_evidence before retrieval); the previous FULL render lives in the previous transition row''s new_evidence — the chain reconstructs history. No retention; revisit at >10k rows.';

COMMENT ON COLUMN public.clone_watch_scan_transitions.lifecycle_state_at_scan IS
  'lifecycle_state of the alert at persist time, BEFORE apply_clone_urlscan_verdict applies the v200 edge (likely_phishing + {detected,monitoring,declined} -> weaponised, etc.).';

ALTER TABLE public.clone_watch_scan_transitions ENABLE ROW LEVEL SECURITY;

-- Service-role only (bypasses RLS); no anon/authenticated policies = deny by
-- default. Mirrors the v189/v193 clone-watch summary-table posture.
REVOKE ALL ON public.clone_watch_scan_transitions FROM anon, authenticated;

-- 2. Dedup guard for Inngest replays: a re-run of a retrieve step that already
--    committed must not double-insert. COALESCE sidesteps NULL-uuid rows not
--    deduping. Legitimate A->B->A->B oscillation still records every flip
--    because each rescan carries a fresh urlscan_uuid. This one index also
--    serves the FK-delete check and per-alert history lookups.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cw_scan_transitions_dedup
  ON public.clone_watch_scan_transitions
  (alert_id, COALESCE(urlscan_uuid, ''), new_classification);

-- 3. persist_clone_alert_urlscan — v169 body plus transition capture.
--    Signature + RETURNS TABLE unchanged (CREATE OR REPLACE, no DROP, zero
--    caller changes). New behaviour: snapshot prior values FOR UPDATE (also
--    serialises with apply_clone_urlscan_verdict's own FOR UPDATE, v200), run
--    the existing UPDATE verbatim, then archive iff the classification value
--    actually changed. A NULL p_classification (failed scan) never archives —
--    it also never changes the stored classification (COALESCE keeps it).
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
AS $$
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
  IF p_set_triage_status IS NOT NULL
     AND p_set_triage_status NOT IN ('pending','tp_confirmed','fp','needs_investigation','tp_actioned') THEN
    RAISE EXCEPTION 'invalid triage status: %', p_set_triage_status USING ERRCODE = '22023';
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
      urlscan_scanned_at = now(),
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
END;
$$;

REVOKE EXECUTE ON FUNCTION public.persist_clone_alert_urlscan(bigint, text, jsonb, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_clone_alert_urlscan(bigint, text, jsonb, text, text)
  TO service_role;

COMMENT ON FUNCTION public.persist_clone_alert_urlscan(bigint, text, jsonb, text, text) IS
  'Persist urlscan.io scan result + auto-classification. Never demotes an operator-triaged row (tp_confirmed/tp_actioned/fp). Maintains urlscan_failure_streak: +1 on a failed scan (classification NULL), reset to 0 on success. v230: archives a clone_watch_scan_transitions row when the classification value changes.';
