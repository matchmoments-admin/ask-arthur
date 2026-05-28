-- migration-v160-clone-watch-public-revoke-sweep.sql
--
-- Security fix (#512, escalated): close the anon/authenticated EXECUTE hole on
-- the clone-watch RPCs added in v143–v151.
--
-- ROOT CAUSE (verified against the live catalog 2026-05-29 via
-- has_function_privilege): every clone-watch RPC created in v143–v151 used
--   REVOKE EXECUTE ... FROM anon, authenticated
-- but OMITTED `FROM PUBLIC`. In Supabase, CREATE [OR REPLACE] FUNCTION
-- auto-grants EXECUTE to PUBLIC, and both `anon` and `authenticated` inherit
-- from PUBLIC — so the per-role revoke is a no-op against the inherited grant.
-- Result: 18 SECURITY DEFINER functions were executable by `anon` and
-- `authenticated` over PostgREST `/rest/v1/rpc/<fn>`. Because SECURITY DEFINER
-- bypasses RLS, this is NOT mitigated by the service-role-only RLS on
-- shopfront_clone_alerts.
--
-- WHY THIS IS HIGHER SEVERITY THAN "info disclosure": the exposed set includes
-- STATE-MUTATING writes — set_clone_alert_triage (flip a verdict),
-- merge_clone_alert_submission / persist_clone_alert_urlscan (mutate alert
-- state), enqueue_clone_alert_notification (queue outbound), and
-- ingest_clone_alert_brand_reply (inject a fake brand "stop" reply, which
-- suppresses real outreach). An unauthenticated caller could reach all of
-- these directly.
--
-- WHY REVOKING anon FROM clone_watch_public_impact / clone_watch_takedown_stats
-- IS SAFE: the only callers (public /clone-watch page, /admin page, weekly
-- digest) use the service-role client server-side — never browser supabase-js
-- (see apps/web/app/clone-watch/page.tsx:9-10). No surface depends on anon
-- access to these aggregates.
--
-- FIX SHAPE: pure grant change — REVOKE EXECUTE FROM PUBLIC, anon, authenticated
-- and re-assert the service_role grant explicitly (the only legitimate caller).
-- No function bodies are touched. The established idiom (v152, v159) relies on
-- Supabase default privileges to keep service_role's grant after a PUBLIC
-- revoke; we GRANT it explicitly here too so the access contract is
-- self-documenting and survives any future default-privilege change.
--
-- search_path hardening (several of these are SECURITY DEFINER with
-- `search_path = public, pg_catalog` rather than the strict `''`) is a SEPARATE,
-- lower-priority follow-up: once these functions are service-role-only, an
-- unqualified-name hijack requires an attacker who already holds service_role,
-- so the grant revoke is what closes the actually-exploitable path. Rewriting
-- 18 function bodies to `search_path = ''` is deferred to avoid a large,
-- risk-bearing change in this security hotfix.
--
-- Idempotent: REVOKE/GRANT are safe to re-run.

-- ── Read selectors ────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.list_clone_alerts_pending_urlscan(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_clone_alerts_pending_urlscan(integer)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.list_clone_alerts_for_urlscan_rescan(integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_clone_alerts_for_urlscan_rescan(integer, integer)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.list_clone_alerts_pending_netcraft_poll(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_clone_alerts_pending_netcraft_poll(integer)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.list_clone_alerts_pending_notification_batch(text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_clone_alerts_pending_notification_batch(text, integer)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.list_clone_alerts_unbatched_for_prepare(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_clone_alerts_unbatched_for_prepare(integer)
  TO service_role;

-- ── Aggregates (server-side service-role callers only) ────────────────────
REVOKE EXECUTE ON FUNCTION public.clone_watch_brand_breakdown(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clone_watch_brand_breakdown(integer)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.clone_watch_weekly_metrics(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clone_watch_weekly_metrics(integer)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.clone_watch_public_impact(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clone_watch_public_impact(integer)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.clone_watch_takedown_stats(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clone_watch_takedown_stats(integer)
  TO service_role;

-- ── State-mutating writes (the high-severity part of #512) ────────────────
REVOKE EXECUTE ON FUNCTION public.set_clone_alert_triage(bigint, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_clone_alert_triage(bigint, text, uuid, text)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.merge_clone_alert_submission(bigint, text, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_clone_alert_submission(bigint, text, jsonb, text)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.persist_clone_alert_urlscan(bigint, text, jsonb, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_clone_alert_urlscan(bigint, text, jsonb, text, text)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.enqueue_clone_alert_notification(bigint, text, text, text, text, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_clone_alert_notification(bigint, text, text, text, text, text, text, timestamptz)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.ingest_clone_alert_brand_reply(bigint, text, text, text, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_clone_alert_brand_reply(bigint, text, text, text, text, text, text, jsonb)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.clone_alert_recipient_is_suppressed(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clone_alert_recipient_is_suppressed(text)
  TO service_role;

-- ── Notification-batch lifecycle ──────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.assign_clone_alert_batch(bigint[], uuid, text, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_clone_alert_batch(bigint[], uuid, text, text, text, boolean)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.load_clone_alert_batch(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.load_clone_alert_batch(uuid)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.mark_clone_alert_notifications_processed(bigint[], text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_clone_alert_notifications_processed(bigint[], text)
  TO service_role;
