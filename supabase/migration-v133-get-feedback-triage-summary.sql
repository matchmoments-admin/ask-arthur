-- migration-v133-get-feedback-triage-summary.sql
-- Collapse the /admin/feedback page's 3 round-trips into 1 RPC.
--
-- Today, apps/web/app/admin/feedback/page.tsx fires three sequential
-- queries against feedback_triage_queue (MV from v94):
--   1. The filtered + ranked + LIMIT 100 rows
--   2. count: 'exact', head: true → SELECT count(*) over the full MV
--   3. SELECT user_says (the full column) → client-side reduce for the
--      per-class counts shown on the filter pills
--
-- (3) is the most expensive — pulls every row's user_says value just to
-- bucket them in JS. The MV is small today (a few thousand rows over the
-- 30-day window in v94), but the round-trip cost is real and the page
-- gets slower as the window fills.
--
-- get_feedback_triage_summary collapses all three into one server-side
-- aggregate, returning the same shape the page already consumes.
--
-- Why RETURNS jsonb (not RETURNS TABLE):
--   - Sidesteps the OUT-parameter shadowing bite documented in CLAUDE.md
--     (verified bite 2026-05-06: unqualified `id` in a RETURNS TABLE body
--     resolves to the OUT param, not a column, raising 42702 at first call).
--   - The three results (rows, total, counts) are heterogeneous — one
--     row-shaped, one scalar, one object — naturally a single JSON document.
--
-- Why SET search_path = public, pg_catalog (not empty):
--   - SECURITY INVOKER, no escalation, no unqualified-name exploit risk.
--   - Empty search_path would hide jsonb_agg/jsonb_build_object operators.
--
-- Idempotency: CREATE OR REPLACE FUNCTION — re-applying is non-destructive.
-- The function can stay around indefinitely if the page change rolls back.
--
-- Hot-table check (CLAUDE.md):
--   - feedback_triage_queue is on the hot-tables list.
--   - This RPC is READ-ONLY. The chunked-write rule doesn't apply.
--   - The page change replaces 3 reads with 1 — reduces, not adds, load.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_feedback_triage_summary(
  p_filter text DEFAULT 'top',
  p_limit  int  DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_rows   jsonb;
  v_total  int;
  v_counts jsonb;
BEGIN
  -- 1. Filtered + ranked rows (replaces the page's main query).
  SELECT jsonb_agg(row_to_json(t)) INTO v_rows
  FROM (
    SELECT *
    FROM feedback_triage_queue
    WHERE p_filter = 'top' OR user_says = p_filter
    ORDER BY triage_score DESC, feedback_created_at DESC
    LIMIT p_limit
  ) t;

  -- 2. Total count (replaces the count: 'exact', head: true query).
  SELECT count(*) INTO v_total FROM feedback_triage_queue;

  -- 3. Per-class counts (replaces the client-side bucket loop).
  --    Filtered to the three buckets the UI surfaces; rows with
  --    other user_says values are filtered out by v94's MV WHERE clause
  --    anyway, but the IN list keeps the intent explicit.
  SELECT jsonb_object_agg(user_says, c) INTO v_counts
  FROM (
    SELECT user_says, count(*) AS c
    FROM feedback_triage_queue
    WHERE user_says IN ('false_positive', 'false_negative', 'user_reported')
    GROUP BY user_says
  ) c;

  RETURN jsonb_build_object(
    'rows',   coalesce(v_rows, '[]'::jsonb),
    'total',  v_total,
    'counts', coalesce(v_counts, '{}'::jsonb)
  );
END;
$$;

-- The page calls this with the service-role client (admin-gated via HMAC
-- cookie at apps/web/lib/adminAuth.ts:requireAdmin), so anon/authenticated
-- don't need EXECUTE. Grant only service_role for safety.
REVOKE ALL ON FUNCTION public.get_feedback_triage_summary(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_feedback_triage_summary(text, int) TO service_role;

COMMIT;
