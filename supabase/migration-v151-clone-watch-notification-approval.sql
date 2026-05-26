-- v151: Clone-watch notification approval columns.
--
-- Extends clone_alert_notification_queue (v150) with the fields needed for
-- the daily batch builder + HMAC approval flow:
--
--   - batch_id           uuid     — groups queue rows that ship as ONE email
--                                   per brand per day
--   - approval_status    text     — pending → approved/rejected/expired
--   - email_subject      text     — frozen at preparation time
--   - email_body_html    text     — frozen at preparation time so approve
--                                   sends EXACTLY what the admin previewed
--   - prepared_at        timestamptz
--   - approved_at        timestamptz
--   - approval_url       text     — HMAC-signed approve link (audit trail)
--   - provider_message_id text     — Resend ID after send
--
-- All columns ADD ... IF NOT EXISTS so the migration is idempotent.

ALTER TABLE public.clone_alert_notification_queue
  ADD COLUMN IF NOT EXISTS batch_id uuid,
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'unbatched'
    CHECK (approval_status IN (
      'unbatched',     -- enqueued by notify-brand, not yet picked up by prepare cron
      'pending',       -- prepared into a batch, Telegram preview sent, awaiting admin
      'approved',      -- admin clicked approve URL — actual send in flight
      'rejected',      -- admin clicked reject URL
      'sent',          -- email sent successfully via Resend
      'expired',       -- pending >7 days, auto-expired by cleanup cron
      'auto_approved'  -- FF_SHOPFRONT_CLONE_NOTIFY_BRAND_AUTO_SEND was ON
    )),
  ADD COLUMN IF NOT EXISTS email_subject text,
  ADD COLUMN IF NOT EXISTS email_body_html text,
  ADD COLUMN IF NOT EXISTS prepared_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approval_url text,
  ADD COLUMN IF NOT EXISTS provider_message_id text;

COMMENT ON COLUMN public.clone_alert_notification_queue.batch_id IS
  'UUID shared by queue rows that ship as ONE consolidated email per brand per day. NULL until the prepare cron picks them up.';
COMMENT ON COLUMN public.clone_alert_notification_queue.approval_status IS
  'Workflow state for the admin-gated send. unbatched → pending → approved → sent (or rejected/expired). auto_approved bypasses pending when the auto-send flag is on.';
COMMENT ON COLUMN public.clone_alert_notification_queue.email_body_html IS
  'Frozen rendered HTML body at preparation time. Approve URL sends EXACTLY this so the admin previewed-vs-sent never diverges.';

-- Backfill existing rows: anything inserted under v150 was 'pending' but
-- in the new schema that maps to 'unbatched' (prepare cron will pick them
-- up). status column under v150 stays as the legacy state field; the new
-- approval_status is orthogonal.
UPDATE public.clone_alert_notification_queue
SET approval_status = 'unbatched'
WHERE approval_status = 'unbatched'  -- default; just be explicit
  AND batch_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_clone_alert_notif_queue_batch
  ON public.clone_alert_notification_queue (batch_id)
  WHERE batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clone_alert_notif_queue_unbatched
  ON public.clone_alert_notification_queue (scheduled_for)
  WHERE approval_status = 'unbatched';

CREATE INDEX IF NOT EXISTS idx_clone_alert_notif_queue_pending_approval
  ON public.clone_alert_notification_queue (prepared_at)
  WHERE approval_status = 'pending';

-- RPC: list unbatched rows ready for the prepare cron to group.
-- Returns one row per queue entry; cron groups in code.
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
    AND q.scheduled_for <= now()
  ORDER BY q.brand, q.recipient, q.enqueued_at ASC
  LIMIT GREATEST(1, LEAST(p_limit, 2000));
$$;

REVOKE EXECUTE ON FUNCTION public.list_clone_alerts_unbatched_for_prepare(int)
  FROM anon, authenticated;

-- RPC: atomic batch-assignment + transition to 'pending'. Called by the
-- prepare cron once it has rendered the email body for a (brand, recipient)
-- group.
CREATE OR REPLACE FUNCTION public.assign_clone_alert_batch(
  p_queue_ids bigint[],
  p_batch_id uuid,
  p_email_subject text,
  p_email_body_html text,
  p_approval_url text,
  p_auto_approved boolean DEFAULT false
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE public.clone_alert_notification_queue
  SET batch_id = p_batch_id,
      approval_status = CASE
        WHEN p_auto_approved THEN 'auto_approved'
        ELSE 'pending'
      END,
      email_subject = p_email_subject,
      email_body_html = p_email_body_html,
      approval_url = p_approval_url,
      prepared_at = now()
  WHERE id = ANY(p_queue_ids)
    AND approval_status = 'unbatched';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assign_clone_alert_batch(bigint[], uuid, text, text, text, boolean)
  FROM anon, authenticated;

-- RPC: load all rows in a batch (used by approve endpoint to confirm what
-- the admin is approving + by the send fn after approval).
CREATE OR REPLACE FUNCTION public.load_clone_alert_batch(
  p_batch_id uuid
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
  approval_status text,
  email_subject text,
  email_body_html text,
  prepared_at timestamptz,
  approved_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
  SELECT q.id, q.alert_id, q.brand, q.candidate_domain, q.candidate_url,
         q.recipient, q.channel_type, q.severity_tier, q.approval_status,
         q.email_subject, q.email_body_html, q.prepared_at, q.approved_at
  FROM public.clone_alert_notification_queue q
  WHERE q.batch_id = p_batch_id
  ORDER BY q.id ASC;
$$;

REVOKE EXECUTE ON FUNCTION public.load_clone_alert_batch(uuid)
  FROM anon, authenticated;

-- RPC: transition a whole batch — used by approve / reject / expire / send paths.
CREATE OR REPLACE FUNCTION public.transition_clone_alert_batch(
  p_batch_id uuid,
  p_new_status text,
  p_provider_message_id text DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_count int;
BEGIN
  IF p_new_status NOT IN ('approved','rejected','sent','expired') THEN
    RAISE EXCEPTION 'invalid status: %', p_new_status USING ERRCODE = '22023';
  END IF;
  UPDATE public.clone_alert_notification_queue
  SET approval_status = p_new_status,
      approved_at = CASE
        WHEN p_new_status IN ('approved','sent') AND approved_at IS NULL THEN now()
        ELSE approved_at
      END,
      provider_message_id = COALESCE(p_provider_message_id, provider_message_id),
      processed_at = CASE
        WHEN p_new_status IN ('sent','rejected','expired') THEN now()
        ELSE processed_at
      END
  WHERE batch_id = p_batch_id
    AND approval_status IN ('pending','approved','auto_approved');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.transition_clone_alert_batch(uuid, text, text)
  FROM anon, authenticated;
