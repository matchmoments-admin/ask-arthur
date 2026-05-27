-- v153: record_brand_notification_sent lookup by brand, not legitimate_domain
--
-- The RPC that stamps brand_contact_directory.last_notified_at on Send
-- looked up the directory row by `legitimate_domain = v_brand`. But the
-- queue stores directory.brand into queue.brand (per the enqueue path
-- in clone-watch-notify-brand). This worked for cases where brand name
-- and legitimate domain happened to be the same string (e.g. dominos)
-- but failed silently for any brand whose name differs from its domain
-- (e.g. Domain). The per-brand 24h cooldown in the prepare cron depends
-- on this column being populated — without it, brands are never throttled.
--
-- Caught 2026-05-27 during the PR #459 live e2e test: alert 505 sent
-- successfully but brand_contact_directory.Domain.last_notified_at
-- stayed NULL. The send-route lookup was hotfixed in PR #468; this is
-- the matching fix for the post-send record path.

CREATE OR REPLACE FUNCTION public.record_brand_notification_sent(
  p_batch_id uuid,
  p_provider_message_id text DEFAULT NULL::text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_alert_ids bigint[];
  v_brand text;
  v_recipient text;
  v_count int;
BEGIN
  SELECT array_agg(alert_id), MIN(brand), MIN(recipient)
    INTO v_alert_ids, v_brand, v_recipient
  FROM public.clone_alert_notification_queue
  WHERE batch_id = p_batch_id;

  IF v_alert_ids IS NULL OR array_length(v_alert_ids, 1) = 0 THEN
    RETURN 0;
  END IF;

  -- Lookup brand_contact_directory by brand (not legitimate_domain).
  -- queue.brand stores directory.brand on every enqueue path; matching
  -- by legitimate_domain only worked when brand name == legitimate domain.
  UPDATE public.brand_contact_directory
  SET last_notified_at = now(),
      updated_at = now()
  WHERE brand = v_brand;

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
$function$;

-- Lockdown grants — match the v152 hardening pattern (SECURITY DEFINER
-- functions should not be callable by PUBLIC / anon / authenticated).
REVOKE EXECUTE ON FUNCTION public.record_brand_notification_sent(uuid, text)
  FROM PUBLIC, anon, authenticated;
