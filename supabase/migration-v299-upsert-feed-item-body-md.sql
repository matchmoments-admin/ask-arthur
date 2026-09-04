-- Migration v299: give upsert_feed_item() a p_body_md parameter
--
-- WHY
--
-- The Reddit scraper stores `description = selftext[:500]` (reddit_scams.py:898).
-- Measured in prod 2026-09-04: 4,974 of 6,168 Reddit rows have a description of
-- exactly 500 characters — 81% of the corpus is truncated mid-story. The daily
-- Sonnet classifier reads that column (reddit-intel-daily.ts:527-530), so every
-- piece of intel we hold about a long scam narrative is an analysis of its first
-- paragraph. Brands impersonated later in a post, the payment step, and the
-- resolution are all invisible to us.
--
-- feed_items.body_md already exists for exactly this purpose (v97, capped at
-- 50,000 chars by feed_items_body_md_size in v101) and is NULL on every Reddit
-- row, because upsert_feed_item() — the only write path the scrapers use — has
-- no parameter for it. This migration adds one.
--
-- `description` keeps its meaning: the short, public-facing excerpt rendered on
-- /scam-feed. `body_md` is the fuller text, held for analysis. Nothing about
-- what we publish changes; see the privacy-impact note shipped alongside.
--
-- WHY DROP-AND-CREATE RATHER THAN CREATE OR REPLACE
--
-- Postgres keys functions on their argument list, so CREATE OR REPLACE with an
-- extra parameter creates a SECOND function rather than replacing the first.
-- pipeline/scrapers/common/db.py calls this RPC POSITIONALLY with 15 arguments;
-- with both a 15-arg and a 16-arg-with-default overload present, that call is
-- ambiguous and fails at runtime with "function upsert_feed_item(...) is not
-- unique". The old signature must go.
--
-- Callers verified before writing this (all continue to work):
--   - pipeline/scrapers/common/db.py:648,678 — positional, 15 args today,
--     updated to 16 in the same PR. A 15-arg call still resolves while the
--     scraper is mid-deploy because p_body_md defaults to NULL.
--   - packages/scam-engine/src/inngest/feed-sync.ts:61,152 — named arguments
--     via PostgREST; unaffected by a new trailing parameter.
--
-- DROP + CREATE loses the function's grants, so the v104 lockdown
-- (REVOKE from anon/authenticated/PUBLIC, GRANT to service_role) is re-applied
-- at the bottom. Without that, the recreated function would silently become
-- executable by anon and re-open the advisor WARN v104 closed.
--
-- Idempotent: safe to re-run. Additive: no data is rewritten.

BEGIN;

DROP FUNCTION IF EXISTS public.upsert_feed_item(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  INT, BOOLEAN, TIMESTAMPTZ
);

CREATE OR REPLACE FUNCTION public.upsert_feed_item(
  p_source            TEXT,
  p_external_id       TEXT,
  p_title             TEXT,
  p_description       TEXT      DEFAULT NULL,
  p_url               TEXT      DEFAULT NULL,
  p_source_url        TEXT      DEFAULT NULL,
  p_category          TEXT      DEFAULT NULL,
  p_channel           TEXT      DEFAULT NULL,
  p_r2_image_key      TEXT      DEFAULT NULL,
  p_reddit_image_url  TEXT      DEFAULT NULL,
  p_impersonated_brand TEXT     DEFAULT NULL,
  p_country_code      TEXT      DEFAULT NULL,
  p_upvotes           INT       DEFAULT 0,
  p_verified          BOOLEAN   DEFAULT FALSE,
  p_source_created_at TIMESTAMPTZ DEFAULT NULL,
  p_body_md           TEXT      DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id      BIGINT;
  v_is_new  BOOLEAN;
BEGIN
  INSERT INTO feed_items (
    source, external_id, title, description, url, source_url,
    category, channel, r2_image_key, reddit_image_url,
    impersonated_brand, country_code, upvotes, verified, source_created_at,
    body_md
  )
  VALUES (
    p_source, p_external_id, p_title, p_description, p_url, p_source_url,
    p_category, p_channel, p_r2_image_key, p_reddit_image_url,
    p_impersonated_brand, p_country_code, p_upvotes, p_verified, p_source_created_at,
    -- Defence in depth against feed_items_body_md_size: the caller caps too,
    -- but a constraint violation here would fail the whole 500-row batch.
    LEFT(p_body_md, 50000)
  )
  ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL DO UPDATE SET
    upvotes           = EXCLUDED.upvotes,
    description       = COALESCE(EXCLUDED.description, feed_items.description),
    reddit_image_url  = COALESCE(EXCLUDED.reddit_image_url, feed_items.reddit_image_url),
    r2_image_key      = COALESCE(EXCLUDED.r2_image_key, feed_items.r2_image_key),
    category          = COALESCE(EXCLUDED.category, feed_items.category),
    impersonated_brand = COALESCE(EXCLUDED.impersonated_brand, feed_items.impersonated_brand),
    country_code      = COALESCE(feed_items.country_code, EXCLUDED.country_code),
    -- EXCLUDED wins when present so a re-scrape can BACKFILL body_md onto a row
    -- that predates this migration; COALESCE stops a later NULL from wiping it.
    body_md           = COALESCE(EXCLUDED.body_md, feed_items.body_md)
  RETURNING id, (xmax = 0) AS is_new_row
  INTO v_id, v_is_new;

  RETURN json_build_object(
    'feed_item_id', v_id,
    'is_new', v_is_new
  );
END;
$$;

COMMENT ON FUNCTION public.upsert_feed_item IS
  'Feed item insert/update. p_description is the short public excerpt rendered '
  'on /scam-feed; p_body_md (v299) is the fuller source text held for analysis '
  'only, capped at 50k by feed_items_body_md_size.';

-- Re-apply the v104 SECURITY DEFINER lockdown that DROP FUNCTION discarded.
REVOKE EXECUTE ON FUNCTION public.upsert_feed_item(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  INT, BOOLEAN, TIMESTAMPTZ, TEXT
) FROM anon, authenticated, PUBLIC;

GRANT EXECUTE ON FUNCTION public.upsert_feed_item(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  INT, BOOLEAN, TIMESTAMPTZ, TEXT
) TO service_role;

COMMIT;

-- Verification (run after apply):
--
--   SELECT pg_get_function_arguments(oid)
--   FROM pg_proc WHERE proname = 'upsert_feed_item';
--   → exactly ONE row, ending in "p_body_md text DEFAULT NULL::text"
--
--   SELECT grantee, privilege_type FROM information_schema.routine_privileges
--   WHERE routine_schema='public' AND routine_name='upsert_feed_item';
--   → {service_role, postgres} only — never anon or authenticated
--
--   -- after the next Reddit scrape:
--   SELECT count(*) FILTER (WHERE body_md IS NOT NULL) AS with_body,
--          count(*) FILTER (WHERE length(description) = 500) AS truncated
--   FROM feed_items WHERE source = 'reddit';
