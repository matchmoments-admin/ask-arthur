-- v152: Clone-watch brand-notification hardening.
--
-- Closes the gaps surfaced in the 2026-05-27 review:
--
--   1. Audit trail   — admin_id stamped on queue row at send/reject time.
--   2. Concurrency   — transition_clone_alert_batch now locks rows FOR UPDATE
--                      and returns a structured outcome so the route can tell
--                      "won the race" from "lost the race" from "already
--                      terminal" (was previously silent no-op).
--   3. Cross-day     — brand_contact_directory.last_notified_at + a tiny
--      throttle        helper RPC so prepare can skip brands we emailed in
--                      the last N hours.
--   4. Retention     — three chunked deletion helpers so terminal rows
--                      don't accumulate indefinitely. Chunk size capped at
--                      5K per call (hot-table chunking convention).
--
-- All ADDs and CREATEs are idempotent (IF NOT EXISTS, CREATE OR REPLACE).
-- No destructive ops on existing columns/tables.

-- ── 1. Audit trail on queue rows ────────────────────────────────────────

ALTER TABLE public.clone_alert_notification_queue
  ADD COLUMN IF NOT EXISTS approved_by_admin_id uuid,
  ADD COLUMN IF NOT EXISTS rejected_by_admin_id uuid;

COMMENT ON COLUMN public.clone_alert_notification_queue.approved_by_admin_id IS
  'Supabase auth.users.id of the admin who clicked Send. NULL when HMAC-cookie auth was used (no user id available). Populated by transition_clone_alert_batch.';
COMMENT ON COLUMN public.clone_alert_notification_queue.rejected_by_admin_id IS
  'As above for Reject. Set independently — Send + Reject paths are mutually exclusive on a given batch.';

-- ── 2. Per-brand throttle ───────────────────────────────────────────────

ALTER TABLE public.brand_contact_directory
  ADD COLUMN IF NOT EXISTS last_notified_at timestamptz;

COMMENT ON COLUMN public.brand_contact_directory.last_notified_at IS
  'Stamped at successful brand-notification send. Read by the prepare cron to enforce a per-brand cooldown (default 24h). NULL means never notified.';

-- ── 3. Concurrency-safe batch transition ────────────────────────────────
--
-- Returns (updated_count, observed_status, recipient) so the route can
-- distinguish:
--   updated_count=N, observed_status='pending'   → we did the write
--   updated_count=0, observed_status='sent'      → someone beat us to Send
--   updated_count=0, observed_status='rejected'  → someone beat us to Reject
--   updated_count=0, observed_status=NULL        → batch_id unknown
--
-- The recipient is also returned so the calling route can cross-validate
-- against brand_contact_directory WITHOUT a second round trip.

CREATE OR REPLACE FUNCTION public.transition_clone_alert_batch(
  p_batch_id uuid,
  p_new_status text,
  p_provider_message_id text DEFAULT NULL,
  p_admin_id uuid DEFAULT NULL
)
RETURNS TABLE (
  updated_count int,
  observed_status text,
  observed_brand text,
  observed_recipient text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_count int;
  v_status text;
  v_brand text;
  v_recipient text;
BEGIN
  IF p_new_status NOT IN ('approved','rejected','sent','expired') THEN
    RAISE EXCEPTION 'invalid status: %', p_new_status USING ERRCODE = '22023';
  END IF;

  -- Lock the batch's rows first so concurrent senders serialise here.
  -- LIMIT 1 inside the FOR UPDATE subquery is fine — every row in the
  -- batch shares the same approval_status by design, so any one row's
  -- state is authoritative.
  SELECT q.approval_status, q.brand, q.recipient
    INTO v_status, v_brand, v_recipient
  FROM public.clone_alert_notification_queue q
  WHERE q.batch_id = p_batch_id
  ORDER BY q.id
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 0, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- Idempotent terminal-state guard: already in the requested state, or
  -- already in another terminal state — return 0 updated, surface what
  -- we saw.
  IF v_status NOT IN ('pending','approved','auto_approved') THEN
    RETURN QUERY SELECT 0, v_status, v_brand, v_recipient;
    RETURN;
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
      END,
      approved_by_admin_id = CASE
        WHEN p_new_status = 'sent' THEN COALESCE(p_admin_id, approved_by_admin_id)
        ELSE approved_by_admin_id
      END,
      rejected_by_admin_id = CASE
        WHEN p_new_status = 'rejected' THEN COALESCE(p_admin_id, rejected_by_admin_id)
        ELSE rejected_by_admin_id
      END
  WHERE batch_id = p_batch_id
    AND approval_status IN ('pending','approved','auto_approved');
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN QUERY SELECT v_count, p_new_status, v_brand, v_recipient;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.transition_clone_alert_batch(uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated;

-- The legacy 3-arg overload is dropped — both callers (send + reject
-- routes) are being updated in the same PR to use the new 4-arg shape.
-- Drop the old signature so we don't accidentally fall back to it.
DROP FUNCTION IF EXISTS public.transition_clone_alert_batch(uuid, text, text);

-- ── 4. record_brand_notification_sent ───────────────────────────────────
-- One RPC that does the two follow-up writes after a successful Resend
-- send: (a) updates brand_contact_directory.last_notified_at for throttle;
-- (b) atomically merges submitted_to.brand_notification.status='sent' on
-- every alert in the batch. Called by send/route.ts after transition.

CREATE OR REPLACE FUNCTION public.record_brand_notification_sent(
  p_batch_id uuid,
  p_provider_message_id text DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_alert_ids bigint[];
  v_brand text;
  v_recipient text;
  v_directory_brand text;
  v_count int;
BEGIN
  SELECT array_agg(alert_id), MIN(brand), MIN(recipient)
    INTO v_alert_ids, v_brand, v_recipient
  FROM public.clone_alert_notification_queue
  WHERE batch_id = p_batch_id;

  IF v_alert_ids IS NULL OR array_length(v_alert_ids, 1) = 0 THEN
    RETURN 0;
  END IF;

  -- Update brand_contact_directory throttle.
  -- brand on the queue is the legitimate_domain (matches the upstream
  -- enqueue path in clone-watch-notify-brand.ts), so we look up by that.
  SELECT brand INTO v_directory_brand
  FROM public.brand_contact_directory
  WHERE legitimate_domain = v_brand
  LIMIT 1;

  IF v_directory_brand IS NOT NULL THEN
    UPDATE public.brand_contact_directory
    SET last_notified_at = now(),
        updated_at = now()
    WHERE brand = v_directory_brand;
  END IF;

  -- Atomic JSONB merge on every alert in the batch.
  UPDATE public.shopfront_clone_alerts
  SET submitted_to = COALESCE(submitted_to, '{}'::jsonb)
    || jsonb_build_object(
      'brand_notification',
      COALESCE(submitted_to->'brand_notification', '{}'::jsonb)
        || jsonb_build_object(
          'status', 'sent',
          'sent_at', to_jsonb(now()::text),
          'provider_message_id', to_jsonb(p_provider_message_id),
          'batch_id', to_jsonb(p_batch_id::text)
        )
    )
  WHERE id = ANY(v_alert_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_brand_notification_sent(uuid, text)
  FROM PUBLIC, anon, authenticated;

-- ── 5. Per-brand throttle reader ────────────────────────────────────────
-- Used by the prepare cron: given a list of (legitimate_domain, last_at)
-- candidates, return the legitimate_domains that have been notified within
-- the cooldown window so the cron can skip them.

CREATE OR REPLACE FUNCTION public.list_recently_notified_brands(
  p_legitimate_domains text[],
  p_cooldown_hours int DEFAULT 24
)
RETURNS TABLE (
  legitimate_domain text,
  last_notified_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT bcd.legitimate_domain, bcd.last_notified_at
  FROM public.brand_contact_directory bcd
  WHERE bcd.legitimate_domain = ANY(p_legitimate_domains)
    AND bcd.last_notified_at IS NOT NULL
    AND bcd.last_notified_at > now() - (GREATEST(1, LEAST(p_cooldown_hours, 168)) * interval '1 hour');
$$;

REVOKE EXECUTE ON FUNCTION public.list_recently_notified_brands(text[], int)
  FROM PUBLIC, anon, authenticated;

-- ── 6. Retention sweeps (chunked) ───────────────────────────────────────
-- All three return the row count actually affected so the cron can loop
-- until it returns < chunk_size. Following the hot-table chunking
-- convention from the 2026-05-09 incident: ≤5K rows per iteration, finite
-- statement_timeout, structured count return.

-- 6a. Expire stale pending batches (>7 days unconfirmed).
CREATE OR REPLACE FUNCTION public.expire_stale_pending_clone_batches(
  p_older_than_hours int DEFAULT 168,
  p_chunk_size int DEFAULT 1000
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count int;
  v_chunk int := GREATEST(1, LEAST(p_chunk_size, 5000));
  v_age_hours int := GREATEST(24, LEAST(p_older_than_hours, 720));
BEGIN
  WITH stale AS (
    SELECT id
    FROM public.clone_alert_notification_queue
    WHERE approval_status = 'pending'
      AND prepared_at < now() - (v_age_hours * interval '1 hour')
    ORDER BY prepared_at
    LIMIT v_chunk
  )
  UPDATE public.clone_alert_notification_queue q
  SET approval_status = 'expired',
      processed_at = now()
  FROM stale
  WHERE q.id = stale.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.expire_stale_pending_clone_batches(int, int)
  FROM PUBLIC, anon, authenticated;

-- 6b. Delete terminal queue rows older than threshold.
-- DELETE not archive: the row's value is in cost_telemetry + provider logs.
-- email_body_html can be 5-50KB so reclaiming this is real disk savings.
CREATE OR REPLACE FUNCTION public.purge_old_clone_alert_queue_rows(
  p_older_than_days int DEFAULT 90,
  p_chunk_size int DEFAULT 1000
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count int;
  v_chunk int := GREATEST(1, LEAST(p_chunk_size, 5000));
  v_age_days int := GREATEST(7, LEAST(p_older_than_days, 730));
BEGIN
  WITH purgeable AS (
    SELECT id
    FROM public.clone_alert_notification_queue
    WHERE approval_status IN ('sent','rejected','expired','skipped')
      AND processed_at IS NOT NULL
      AND processed_at < now() - (v_age_days * interval '1 day')
    ORDER BY processed_at
    LIMIT v_chunk
  )
  DELETE FROM public.clone_alert_notification_queue q
  USING purgeable
  WHERE q.id = purgeable.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_old_clone_alert_queue_rows(int, int)
  FROM PUBLIC, anon, authenticated;

-- 6c. Delete FP clone alerts older than threshold.
-- TP-confirmed and TP-actioned rows are kept indefinitely (small slice,
-- powers the 30-365d brand-breakdown + takedown-stats RPCs). FPs are the
-- bulk of volume and have no downstream consumer.
-- ON DELETE CASCADE on clone_alert_notification_queue.alert_id means the
-- queue rows for these alerts are removed too.
CREATE OR REPLACE FUNCTION public.purge_old_fp_clone_alerts(
  p_older_than_days int DEFAULT 90,
  p_chunk_size int DEFAULT 1000
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count int;
  v_chunk int := GREATEST(1, LEAST(p_chunk_size, 5000));
  v_age_days int := GREATEST(30, LEAST(p_older_than_days, 730));
BEGIN
  WITH purgeable AS (
    SELECT id
    FROM public.shopfront_clone_alerts
    WHERE triage_status = 'fp'
      AND triage_at IS NOT NULL
      AND triage_at < now() - (v_age_days * interval '1 day')
    ORDER BY triage_at
    LIMIT v_chunk
  )
  DELETE FROM public.shopfront_clone_alerts a
  USING purgeable
  WHERE a.id = purgeable.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_old_fp_clone_alerts(int, int)
  FROM PUBLIC, anon, authenticated;

-- ── Index on processed_at to make the retention sweeps fast ─────────────
-- Partial index — only terminal rows. Small slice, narrow predicate.
CREATE INDEX IF NOT EXISTS idx_clone_alert_notif_queue_terminal_processed
  ON public.clone_alert_notification_queue (processed_at)
  WHERE approval_status IN ('sent','rejected','expired','skipped');

-- And for the FP-alert sweep.
CREATE INDEX IF NOT EXISTS idx_shopfront_clone_alerts_fp_triaged
  ON public.shopfront_clone_alerts (triage_at)
  WHERE triage_status = 'fp';
