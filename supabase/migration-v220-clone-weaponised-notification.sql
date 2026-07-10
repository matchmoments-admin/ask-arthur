-- v220: Weaponised-clone brand notification — queue `kind` + urgent enqueue RPC.
--
-- F1 of docs/plans/clone-watch-brand-value-features.md: when a monitored
-- lookalike flips declined/monitoring → weaponised (urlscan likely_phishing),
-- a new Inngest consumer (clone-watch-notify-weaponised) stages an URGENT
-- single-alert batch for the existing four-eyes dashboard send — instead of
-- waiting for the routine daily digest.
--
-- Why schema change is needed (technical uncertainty resolved 2026-07-10):
-- the v150 queue has UNIQUE (alert_id, channel_type) and the enqueue RPC
-- merges on conflict WITHOUT resetting approval_status. The core F1 case is
-- an alert that was already brand-notified at triage time and weaponises
-- WEEKS later — its queue row is 'sent', so a plain re-enqueue merges into
-- the sent row and assign_clone_alert_batch (which only touches 'unbatched'
-- rows) updates 0 rows: the urgent alert would silently never stage.
--
-- Fix: a `kind` discriminator ('routine' | 'weaponised') with two partial
-- unique indexes replacing the table UNIQUE:
--   * (alert_id, channel_type) WHERE kind='routine'   — v150 semantics kept
--   * (alert_id)               WHERE kind='weaponised' — ONE urgent alert per
--     clone, ever (the weaponised event can fire per `via`; this collapses it)
--
-- Ordering note: the routine partial index is created BEFORE the table
-- constraint is dropped so uniqueness protection never lapses, and
-- enqueue_clone_alert_notification is re-pointed at the partial index IN THIS
-- MIGRATION — after the constraint drop the old ON CONFLICT (alert_id,
-- channel_type) arbiter would error at call time ("no unique or exclusion
-- constraint matching the ON CONFLICT specification").
--
-- Also: list_clone_alerts_unbatched_for_prepare now returns kind='routine'
-- rows only, so the 09:30 daily prepare cron can never scoop a weaponised
-- row into a routine digest between the consumer's enqueue and assign steps.
--
-- Idempotent throughout. Rollback: weaponised rows are inert without the
-- consumer (flag FF_CLONE_WEAPONISED_ALERT default OFF); reverse script is
-- DROP INDEX the two partials + re-ADD the table UNIQUE + re-apply v150/v151
-- function bodies.

-- ── 1. kind discriminator ────────────────────────────────────────────────

ALTER TABLE public.clone_alert_notification_queue
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'routine'
    CHECK (kind IN ('routine', 'weaponised'));

COMMENT ON COLUMN public.clone_alert_notification_queue.kind IS
  'routine = daily digest flow (v150 semantics). weaponised = urgent single-alert batch staged immediately by clone-watch-notify-weaponised (v220); excluded from the daily prepare worklist.';

-- ── 2. Replace table UNIQUE with kind-scoped partial unique indexes ──────

-- Create the routine index first so uniqueness never lapses.
CREATE UNIQUE INDEX IF NOT EXISTS uq_clone_notif_routine
  ON public.clone_alert_notification_queue (alert_id, channel_type)
  WHERE kind = 'routine';

ALTER TABLE public.clone_alert_notification_queue
  DROP CONSTRAINT IF EXISTS clone_alert_notification_queue_alert_id_channel_type_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_clone_notif_weaponised
  ON public.clone_alert_notification_queue (alert_id)
  WHERE kind = 'weaponised';

-- ── 3. Re-point the routine enqueue RPC at the partial index ─────────────
-- Body change only vs v150: ON CONFLICT gains `WHERE kind = 'routine'`.

CREATE OR REPLACE FUNCTION public.enqueue_clone_alert_notification(
  p_alert_id bigint,
  p_brand text,
  p_candidate_domain text,
  p_candidate_url text,
  p_recipient text,
  p_channel_type text,
  p_severity_tier text,
  p_scheduled_for timestamptz
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_id bigint;
BEGIN
  IF p_channel_type NOT IN ('security_txt','fraud_inbox') THEN
    RAISE EXCEPTION 'invalid channel_type: %', p_channel_type USING ERRCODE = '22023';
  END IF;
  IF p_severity_tier NOT IN ('low','medium','high','critical') THEN
    RAISE EXCEPTION 'invalid severity_tier: %', p_severity_tier USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.clone_alert_notification_queue
    (alert_id, brand, candidate_domain, candidate_url, recipient,
     channel_type, severity_tier, scheduled_for)
  VALUES
    (p_alert_id, p_brand, p_candidate_domain, p_candidate_url, p_recipient,
     p_channel_type, p_severity_tier, p_scheduled_for)
  ON CONFLICT (alert_id, channel_type) WHERE kind = 'routine' DO UPDATE SET
    severity_tier = EXCLUDED.severity_tier,
    scheduled_for = EXCLUDED.scheduled_for,
    status = CASE
      WHEN clone_alert_notification_queue.status = 'sent'
        THEN clone_alert_notification_queue.status
      ELSE 'pending'
    END
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enqueue_clone_alert_notification(bigint, text, text, text, text, text, text, timestamptz)
  FROM anon, authenticated;

-- ── 4. Urgent enqueue RPC for the weaponised consumer ────────────────────
-- One row per alert_id ever (partial index). ON CONFLICT DO NOTHING +
-- explicit re-select so the caller can distinguish first-enqueue from an
-- idempotent replay (Inngest retries, initial-then-recheck double fire).

CREATE OR REPLACE FUNCTION public.enqueue_weaponised_clone_alert_notification(
  p_alert_id bigint,
  p_brand text,
  p_candidate_domain text,
  p_candidate_url text,
  p_recipient text,
  p_channel_type text
)
RETURNS TABLE (queue_id bigint, inserted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
#variable_conflict use_column
DECLARE
  v_id bigint;
BEGIN
  IF p_channel_type NOT IN ('security_txt','fraud_inbox') THEN
    RAISE EXCEPTION 'invalid channel_type: %', p_channel_type USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.clone_alert_notification_queue
    (alert_id, brand, candidate_domain, candidate_url, recipient,
     channel_type, severity_tier, scheduled_for, kind)
  VALUES
    (p_alert_id, p_brand, p_candidate_domain, p_candidate_url, p_recipient,
     p_channel_type, 'critical', now(), 'weaponised')
  ON CONFLICT (alert_id) WHERE kind = 'weaponised' DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, true;
    RETURN;
  END IF;

  SELECT q.id INTO v_id
  FROM public.clone_alert_notification_queue q
  WHERE q.alert_id = p_alert_id AND q.kind = 'weaponised';
  RETURN QUERY SELECT v_id, false;
END;
$$;

-- NEW function: revoke from PUBLIC too — CREATE FUNCTION grants EXECUTE to
-- PUBLIC by default, and anon/authenticated inherit it (the security advisor
-- flagged exactly this on first apply). The replaced functions above keep
-- their pre-v220 ACLs (CREATE OR REPLACE preserves grants).
REVOKE EXECUTE ON FUNCTION public.enqueue_weaponised_clone_alert_notification(bigint, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.enqueue_weaponised_clone_alert_notification(bigint, text, text, text, text, text) IS
  'Enqueue the ONE urgent weaponised-clone notification row for an alert (kind=weaponised, severity critical, scheduled now). inserted=false means a prior enqueue exists — the caller treats that as an idempotent replay. Used by clone-watch-notify-weaponised (FF_CLONE_WEAPONISED_ALERT).';

-- ── 5. Daily prepare worklist: routine rows only ─────────────────────────
-- Same signature + return shape as v151; adds `AND q.kind = 'routine'`.

CREATE OR REPLACE FUNCTION public.list_clone_alerts_unbatched_for_prepare(
  p_limit int DEFAULT 500
)
RETURNS TABLE (
  id bigint,
  alert_id bigint,
  brand text,
  candidate_domain text,
  candidate_url text,
  recipient text,
  channel_type text,
  severity_tier text,
  enqueued_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
  SELECT q.id, q.alert_id, q.brand, q.candidate_domain, q.candidate_url,
         q.recipient, q.channel_type, q.severity_tier, q.enqueued_at
  FROM public.clone_alert_notification_queue q
  WHERE q.approval_status = 'unbatched'
    AND q.kind = 'routine'
    AND q.scheduled_for <= now()
  ORDER BY q.brand, q.recipient, q.enqueued_at ASC
  LIMIT GREATEST(1, LEAST(p_limit, 2000));
$$;

REVOKE EXECUTE ON FUNCTION public.list_clone_alerts_unbatched_for_prepare(int)
  FROM anon, authenticated;
