-- v254 — AU-relevance for watchlist candidates
--
-- WHY: reddit-brands-discover surfaces "new brands impersonated" for the
-- clone-watch AU watchlist, but the corpus it reads (r/Scams + r/phishing) is
-- overwhelmingly not Australian. Measured over the 30-day window on
-- 2026-07-27, reddit_post_intel.country_hints across the ingested posts was:
--
--     US 427 | GB 55 | CA 52 | AU 30 | IN 15 | DE 14 | …
--
-- ~93% non-AU. The cron ignored country_hints entirely, so the 2026-07-26
-- digest proposed Xfinity, NextDoor, Chime and Capital One — none of which
-- have an AU consumer-impersonation surface — each at exactly the ≥3 mention
-- floor. The existing defence was a hand-maintained CANDIDATE_DENYLIST naming
-- 8 US brands, while Walmart(15), Verizon(6), USPS(3), Lowe's(3) and
-- Costco(3) sailed past it. A hardcoded blocklist is a worse version of a
-- column we already populate.
--
-- WHAT: store the AU-attributable share of each candidate's mentions, exactly
-- parallel to the existing source_counts/mention_count pair, so the digest can
-- rank and gate on "did this actually hit Australians" instead of raw global
-- volume.
--
-- Deliberately NOT a hard AU filter. Measured: the AU-hinted subset of the same
-- window tops out at 2 posts for a single brand (Facebook Marketplace), so a
-- ≥3 AU gate would return zero candidates forever and the feature would go
-- silent while looking healthy. AU relevance is a ranking + announce signal
-- here; the table keeps recording everything.
--
-- reddit_watchlist_candidates is a cold table (51 rows at time of writing) —
-- an ALTER + column add is trivial and needs no chunking. Idempotent.

-- ── 1. Per-source AU counts, mirroring source_counts ──────────────────────
--
-- au_counts is the per-source breakdown; au_mention_count is the denormalised
-- sum, kept in the same relationship to au_counts as mention_count has to
-- source_counts. Existing rows get 0 rather than a guess — they predate any
-- AU attribution, and inventing one would poison the first ranked digest.
ALTER TABLE public.reddit_watchlist_candidates
  ADD COLUMN IF NOT EXISTS au_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS au_mention_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.reddit_watchlist_candidates.au_counts IS
  'Per-source count of AU-attributable mentions (v254). Reddit: posts whose '
  'reddit_post_intel.country_hints contains ''AU''. scam_reports: all of them '
  '— a report submitted to an AU consumer platform is AU-native by construction.';
COMMENT ON COLUMN public.reddit_watchlist_candidates.au_mention_count IS
  'Denormalised SUM(au_counts) (v254). Always <= mention_count.';

-- Ranked pending queue, AU-relevant first. Partial index on the same status
-- predicate as idx_rwc_pending so the admin queue and the digest can both
-- order by "does this matter here" without a sort.
CREATE INDEX IF NOT EXISTS idx_rwc_pending_au
  ON public.reddit_watchlist_candidates (au_mention_count DESC, mention_count DESC)
  WHERE status = 'pending';

-- ── 2. AU-aware upsert ────────────────────────────────────────────────────
--
-- A NEW OVERLOAD, not a replacement. The 5-arg upsert_watchlist_candidate
-- (v196) is deliberately left in place: migrations are applied to prod BEFORE
-- the code that uses them merges, so dropping the old signature would break
-- the currently-deployed weekly run in the gap between the two. A later
-- cleanup migration can drop the 5-arg form once no deployed code calls it.
--
-- Note this is exactly the class of bug the untyped-.rpc() problem hides:
-- createServiceClient() omits the <Database> generic, so a mismatched argument
-- list typechecks clean and only fails at runtime as PGRST202. The smoke test
-- in packages/scam-engine/src/__tests__/rpcs.smoke.test.ts is the real gate.
CREATE OR REPLACE FUNCTION public.upsert_watchlist_candidate(
  p_brand_normalized   TEXT,
  p_raw_brand          TEXT,
  p_source             TEXT,
  p_source_count       INT,
  p_au_count           INT,
  p_resolved_canonical TEXT
)
RETURNS VOID
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  -- Alias the conflict target (wc) so the existing row's columns can be
  -- referenced without schema-qualification, which Postgres rejects in the
  -- ON CONFLICT SET clause. EXCLUDED is the proposed-insert row.
  INSERT INTO public.reddit_watchlist_candidates AS wc
    (brand_normalized, raw_brand, mention_count, au_mention_count,
     resolved_canonical, source, source_counts, au_counts)
  VALUES (
    p_brand_normalized,
    p_raw_brand,
    GREATEST(p_source_count, 0),
    -- An AU count can never exceed the source count that contains it; clamp
    -- rather than trust the caller, so au_mention_count <= mention_count is a
    -- guaranteed invariant of the table and not a convention.
    LEAST(GREATEST(p_au_count, 0), GREATEST(p_source_count, 0)),
    p_resolved_canonical,
    p_source,
    jsonb_build_object(p_source, GREATEST(p_source_count, 0)),
    jsonb_build_object(
      p_source,
      LEAST(GREATEST(p_au_count, 0), GREATEST(p_source_count, 0))
    )
  )
  ON CONFLICT (brand_normalized) DO UPDATE SET
    source_counts = wc.source_counts
                    || jsonb_build_object(p_source, GREATEST(p_source_count, 0)),
    mention_count = (
      SELECT COALESCE(SUM(e.val::int), 0)
      FROM jsonb_each_text(
        wc.source_counts || jsonb_build_object(p_source, GREATEST(p_source_count, 0))
      ) AS e(key, val)
    ),
    au_counts = wc.au_counts
                || jsonb_build_object(
                     p_source,
                     LEAST(GREATEST(p_au_count, 0), GREATEST(p_source_count, 0))
                   ),
    au_mention_count = (
      SELECT COALESCE(SUM(e.val::int), 0)
      FROM jsonb_each_text(
        wc.au_counts || jsonb_build_object(
          p_source,
          LEAST(GREATEST(p_au_count, 0), GREATEST(p_source_count, 0))
        )
      ) AS e(key, val)
    ),
    raw_brand          = EXCLUDED.raw_brand,
    resolved_canonical = COALESCE(EXCLUDED.resolved_canonical, wc.resolved_canonical),
    last_seen_at       = NOW();
$$;

REVOKE EXECUTE ON FUNCTION public.upsert_watchlist_candidate(
  TEXT, TEXT, TEXT, INT, INT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_watchlist_candidate(
  TEXT, TEXT, TEXT, INT, INT, TEXT
) TO service_role;

-- ── 3. AU-aware Reddit aggregate ──────────────────────────────────────────
--
-- Pushes the country_hints join server-side so only aggregated rows ship,
-- rather than pulling every brands_impersonated array into the function.
-- One row per canonical-ish raw brand with both the total and AU post counts.
--
-- Counts DISTINCT posts, not array entries: a post listing the same brand
-- twice is one mention, matching the TS aggregateBrandMentions() contract.
CREATE OR REPLACE FUNCTION public.aggregate_reddit_brands_with_au(
  p_since     TIMESTAMPTZ,
  p_min_count INT DEFAULT 1
)
RETURNS TABLE (
  brand_normalized TEXT,
  raw_brand        TEXT,
  mention_count    INT,
  au_count         INT
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_catalog
STABLE
AS $$
  WITH exploded AS (
    SELECT DISTINCT
      i.id                                            AS post_id,
      public.brand_normalize(b)                       AS norm,
      TRIM(b)                                         AS brand,
      COALESCE(i.country_hints @> ARRAY['AU'], FALSE) AS is_au
    FROM public.reddit_post_intel i
    CROSS JOIN LATERAL unnest(COALESCE(i.brands_impersonated, ARRAY[]::text[])) AS b
    WHERE i.processed_at > p_since
      -- brand_normalize() is the SAME key the TS side uses (v174 / the
      -- brandNormalize() twin in packages/shopfront-glue). Grouping on
      -- anything else here would silently split "PayPal" from "Paypal" and
      -- desync the join against brand_aliases and the watchlist.
      AND public.brand_normalize(b) IS NOT NULL
  )
  SELECT
    e.norm::TEXT AS brand_normalized,
    -- Representative human-readable label: the most frequently seen spelling
    -- of this canonical brand, so the digest shows "American Express" rather
    -- than whichever variant happened to sort first.
    mode() WITHIN GROUP (ORDER BY e.brand)::TEXT AS raw_brand,
    COUNT(DISTINCT e.post_id)::INT               AS mention_count,
    COUNT(DISTINCT e.post_id) FILTER (WHERE e.is_au)::INT AS au_count
  FROM exploded e
  GROUP BY e.norm
  HAVING COUNT(DISTINCT e.post_id) >= GREATEST(p_min_count, 1);
$$;

REVOKE EXECUTE ON FUNCTION public.aggregate_reddit_brands_with_au(TIMESTAMPTZ, INT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aggregate_reddit_brands_with_au(TIMESTAMPTZ, INT)
  TO service_role;

COMMENT ON FUNCTION public.aggregate_reddit_brands_with_au(TIMESTAMPTZ, INT) IS
  'Windowed brand-mention aggregate over reddit_post_intel with the AU-hinted '
  'subset counted separately (v254). Used by reddit-brands-discover to rank '
  'and gate watchlist candidates by Australian relevance instead of raw global '
  'volume. Read-only; no write, no index added to any hot table.';
