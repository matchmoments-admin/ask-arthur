-- v201 — clone enforcement case model
--        (Wave 1 PR 1.1 of docs/plans/clone-watch-enforcement-and-monetisation.md)
--
-- WHY: Netcraft browser-block is ONE lever and it declines parked lookalikes.
-- The enterprise product — what SPF brand-protection buyers actually pay for —
-- is the audit-ready, MULTI-CHANNEL enforcement case record: which levers we
-- pulled, when, what each said, and what re-emerged. shopfront_takedown_attempts
-- (v140) was scaffolded for exactly this and has sat UNUSED (0 rows). v140 is a
-- draft email log — 4 channel types, no workflow lifecycle, no external ref, no
-- SLA, no re-emergence. This migration evolves it FORWARD into the case model
-- (never edits v140 — supabase/CLAUDE.md rule 1). Not a hot table, no chunking.
--
-- The case lifecycle (this table) is DISTINCT from the alert lifecycle
-- (shopfront_clone_alerts.lifecycle_state, v199): one alert (domain) can have
-- many cases (one per enforcement channel). The alert machine answers "is this
-- domain weaponised"; the case machine answers "did we pull lever X, is it
-- approved / sent / actioned / re-emerged".
--
-- CRITICAL invariant (itch.io false-takedown precedent): domain-level levers
-- (registrar/host/CF/UDRP) are NEVER auto — channel_autonomy gates that, and the
-- verification_checklist captures the human confirmation. Only reversible
-- browser-block channels (GSB/SmartScreen/APWG) may be 'auto'.
--
-- Idempotent + re-appliable.

-- ── 1. Widen the channel enum (additive; CHECK, not a pg ENUM) ────────────
ALTER TABLE public.shopfront_takedown_attempts
  DROP CONSTRAINT IF EXISTS shopfront_takedown_attempts_attempt_type_check;
ALTER TABLE public.shopfront_takedown_attempts
  ADD CONSTRAINT shopfront_takedown_attempts_attempt_type_check
  CHECK (attempt_type IN (
    'dmca', 'registrar_abuse', 'cloudflare_host_abuse', 'shopify_dmca',   -- v140 originals
    'hosting_abuse', 'safe_browsing', 'smartscreen', 'apwg', 'openphish', -- browser-block / blocklist
    'udrp_bundle', 'audrp_bundle', 'brand_security_handoff'               -- trademark / brand-routed
  ));

-- ── 2. Case lifecycle columns (additive) ─────────────────────────────────
ALTER TABLE public.shopfront_takedown_attempts
  ADD COLUMN IF NOT EXISTS channel_autonomy TEXT NOT NULL DEFAULT 'human_required'
    CHECK (channel_autonomy IN ('auto', 'human_required', 'brand_routed')),
  ADD COLUMN IF NOT EXISTS case_status TEXT NOT NULL DEFAULT 'queued'
    CHECK (case_status IN (
      'queued', 'drafted', 'pending_approval', 'submitted', 'acknowledged',
      'actioned', 'rejected', 're_emerged', 'closed', 'skipped'
    )),
  ADD COLUMN IF NOT EXISTS acts_on_parked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS external_ref TEXT,                 -- registrar ticket / WIPO case no / GSB id
  ADD COLUMN IF NOT EXISTS evidence_bundle JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS verification_checklist JSONB,      -- the itch.io-guard human confirmations
  ADD COLUMN IF NOT EXISTS approved_by_user_id UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,          -- distinct from v140 sent_at (email drafts)
  ADD COLUMN IF NOT EXISTS next_action_at TIMESTAMPTZ,        -- SLA / re-check clock
  ADD COLUMN IF NOT EXISTS last_reemergence_check_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- v140 made body_md + template_version NOT NULL — but the auto/blocklist
-- channels (GSB/SmartScreen/APWG) submit a URL, not an email body. Relax so the
-- executor can insert those cases. (Table is empty, so no backfill needed.)
ALTER TABLE public.shopfront_takedown_attempts ALTER COLUMN body_md DROP NOT NULL;
ALTER TABLE public.shopfront_takedown_attempts ALTER COLUMN template_version DROP NOT NULL;

-- ── 3. Indexes ───────────────────────────────────────────────────────────
-- One OPEN case per (alert, channel) — dedupe like onward_report_log (v119).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_takedown_alert_channel_open
  ON public.shopfront_takedown_attempts (clone_alert_id, attempt_type)
  WHERE case_status NOT IN ('closed', 'rejected', 'skipped');

-- Worklist for the executor + re-emergence cron.
CREATE INDEX IF NOT EXISTS idx_takedown_next_action
  ON public.shopfront_takedown_attempts (case_status, next_action_at)
  WHERE case_status IN ('submitted', 'acknowledged', 'actioned', 're_emerged');

-- ── 4. RPC — atomic upsert/merge of a case (mirrors merge_clone_alert_submission) ─
-- Opens or updates the single open case for (alert, channel), merging the
-- evidence bundle and setting the status. Avoids lost-update races when the
-- plan + execute Inngest steps run concurrently on one alert.
CREATE OR REPLACE FUNCTION public.merge_takedown_case(
  p_alert_id bigint,
  p_channel text,
  p_autonomy text,
  p_acts_on_parked boolean DEFAULT false,
  p_status text DEFAULT NULL,           -- NULL = leave status unchanged on update
  p_evidence jsonb DEFAULT NULL,        -- merged into evidence_bundle
  p_external_ref text DEFAULT NULL,
  p_next_action_at timestamptz DEFAULT NULL
)
RETURNS bigint                          -- the case id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_case_id bigint;
BEGIN
  IF p_evidence IS NOT NULL AND jsonb_typeof(p_evidence) <> 'object' THEN
    RAISE EXCEPTION 'merge_takedown_case: p_evidence must be a jsonb object, got %',
      jsonb_typeof(p_evidence) USING ERRCODE = '22023';
  END IF;

  -- Lock the open case for this (alert, channel), if any.
  SELECT id INTO v_case_id
  FROM public.shopfront_takedown_attempts
  WHERE clone_alert_id = p_alert_id
    AND attempt_type = p_channel
    AND case_status NOT IN ('closed', 'rejected', 'skipped')
  FOR UPDATE;

  IF v_case_id IS NULL THEN
    INSERT INTO public.shopfront_takedown_attempts (
      clone_alert_id, attempt_type, initiated_by, channel_autonomy,
      acts_on_parked, case_status, evidence_bundle, external_ref,
      next_action_at, submitted_at, drafted_at
    ) VALUES (
      p_alert_id, p_channel, 'askarthur_ops', p_autonomy,
      p_acts_on_parked, COALESCE(p_status, 'queued'),
      COALESCE(p_evidence, '{}'::jsonb), p_external_ref, p_next_action_at,
      -- a case opened directly in 'submitted' (the auto-channel path) stamps
      -- submitted_at now; otherwise it's stamped on the later submit transition.
      CASE WHEN p_status = 'submitted' THEN now() ELSE NULL END, now()
    )
    RETURNING id INTO v_case_id;
  ELSE
    UPDATE public.shopfront_takedown_attempts
    SET case_status     = COALESCE(p_status, case_status),
        evidence_bundle = CASE WHEN p_evidence IS NULL THEN evidence_bundle
                               ELSE evidence_bundle || p_evidence END,
        external_ref    = COALESCE(p_external_ref, external_ref),
        next_action_at  = COALESCE(p_next_action_at, next_action_at),
        submitted_at    = CASE WHEN p_status = 'submitted'
                               THEN COALESCE(submitted_at, now()) ELSE submitted_at END,
        updated_at      = now()
    WHERE id = v_case_id;
  END IF;

  RETURN v_case_id;
END
$$;

REVOKE EXECUTE ON FUNCTION public.merge_takedown_case(bigint, text, text, boolean, text, jsonb, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_takedown_case(bigint, text, text, boolean, text, jsonb, text, timestamptz)
  TO service_role;

COMMENT ON TABLE public.shopfront_takedown_attempts IS
  'Multi-channel enforcement case log (v201). One case per (clone_alert, channel). case_status is the workflow lifecycle; channel_autonomy gates auto vs human_required vs brand_routed. See docs/plans/clone-watch-enforcement-and-monetisation.md Wave 1.';
