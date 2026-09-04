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
  v_strong    INT;
  v_deactivated INT;
  v_births_7d INT;
BEGIN
  -- Joins per theme in the trailing 7 days and the 7 before that.
  CREATE TEMP TABLE _theme_velocity ON COMMIT DROP AS
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
  GROUP BY t.id;

  -- signal_strength: 'strong' means the theme is both established AND still
  -- being joined. A big theme nobody has added to in a fortnight is history,
  -- not signal. 'noise' is reserved for themes too small to have been named
  -- (MIN_MEMBERS_FOR_NAMING = 3 in reddit-intel-cluster.ts), which is also
  -- exactly the set that renders as "Pending naming".
  UPDATE reddit_intel_themes t
  SET signal_strength = CASE
        WHEN t.member_count < 3                      THEN 'noise'
        WHEN t.member_count >= 10 AND v.joins_14d >= 3 THEN 'strong'
        ELSE 'weak'
      END,
      updated_at = NOW()
  FROM _theme_velocity v
  WHERE v.theme_id = t.id
    AND t.signal_strength IS DISTINCT FROM CASE
        WHEN t.member_count < 3                      THEN 'noise'
        WHEN t.member_count >= 10 AND v.joins_14d >= 3 THEN 'strong'
        ELSE 'weak'
      END;

  SELECT COUNT(*) INTO v_strong
  FROM reddit_intel_themes WHERE signal_strength = 'strong';

  -- wow_delta_pct: week-on-week change in joins. NULL (not 0) when the prior
  -- week had none — the percentage change from zero is undefined, and writing
  -- 0 there would read as "flat" when it means "brand new".
  UPDATE reddit_intel_themes t
  SET wow_delta_pct = CASE
        WHEN v.joins_prior_7d = 0 THEN NULL
        ELSE ROUND(
          100.0 * (v.joins_7d - v.joins_prior_7d) / v.joins_prior_7d, 1
        )
      END,
      updated_at = NOW()
  FROM _theme_velocity v
  WHERE v.theme_id = t.id;

  -- is_active: age out themes with no new member for the retention window.
  -- Reversible by construction — a theme that gets a new post is reactivated
  -- by the branch below, so this is a visibility state, not a deletion.
  UPDATE reddit_intel_themes t
  SET is_active = FALSE, updated_at = NOW()
  WHERE t.is_active
    AND t.last_seen_at < NOW() - (p_inactive_after_days || ' days')::INTERVAL;
  GET DIAGNOSTICS v_deactivated = ROW_COUNT;

  UPDATE reddit_intel_themes t
  SET is_active = TRUE, updated_at = NOW()
  WHERE NOT t.is_active
    AND t.last_seen_at >= NOW() - (p_inactive_after_days || ' days')::INTERVAL;

  SELECT COUNT(*) INTO v_births_7d
  FROM reddit_intel_themes
  WHERE first_seen_at >= NOW() - INTERVAL '7 days';

  RETURN json_build_object(
    'strong_themes', v_strong,
    'deactivated', v_deactivated,
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
