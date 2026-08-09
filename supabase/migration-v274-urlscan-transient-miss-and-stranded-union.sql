-- v274 — two fixes for the urlscan retrieve lane's honesty work.
--
-- ── 1. A bounded transient miss ─────────────────────────────────────────────
--
-- v272's companion code change (clone-watch-urlscan-retrieve.ts) correctly
-- stopped treating a 429/5xx/timeout as evidence about the URL: those are OUR
-- problem, not the domain's, and persisting a NULL classification for them bumped
-- urlscan_failure_streak toward permanent exclusion.
--
-- But the skip it introduced writes NOTHING at all, and the retrieve worklist is
--
--     ORDER BY sca.urlscan_submitted_at ASC LIMIT 40
--
-- so a uuid that deterministically returns `transient` — a 5xx, the 10s
-- AbortSignal timeout, or a res.json() throw — keeps its oldest submitted_at and
-- re-presents at the head of the worklist on every run, forever, while rows
-- behind it starve. Measured: 45 of 99 retrieve runs over 14 days offered a full
-- batch of 40, so the worklist is saturated on ~45% of runs and head-of-line
-- blocking is not hypothetical. The pre-change code evicted after 3 strikes; the
-- fix removed the only eviction. This is the worklist-gate-starvation shape this
-- repo has already written down: a worklist rank-limited BEFORE a caller-applied
-- gate must stamp the gate's rejects, or they re-present at the head forever.
--
-- This RPC is that stamp. It counts transient misses in urlscan_evidence and
-- leaves the verdict columns alone; only after p_max_misses consecutive misses
-- does it fall back to the streak, so eviction still exists but takes
-- 3 misses x 3 streak = 9 ticks (~27h) instead of one unlucky window.
--
-- Deliberate deviation from the plan, which suggested extending
-- persist_clone_alert_urlscan with a "transient mode": that function stamps
-- urlscan_scanned_at = now() unconditionally, resets/bumps the streak, and writes
-- the v230 transition archive. A transient miss must do NONE of those — it is a
-- different write, not a variant of the same one. A mode flag would have made one
-- function do two unrelated jobs and put an early return in front of the
-- transition archive. A separate, focused RPC concentrates that complexity rather
-- than moving it.
--
-- A successful retrieve needs no reset: persist_clone_alert_urlscan overwrites
-- urlscan_evidence wholesale, so transient_misses disappears with it.

CREATE OR REPLACE FUNCTION public.record_clone_alert_urlscan_transient_miss(
  p_alert_id bigint,
  p_detail text DEFAULT NULL,
  p_max_misses integer DEFAULT 3
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_prior integer;
  v_next  integer;
BEGIN
  SELECT COALESCE((sca.urlscan_evidence ->> 'transient_misses')::integer, 0)
    INTO v_prior
    FROM public.shopfront_clone_alerts sca
   WHERE sca.id = p_alert_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_next := v_prior + 1;

  UPDATE public.shopfront_clone_alerts sca
  SET urlscan_evidence = COALESCE(sca.urlscan_evidence, '{}'::jsonb) || jsonb_build_object(
        -- Reset the counter when we escalate to the streak, so the next streak
        -- point also needs a full p_max_misses run of misses.
        'transient_misses', CASE WHEN v_next >= GREATEST(1, p_max_misses) THEN 0 ELSE v_next END,
        'transient_last_detail', p_detail,
        'transient_last_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      ),
      -- Only at the cap does a transient miss cost anything. Below it the row is
      -- untouched apart from evidence, so it stays in the retrieve worklist and
      -- nothing about its verdict or scan clock is invented.
      urlscan_failure_streak = sca.urlscan_failure_streak
        + CASE WHEN v_next >= GREATEST(1, p_max_misses) THEN 1 ELSE 0 END,
      updated_at = now()
  WHERE sca.id = p_alert_id;

  RETURN v_next;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_clone_alert_urlscan_transient_miss(bigint, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_clone_alert_urlscan_transient_miss(bigint, text, integer)
  TO service_role;

COMMENT ON FUNCTION public.record_clone_alert_urlscan_transient_miss(bigint, text, integer) IS
  'Record a urlscan retrieval miss that was OUR fault (5xx / timeout / parse '
  'failure), not evidence about the URL. Counts misses in urlscan_evidence and '
  'touches neither urlscan_scanned_at nor urlscan_classification; only at '
  'p_max_misses does it bump urlscan_failure_streak. Exists so the retrieve '
  'lane''s skip is BOUNDED — an unstamped skip re-presents at the head of a '
  'worklist ordered by urlscan_submitted_at ASC and starves everything behind it.';

-- ── 2. The stranded count needs a union, not two overlapping numbers ─────────
--
-- v272 shipped two FILTER counts over one table. They overlap heavily — a failed
-- submit leaves urlscan_uuid NULL *and* bumps the streak — so summing them, which
-- the admin banner did, overstates badly. Measured 2026-08-09:
--   streak-frozen 239 + submitted-no-uuid 295 = 534 rendered, true union 305,
--   overlap 229. A 75% overstatement on a panel whose entire purpose is honesty.
--
-- Both counters also MISSED the largest genuinely-stranded shape: 193 rows carry
-- a urlscan_uuid with urlscan_submitted_at NULL. The retrieve gate compares
-- `urlscan_submitted_at <= now() - interval`, which against NULL yields NULL —
-- not false — so they are invisible to retrieve; uuid IS NOT NULL hides them from
-- submit; and 190 are lifecycle_state='detected', which the recheck pool excludes.
-- Three lanes, zero coverage. That shape is now its own column.

-- DROP first: adding OUT columns changes the row type, and Postgres refuses that
-- through CREATE OR REPLACE (42P13). Safe here — the only caller is
-- /admin/clone-watch, which ships in this same PR, and both statements run in
-- one migration transaction so there is no window where the function is missing.
DROP FUNCTION IF EXISTS public.clone_watch_urlscan_stranded_count(integer);

CREATE OR REPLACE FUNCTION public.clone_watch_urlscan_stranded_count(
  p_max_failure_streak integer DEFAULT 3
)
RETURNS TABLE (
  stranded_total bigint,
  stranded_streak bigint,
  stranded_submitted_no_uuid bigint,
  stranded_uuid_no_submitted_at bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT
    -- The union. Render THIS; the three below are an overlapping breakdown.
    count(*) FILTER (
      WHERE (sca.urlscan_failure_streak >= p_max_failure_streak
             AND sca.urlscan_classification IS NULL)
         OR (sca.urlscan_submitted_at IS NOT NULL
             AND sca.urlscan_uuid IS NULL
             AND sca.urlscan_scanned_at IS NULL)
         OR (sca.urlscan_uuid IS NOT NULL
             AND sca.urlscan_submitted_at IS NULL
             AND sca.urlscan_classification IS NULL)
    ),
    count(*) FILTER (
      WHERE sca.urlscan_failure_streak >= p_max_failure_streak
        AND sca.urlscan_classification IS NULL
    ),
    count(*) FILTER (
      WHERE sca.urlscan_submitted_at IS NOT NULL
        AND sca.urlscan_uuid IS NULL
        AND sca.urlscan_scanned_at IS NULL
    ),
    count(*) FILTER (
      WHERE sca.urlscan_uuid IS NOT NULL
        AND sca.urlscan_submitted_at IS NULL
        AND sca.urlscan_classification IS NULL
    )
  FROM public.shopfront_clone_alerts sca
  WHERE sca.source = 'nrd';
$function$;

REVOKE ALL ON FUNCTION public.clone_watch_urlscan_stranded_count(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clone_watch_urlscan_stranded_count(integer)
  TO service_role;

COMMENT ON FUNCTION public.clone_watch_urlscan_stranded_count(integer) IS
  'Clone-watch alerts that no automated lane will retry, as a UNION (v274) plus '
  'an overlapping three-way breakdown. The three shapes overlap heavily — never '
  'sum them; render stranded_total. Shapes: frozen at the failure-streak cutoff; '
  'stamped submitted with no uuid (pre-v272 failed submits); and a uuid with a '
  'NULL urlscan_submitted_at, which the retrieve gate''s NULL comparison hides '
  'from every lane.';
