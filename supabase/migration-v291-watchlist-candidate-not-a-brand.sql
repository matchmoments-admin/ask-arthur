-- v291 — reddit_watchlist_candidates: a status for "this is not a brand"
--
-- WHY
-- ---
-- The 2026-08-24 digest offered TWO candidates as ready to promote. One was
-- NAB, already monitored, leaked by a compound classifier label (fixed in code
-- this same PR). The other was
--
--   School / Australia Cancer Relief Fund   (2 AU reports, both advance_fee)
--
-- which returns ZERO matches against acnc_charities (63,637 rows). It is not a
-- brand that exists and got impersonated — it is a name a scammer invented, and
-- the label conflates two things at that.
--
-- The queue could not say so. `dismissed` means "a real brand we chose not to
-- watch" (Reddit-only US brands, platform names); using it here throws away the
-- distinction between "we looked and decided against it" and "there is nothing
-- here to decide about". That distinction is exactly what a future operator —
-- or a future auto-promotion — needs, because a fabricated entity should never
-- become a promotion candidate again no matter how much evidence accrues, while
-- a dismissed real brand legitimately can (see planPromotions' asymmetry note).
--
-- The AU Brand Watchlist exists to protect legitimate brands: promoting a
-- fabricated name would put an invented entity on a list whose whole semantic
-- is "watch for typosquats of this brand's real domain". Today the only thing
-- standing in the way is promote_watchlist_candidate's domain requirement, and
-- that is a soft wall — the operator types the domain, so nothing stops a
-- plausible-looking one being entered.
--
-- Shape follows v255 exactly (that migration is the reference for this table).
-- Idempotent; the reverse is this DDL with the value removed, safe while no row
-- holds it.

-- ── 1. Widen the status CHECK ─────────────────────────────────────────────
ALTER TABLE public.reddit_watchlist_candidates
  DROP CONSTRAINT IF EXISTS reddit_watchlist_candidates_status_check;

ALTER TABLE public.reddit_watchlist_candidates
  ADD CONSTRAINT reddit_watchlist_candidates_status_check
  CHECK (status IN ('pending', 'reviewed', 'dismissed', 'promoted', 'not_a_brand'));

-- ── 2. Teach the single writer about it ───────────────────────────────────
-- Signature is unchanged, so the v255 REVOKE/GRANT carry over untouched.
CREATE OR REPLACE FUNCTION public.set_watchlist_candidate_status(
  p_brand_normalized TEXT,
  p_status           TEXT,
  p_note             TEXT DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_rows INT;
BEGIN
  IF p_status NOT IN ('pending', 'reviewed', 'dismissed', 'promoted', 'not_a_brand') THEN
    RAISE EXCEPTION
      'invalid status %, expected pending|reviewed|dismissed|promoted|not_a_brand',
      p_status USING ERRCODE = '22023';
  END IF;

  UPDATE public.reddit_watchlist_candidates
  SET status            = p_status,
      status_note       = COALESCE(p_note, status_note),
      status_changed_at = NOW()
  WHERE brand_normalized = public.brand_normalize(p_brand_normalized)
    -- No-op when nothing would change, so status_changed_at keeps meaning
    -- "when the decision was made" rather than "when a cron last ran".
    AND (status IS DISTINCT FROM p_status
         OR COALESCE(p_note, '') IS DISTINCT FROM COALESCE(status_note, ''));

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

COMMENT ON FUNCTION public.set_watchlist_candidate_status(TEXT, TEXT, TEXT) IS
  'The only writer of reddit_watchlist_candidates.status (v255, widened v291 '
  'with not_a_brand for fabricated entities). Returns rows changed; 0 means '
  'unknown brand or already in that state.';
