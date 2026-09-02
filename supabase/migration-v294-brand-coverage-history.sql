-- v294: record WHEN each brand entered clone-watch coverage (#1075, map #1060).
--
-- Why this table has to exist before any month-over-month claim is published.
--
-- The brand watchlist is a compile-time TypeScript array
-- (packages/shopfront-glue/src/au-brand-watchlist.ts). It has grown 48 -> 293
-- entries since 2026-05-24, and NOTHING in the database records when a brand
-- joined. So "Brand X was targeted 11x more this month" is indistinguishable
-- from "we started watching Brand X mid-last-month" — the numbers look
-- identical and only the second is true.
--
-- This is not hypothetical. Preparing the first targeting report, the two
-- strongest headlines were "The Ordinary up 11x (1 -> 11)" and "Mecca up 4x
-- (3 -> 12)". Both brands were added to the watchlist on 2026-07-21, in a
-- batch of 11 beauty brands. Their "surge" is the second half of July being
-- unmonitored. Publishing either would have been a false claim about a named
-- third party, sourced from our own data.
--
-- Reconstructed from git history of the watchlist file (9 commits):
--   2026-05-24   48 brands
--   2026-05-26  106
--   2026-05-29  212
--   2026-06-07  212
--   2026-06-15  215
--   2026-06-16  282   <- June confounded (+31% coverage mid-month)
--   2026-07-21  293   <- July confounded, for 11 named brands only
--   (unchanged since) August and September are CLEAN
--
-- HONEST LIMITS, so no one later mistakes this for more than it is:
--   * Granularity is the COMMIT, not the deploy. `covered_from` is when the
--     brand entered the source file; the deploy that made it live may be hours
--     to days later. Sound for month-boundary gates, NOT for day-level claims.
--   * History starts 2026-05-24 (the file's first commit). Anything earlier is
--     unknowable, which is fine — the first alerts are 2026-05.
--   * This records the STATIC list only. The `monitored_brands` overlay (v207)
--     merged by getActiveWatchlist() is not versioned; it has 0 rows today, and
--     if it is ever populated the merge needs its own history or this table
--     silently understates coverage.
--
-- Cold table: a few hundred rows, written by a one-off backfill and thereafter
-- only when the watchlist changes. No hot-table index concerns (CLAUDE.md).

BEGIN;

CREATE TABLE IF NOT EXISTS public.brand_coverage_history (
  -- Display name exactly as it appears in the watchlist ("The Ordinary").
  brand             text NOT NULL,
  -- brandNormalize()'d key, joinable to shopfront_clone_alerts
  -- .target_brand_normalized ("theordinary"). Stored rather than derived so a
  -- future change to brandNormalize cannot silently re-point history.
  brand_normalized  text NOT NULL,
  covered_from      date NOT NULL,
  -- NULL = still covered. Set only if a brand is REMOVED from the watchlist,
  -- which would otherwise read as "never targeted again".
  covered_to        date,
  -- 'git-backfill' for reconstructed rows, 'live' for anything recorded going
  -- forward. Keeps the reconstructed (commit-granular) rows distinguishable
  -- from precise ones.
  source            text NOT NULL DEFAULT 'git-backfill',
  -- The commit the row was reconstructed from, so a reader can audit it.
  source_ref        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (brand_normalized, covered_from)
);

COMMENT ON TABLE public.brand_coverage_history IS
  'When each brand entered clone-watch coverage. Gates month-over-month targeting claims: a brand not covered for the WHOLE of both periods cannot carry a trend claim, because a coverage start is indistinguishable from a targeting rise. Reconstructed from git history of au-brand-watchlist.ts; granularity is the commit, not the deploy. v294.';

COMMENT ON COLUMN public.brand_coverage_history.covered_to IS
  'NULL means still covered. Set when a brand LEAVES the watchlist — otherwise its later silence reads as "no longer targeted" rather than "no longer watched".';

CREATE INDEX IF NOT EXISTS brand_coverage_history_from_idx
  ON public.brand_coverage_history (covered_from);

-- Internal reporting data. No anon/authenticated path exists or should.
ALTER TABLE public.brand_coverage_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brand_coverage_history_service_all ON public.brand_coverage_history;
CREATE POLICY brand_coverage_history_service_all
  ON public.brand_coverage_history
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON public.brand_coverage_history FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.brand_coverage_history TO service_role;

COMMIT;
