-- v339 — Clone Alert lifecycle transition log (measure-before-enforce)
--
-- WHY: the Clone Alert lifecycle has a TS edge table
-- (apps/web/lib/clone-watch/lifecycle.ts LIFECYCLE_EDGES) but the moves are
-- made by SQL functions (advance_clone_lifecycle, apply_clone_urlscan_verdict,
-- apply_netcraft_reconcile, mark_stale_clone_alerts_dormant, …) and nothing
-- records which transitions actually happen. `clone_watch_scan_transitions`
-- logs urlscan classification changes, not lifecycle moves. So "does SQL
-- make a move the TS table calls illegal?" was unanswerable, and the 2026-09-27
-- architecture review deferred pulling the transition table into SQL for lack
-- of evidence either way.
--
-- This migration records every lifecycle_state change, LOG-ONLY. It never
-- blocks a write. After ~2 weeks, compare the observed (from, to, writer)
-- set against LIFECYCLE_EDGES (query in lifecycle.ts header) and decide
-- whether enforcement is worth building.
--
-- Safety: an AFTER trigger whose body swallows its own errors — a failed log
-- insert raises a WARNING and the alert write proceeds. No TS code writes
-- lifecycle_state directly (verified 2026-09-27: every writer is a SQL
-- function), so `writer` is read from current_query(): the first
-- `public.<fn>(` call in the top-level statement (PostgREST RPC, psycopg and
-- pg_cron all spell it that way), else 'direct_update' / 'unknown'.
--
-- Volume: shopfront_clone_alerts holds ~3.7k rows and is not on the hot-table
-- list; lifecycle moves are tens per day. No retention job yet — revisit if
-- the table passes 100k rows.
--
-- Reverse: DROP TRIGGER clone_alert_lifecycle_transition_log ON
-- public.shopfront_clone_alerts; the log table can be dropped after.

CREATE TABLE IF NOT EXISTS public.clone_lifecycle_transitions (
  id          bigserial PRIMARY KEY,
  alert_id    bigint      NOT NULL,
  from_state  text,
  to_state    text,
  writer      text        NOT NULL,
  changed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clone_lifecycle_transitions_changed_at_idx
  ON public.clone_lifecycle_transitions (changed_at);

ALTER TABLE public.clone_lifecycle_transitions ENABLE ROW LEVEL SECURITY;

-- Service-role only: no anon/authenticated policy, and (v324 default
-- privileges) no grants to those roles. The explicit policy documents intent
-- and satisfies the one-policy-per-table rule.
DROP POLICY IF EXISTS clone_lifecycle_transitions_service_only
  ON public.clone_lifecycle_transitions;
CREATE POLICY clone_lifecycle_transitions_service_only
  ON public.clone_lifecycle_transitions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.trg_clone_alert_lifecycle_transition_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_query  text := current_query();
  v_writer text;
BEGIN
  BEGIN
    v_writer := substring(v_query from '"?public"?\."?([a-z_0-9]+)"?\s*\(');
    IF v_writer IS NULL THEN
      v_writer := CASE
        WHEN v_query ~* '\mupdate\M' THEN 'direct_update'
        ELSE 'unknown'
      END;
    END IF;

    INSERT INTO public.clone_lifecycle_transitions
      (alert_id, from_state, to_state, writer)
    VALUES
      (NEW.id, OLD.lifecycle_state, NEW.lifecycle_state, v_writer);
  EXCEPTION WHEN OTHERS THEN
    -- Log-only: a measurement failure must never fail the alert write.
    RAISE WARNING 'clone lifecycle transition log failed for alert %: %',
      NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.trg_clone_alert_lifecycle_transition_log()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS clone_alert_lifecycle_transition_log
  ON public.shopfront_clone_alerts;
CREATE TRIGGER clone_alert_lifecycle_transition_log
  AFTER UPDATE OF lifecycle_state ON public.shopfront_clone_alerts
  FOR EACH ROW
  WHEN (OLD.lifecycle_state IS DISTINCT FROM NEW.lifecycle_state)
  EXECUTE FUNCTION public.trg_clone_alert_lifecycle_transition_log();
