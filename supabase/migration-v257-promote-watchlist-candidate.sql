-- v257 — promotion: candidate → monitored brand, in one transaction
--
-- WHY: promoting a brand onto the clone-watch watchlist has been a
-- compile-time array edit + brand_aliases re-seed + PR + preview + deploy.
-- Measured cost of that friction: 51 candidates surfaced over a month, ZERO
-- promoted. v256 gave the runtime overlay a house org and a domain guard; this
-- is the operation that uses them.
--
-- Promotion is TWO writes that must not come apart:
--   1. insert/activate the brand in monitored_brands (the matcher overlay)
--   2. mark the candidate 'promoted' (so discovery stops re-surfacing it)
-- Split across two round-trips, a failure between them leaves either a
-- monitored brand that discovery keeps re-announcing as unwatched, or a
-- candidate marked done that nothing is actually watching. One function, one
-- transaction, no half-state.
--
-- THE DOMAIN IS MANDATORY AND IS NOT GUESSED. legitimate_domains is the
-- matcher's EXCLUSION list, so a wrong entry does not merely fail to help — it
-- creates a blind spot, permanently excluding a domain that might itself be
-- the clone. The v256 CHECK already refuses a verified brand with no domains;
-- this function refuses the call outright so the caller gets a usable error
-- instead of a 23514.
--
-- Cold tables. Idempotent (re-promoting an already-promoted brand is a no-op
-- that refreshes domains rather than an error).

CREATE OR REPLACE FUNCTION public.promote_watchlist_candidate(
  p_brand_normalized TEXT,
  p_brand_name       TEXT,
  p_domains          TEXT[],
  p_aliases          TEXT[] DEFAULT '{}',
  p_note             TEXT   DEFAULT NULL,
  p_source           TEXT   DEFAULT 'manual'
)
RETURNS TABLE (
  monitored_brand_id BIGINT,
  candidate_updated  BOOLEAN
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  -- Reserved house org (v256). monitored_brands.org_id has no FK and there is
  -- no orgs table, so this is a sentinel, not a reference.
  v_house_org  CONSTANT uuid := '00000000-0000-4000-8000-000000000001';
  v_domains    TEXT[];
  v_aliases    TEXT[];
  v_id         BIGINT;
  v_updated    INT;
BEGIN
  IF COALESCE(TRIM(p_brand_name), '') = '' THEN
    RAISE EXCEPTION 'brand_name is required' USING ERRCODE = '22023';
  END IF;
  IF public.brand_normalize(p_brand_normalized) IS NULL THEN
    RAISE EXCEPTION 'brand_normalized % does not normalise to a usable key',
      p_brand_normalized USING ERRCODE = '22023';
  END IF;

  -- Normalise + de-dupe the domain list the same way the TS matcher does:
  -- lowercase, strip scheme/www/path/trailing dot, drop blanks.
  SELECT COALESCE(array_agg(DISTINCT d), '{}')
  INTO v_domains
  FROM (
    SELECT regexp_replace(
             regexp_replace(lower(btrim(x)), '^https?://', ''),
             '^www\.|/.*$|\.$', '', 'g'
           ) AS d
    FROM unnest(COALESCE(p_domains, '{}')) AS x
  ) s
  WHERE d <> '';

  IF cardinality(v_domains) = 0 THEN
    RAISE EXCEPTION
      'at least one legitimate domain is required to promote % — it is the matcher''s exclusion list, not decoration',
      p_brand_name USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT btrim(a)), '{}')
  INTO v_aliases
  FROM unnest(COALESCE(p_aliases, '{}')) AS a
  WHERE btrim(a) <> '';

  -- Upsert on the v207 (org_id, brand_normalized) UNIQUE. Re-promoting
  -- refreshes the domain/alias lists and re-activates rather than erroring, so
  -- an operator correcting a typo does not need a delete first.
  INSERT INTO public.monitored_brands AS mb (
    org_id, brand_name, brand_normalized, legitimate_domains, aliases,
    verification_method, verification_status, verified_at, is_active
  )
  VALUES (
    v_house_org,
    btrim(p_brand_name),
    public.brand_normalize(p_brand_normalized),
    v_domains,
    v_aliases,
    'manual',
    'verified',
    NOW(),
    TRUE
  )
  ON CONFLICT (org_id, brand_normalized) DO UPDATE SET
    brand_name         = EXCLUDED.brand_name,
    legitimate_domains = EXCLUDED.legitimate_domains,
    aliases            = EXCLUDED.aliases,
    verification_status = 'verified',
    verified_at        = NOW(),
    is_active          = TRUE,
    updated_at         = NOW()
  RETURNING mb.id INTO v_id;

  -- Move the candidate across the predicate discovery filters on. If this is
  -- skipped the brand is monitored AND re-announced weekly as unwatched —
  -- the exact split this function exists to make impossible.
  UPDATE public.reddit_watchlist_candidates
  SET status            = 'promoted',
      status_note       = COALESCE(
                            p_note,
                            'Promoted to the monitored overlay (' || p_source || ').'
                          ),
      status_changed_at = NOW()
  WHERE brand_normalized = public.brand_normalize(p_brand_normalized)
    AND status IS DISTINCT FROM 'promoted';
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  monitored_brand_id := v_id;
  candidate_updated  := v_updated > 0;
  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.promote_watchlist_candidate(
  TEXT, TEXT, TEXT[], TEXT[], TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_watchlist_candidate(
  TEXT, TEXT, TEXT[], TEXT[], TEXT, TEXT
) TO service_role;

COMMENT ON FUNCTION public.promote_watchlist_candidate(
  TEXT, TEXT, TEXT[], TEXT[], TEXT, TEXT
) IS
  'Atomically add a brand to the monitored_brands overlay under the house org '
  'and mark its watchlist candidate promoted (v257). Refuses an empty domain '
  'list: legitimate_domains is the matcher''s exclusion list, so a missing or '
  'wrong entry creates a permanent blind spot rather than a missed alert.';

-- ── Undo ──────────────────────────────────────────────────────────────────
--
-- Auto-promotion needs a one-call reversal, otherwise the safe response to a
-- bad promotion is "write SQL by hand at 6am". Deactivates rather than deletes
-- so the decision history survives, and returns the candidate to 'pending' so
-- it re-enters the review queue instead of vanishing.
CREATE OR REPLACE FUNCTION public.demote_watchlist_candidate(
  p_brand_normalized TEXT,
  p_note             TEXT DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_house_org CONSTANT uuid := '00000000-0000-4000-8000-000000000001';
  v_changed   INT;
BEGIN
  UPDATE public.monitored_brands
  SET is_active = FALSE, updated_at = NOW()
  WHERE org_id = v_house_org
    AND brand_normalized = public.brand_normalize(p_brand_normalized)
    AND is_active;
  GET DIAGNOSTICS v_changed = ROW_COUNT;

  UPDATE public.reddit_watchlist_candidates
  SET status            = 'pending',
      status_note       = COALESCE(p_note, 'Promotion reverted.'),
      status_changed_at = NOW()
  WHERE brand_normalized = public.brand_normalize(p_brand_normalized)
    AND status = 'promoted';

  RETURN v_changed;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.demote_watchlist_candidate(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.demote_watchlist_candidate(TEXT, TEXT)
  TO service_role;

COMMENT ON FUNCTION public.demote_watchlist_candidate(TEXT, TEXT) IS
  'Reverse a promotion (v257): deactivate the house-org monitored_brands row '
  'and return the candidate to pending. Deactivates rather than deletes so the '
  'decision history survives.';
