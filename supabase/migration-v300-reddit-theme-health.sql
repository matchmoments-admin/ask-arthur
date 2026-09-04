-- Migration v300: give reddit_intel_themes' lifecycle columns a writer
--
-- WHY
--
-- Three columns on reddit_intel_themes describe a theme's health. Measured in
-- prod 2026-09-04, none of them carries information:
--
--   signal_strength   200 of 200 rows are 'weak'. The only writer in the
--                     codebase is a hardcoded literal at theme creation
--                     (reddit-intel-cluster.ts:511). The schema comment at
--                     v82:103 says it is "refreshed by the trends job" — there
--                     is no trends job; packages/scam-engine/src/inngest/
--                     contains only reddit-intel-{daily,embed,cluster}.
--   wow_delta_pct     non-null on 0 of 200 rows. Declared at v82:112, written
--                     by nothing, and served to B2B customers as `wowDeltaPct`
--                     by /api/v1/intel/themes — always null.
--   is_active         set true at creation and never set false. Nothing ages a
--                     theme out, so "active themes" is just "all themes".
--
-- match_themes_by_centroid (v188:71-78) filters on
-- `signal_strength >= 'weak'`, which given the above matches everything — a
-- filter that reads as a quality gate and is a no-op.
--
-- This function is the missing writer. It is deliberately SQL rather than
-- TypeScript: all three values are aggregates over theme membership, and the
-- set-based form is one statement per column instead of a read-modify-write
-- loop over hundreds of rows.
--
-- Recency comes from reddit_post_intel.processed_at joined through
-- reddit_post_intel_themes — that join table carries no timestamp of its own.
--
-- Idempotent, and safe to run repeatedly: every value is recomputed from
-- current membership rather than incremented.

BEGIN;

CREATE OR REPLACE FUNCTION public.refresh_reddit_theme_health(
  p_inactive_after_days INT DEFAULT 90
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_deactivated INT;
  v_strong      INT;
  v_births_7d   INT;
BEGIN
  -- One statement, so the three columns can never disagree with each other,
  -- and no temp table: an earlier draft used `CREATE TEMP TABLE ...
  -- ON COMMIT DROP`, which throws `relation already exists` the SECOND time
  -- the function is called inside one transaction. Each PostgREST call is its
  -- own transaction so that never fired in normal use — it was a landmine for
  -- the first caller to wrap two calls together, which is exactly the kind of
  -- defect that surfaces during an incident rather than in review.
  WITH velocity AS (
    SELECT
      t.id AS theme_id,
      COUNT(*) FILTER (
        WHERE i.processed_at >= NOW() - INTERVAL '7 days'
      ) AS joins_7d,
      COUNT(*) FILTER (
        WHERE i.processed_at >= NOW() - INTERVAL '14 days'
          AND i.processed_at <  NOW() - INTERVAL '7 days'
      ) AS joins_prior_7d,
      COUNT(*) FILTER (
        WHERE i.processed_at >= NOW() - INTERVAL '14 days'
      ) AS joins_14d
    FROM reddit_intel_themes t
    LEFT JOIN reddit_post_intel_themes m ON m.theme_id = t.id
    LEFT JOIN reddit_post_intel i        ON i.id = m.intel_id
    GROUP BY t.id
  ),
  updated AS (
    UPDATE reddit_intel_themes t
    SET
      -- 'strong' means established AND still being joined. A big theme nobody
      -- has added to in a fortnight is history, not signal. 'noise' is the set
      -- below MIN_MEMBERS_FOR_NAMING (3) in reddit-intel-cluster.ts, which is
      -- also exactly the set still titled "Pending naming".
      signal_strength = CASE
        WHEN t.member_count < 3                        THEN 'noise'
        WHEN t.member_count >= 10 AND v.joins_14d >= 3 THEN 'strong'
        ELSE 'weak'
      END,
      -- NULL, not 0, when the prior week had no joins: the percentage change
      -- from zero is undefined, and a 0 there would read as "flat" when it
      -- actually means "brand new".
      wow_delta_pct = CASE
        WHEN v.joins_prior_7d = 0 THEN NULL
        ELSE ROUND(
          100.0 * (v.joins_7d - v.joins_prior_7d) / v.joins_prior_7d, 1
        )
      END,
      -- Reversible by construction: a theme that gets a new post crosses back
      -- over this predicate on the next run. Visibility state, not deletion.
      is_active = (
        t.last_seen_at >= NOW() - (p_inactive_after_days || ' days')::INTERVAL
      ),
      updated_at = NOW()
    FROM velocity v
    WHERE v.theme_id = t.id
    RETURNING
      t.is_active AS now_active,
      t.signal_strength AS now_strength
  )
  SELECT
    COUNT(*) FILTER (WHERE NOT now_active),
    COUNT(*) FILTER (WHERE now_strength = 'strong')
  INTO v_deactivated, v_strong
  FROM updated;

  SELECT COUNT(*) INTO v_births_7d
  FROM reddit_intel_themes
  WHERE first_seen_at >= NOW() - INTERVAL '7 days';

  RETURN json_build_object(
    -- Note this is "themes currently inactive", not "deactivated by this run":
    -- the update is idempotent, so a per-run delta would read 0 on every run
    -- after the first and look like the sweep had stopped working.
    'inactive_themes', v_deactivated,
    'strong_themes', v_strong,
    'theme_births_7d', v_births_7d,
    'active_themes', (SELECT COUNT(*) FROM reddit_intel_themes WHERE is_active)
  );
END;
$$;

COMMENT ON FUNCTION public.refresh_reddit_theme_health IS
  'Recomputes reddit_intel_themes.signal_strength / wow_delta_pct / is_active '
  'from current membership (v300). Before this, all three were write-once or '
  'never-written: 200/200 themes read weak, 0/200 had a wow delta, and no '
  'theme was ever deactivated.';

REVOKE EXECUTE ON FUNCTION public.refresh_reddit_theme_health(INT)
  FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_reddit_theme_health(INT)
  TO service_role;

COMMIT;

-- Verification (run after apply):
--
--   SELECT refresh_reddit_theme_health();
--   SELECT signal_strength, count(*) FROM reddit_intel_themes GROUP BY 1;
--     → no longer 100% 'weak'
--   SELECT count(*) FROM reddit_intel_themes WHERE wow_delta_pct IS NOT NULL;
--     → > 0 for themes with joins in both of the last two weeks
