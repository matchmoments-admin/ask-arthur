-- v255 — make the watchlist-candidate queue actionable
--
-- WHY: v187 gave reddit_watchlist_candidates a status lifecycle
-- ('pending' → 'reviewed' | 'dismissed') and NOTHING HAS EVER WRITTEN TO IT.
-- Measured 2026-07-27:
--
--     51 rows | pending 51 | reviewed 0 | dismissed 0
--
-- Not one candidate actioned since the first run on 2026-06-27, because there
-- is no writer anywhere in the codebase: /admin/brand-register renders
-- curation_status read-only, and no route, action or RPC can set it. The
-- weekly digest asked a human to do something the system provided no way to
-- do, so the queue grew monotonically and the digest became noise to scroll
-- past. A review queue with no review action is a to-do list nobody can tick.
--
-- WHAT:
--   1. status_changed_at / status_note, so a decision carries a timestamp and
--      a reason rather than being an unattributed enum flip.
--   2. 'promoted' added to the status CHECK — reserved for the promotion path
--      (v256+). Adding the value now avoids a second constraint rewrite later;
--      nothing writes it yet.
--   3. set_watchlist_candidate_status() — the single writer, service-role only.
--
-- Cold table (51 rows). Idempotent.

-- ── 1. Decision provenance ────────────────────────────────────────────────
ALTER TABLE public.reddit_watchlist_candidates
  ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status_note       TEXT;

COMMENT ON COLUMN public.reddit_watchlist_candidates.status_changed_at IS
  'When status last moved off its previous value (v255). NULL = never actioned.';
COMMENT ON COLUMN public.reddit_watchlist_candidates.status_note IS
  'Free-text reason for the current status (v255) — e.g. "platform, not an '
  'impersonated brand". Read by the admin queue, never by the matcher.';

-- ── 2. Widen the status CHECK to reserve 'promoted' ───────────────────────
-- The v187 constraint is ('pending','reviewed','dismissed'). Dropping and
-- recreating is safe here: every existing row is 'pending', so no row can
-- violate the wider set.
ALTER TABLE public.reddit_watchlist_candidates
  DROP CONSTRAINT IF EXISTS reddit_watchlist_candidates_status_check;
ALTER TABLE public.reddit_watchlist_candidates
  ADD CONSTRAINT reddit_watchlist_candidates_status_check
  CHECK (status IN ('pending', 'reviewed', 'dismissed', 'promoted'));

-- ── 3. The single writer ──────────────────────────────────────────────────
--
-- Returns the number of rows actually changed (0 = unknown brand_normalized),
-- so the caller can distinguish "no-op" from "done" instead of assuming
-- success. Status is validated here as well as by the table CHECK, because a
-- CHECK violation surfaces as an opaque 23514 rather than a usable error.
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
  v_changed INT;
BEGIN
  IF p_status NOT IN ('pending', 'reviewed', 'dismissed', 'promoted') THEN
    RAISE EXCEPTION 'invalid status %, expected pending|reviewed|dismissed|promoted',
      p_status USING ERRCODE = '22023';
  END IF;

  UPDATE public.reddit_watchlist_candidates
  SET status            = p_status,
      status_note       = COALESCE(p_note, status_note),
      status_changed_at = NOW()
  WHERE brand_normalized = p_brand_normalized
    -- No-op when nothing would change, so status_changed_at keeps meaning
    -- "when the decision was made" rather than "when someone last clicked".
    AND (status IS DISTINCT FROM p_status
         OR COALESCE(p_note, '') IS DISTINCT FROM COALESCE(status_note, ''));

  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_watchlist_candidate_status(TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_watchlist_candidate_status(TEXT, TEXT, TEXT)
  TO service_role;

COMMENT ON FUNCTION public.set_watchlist_candidate_status(TEXT, TEXT, TEXT) IS
  'The only writer of reddit_watchlist_candidates.status (v255). Returns rows '
  'changed; 0 means the brand is unknown or already in that state.';

-- ── 4. Retroactive dismissal of the platform backlog ──────────────────────
--
-- The CANDIDATE_DENYLIST in reddit-brands-discover.ts filters at WRITE time
-- but never cleaned up rows written before it existed. 10 platform names are
-- still sitting 'pending' — Discord 14, Reddit 14, LinkedIn 13, Facebook
-- Marketplace 10, Meta 8, Steam 6, Shop 5, TikTok 5, Telegram 3, X (Twitter) 3
-- — 81 mentions of queue weight that no human will ever promote, because they
-- are venues where scams happen, not brands anyone clones.
--
-- Dismissed rather than DELETEd on purpose: a deleted row is indistinguishable
-- from one never seen, so the next run would re-surface it as net-new. The
-- dismissal IS the memory. (This is the same class of mistake as a re-submit
-- path that fails to move a row across the predicate its consumer filters on.)
--
-- Only touches rows still 'pending', so re-running cannot overwrite a human
-- decision made after this migration.
UPDATE public.reddit_watchlist_candidates
SET status            = 'dismissed',
    status_note       = 'Auto-dismissed (v255): platform/venue name, not an impersonated brand.',
    status_changed_at = NOW()
WHERE status = 'pending'
  AND brand_normalized IN (
    'reddit', 'discord', 'linkedin', 'facebook', 'facebookmarketplace', 'meta',
    'instagram', 'tiktok', 'telegram', 'whatsapp', 'steam', 'shop', 'x',
    'twitter', 'xtwitter', 'youtube', 'snapchat'
  );

-- NOTE: the US-only brands (Cash App, Venmo, Zelle, Wells Fargo, Bank of
-- America, Chase, Robinhood, MrBeast) are deliberately NOT dismissed here.
-- v254 made AU evidence a ranked, measured signal (au_mention_count), so they
-- sink in the queue on their own rather than needing a human's hand-maintained
-- judgement baked into a migration. Dismissing them by fiat would re-create in
-- SQL exactly the hardcoded blocklist v254 deleted from TypeScript.
