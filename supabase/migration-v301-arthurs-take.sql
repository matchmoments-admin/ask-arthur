-- Migration v301: Arthur's Take columns on reddit_post_intel + a review table
--
-- WHY
--
-- The public feed re-publishes Reddit scam reports as excerpts. They are
-- someone else's story, they add no Ask Arthur analysis, and they are not
-- unique content. Meanwhile reddit_post_intel already holds a good structured
-- read of every one of those posts — intent label, modus operandi, tactics,
-- brands, a neutral summary — produced daily and never shown to a reader.
--
-- "Arthur's Take" is the reader-facing half of that existing analysis. It is
-- NOT a second pipeline: these columns hang off the row the classifier already
-- writes, under the same brake, the same taxonomy and the same retention job.
-- See docs/arthurs-take/DECISIONS.md X1.
--
-- The take fields are written by a separate, cheaper second-stage call (Haiku)
-- that reads the STRUCTURED row rather than the raw post, which is why they
-- carry their own model/prompt version: regenerating a take must not mean
-- reclassifying, and re-tuning reader-facing wording must not invalidate the
-- intel prompt's cache key or its golden set.
--
-- Additive and idempotent. No existing column changes meaning.

BEGIN;

ALTER TABLE public.reddit_post_intel
  -- Is this post a report of a scam at all? Distinct from intent_label: a
  -- post can be confidently `phishing`-shaped and still be someone asking
  -- whether a legitimate message is safe. A boolean keeps this OUT of the
  -- 15-value taxonomy, which is shared with feed_items.category and the brand
  -- aggregation RPCs and must not grow a 16th value for a different question.
  ADD COLUMN IF NOT EXISTS is_scam_report BOOLEAN,

  -- Up to 3 pattern-level "tells". Never names a person, amount, handle,
  -- phone or email — enforced by the take validator before the write, because
  -- these are rendered publicly and indexed.
  ADD COLUMN IF NOT EXISTS take_tells TEXT[] NOT NULL DEFAULT '{}',

  -- One sentence on where/how this pattern shows up, globally. The corpus is
  -- ~98% non-Australian and new scams surface overseas first, so the take is
  -- deliberately not AU-only (DECISIONS.md X2).
  ADD COLUMN IF NOT EXISTS take_where TEXT,

  -- One sentence on the Australian presentation of the same pattern. NULL
  -- when there is no genuine local analogue — an invented one is worse than
  -- none.
  ADD COLUMN IF NOT EXISTS take_au_line TEXT,

  ADD COLUMN IF NOT EXISTS take_status TEXT NOT NULL DEFAULT 'none'
    CHECK (take_status IN ('none', 'ready', 'suppressed', 'failed')),
  ADD COLUMN IF NOT EXISTS take_suppressed_reason TEXT,
  ADD COLUMN IF NOT EXISTS take_model_version TEXT,
  ADD COLUMN IF NOT EXISTS take_prompt_version TEXT,
  ADD COLUMN IF NOT EXISTS take_written_at TIMESTAMPTZ,

  -- NOT YET WRITTEN BY ANYTHING. Intended for the cluster step, to feed the
  -- "new this week" surface and give the take writer a hint. The computation
  -- it needs (theme age, novelty-signal diff against a 28-day baseline, new
  -- brand) lands with the novelty work; until then every row reads FALSE.
  -- Stated plainly here rather than described as if the writer exists: a
  -- comment claiming a control nothing enforces is this repo's most-repeated
  -- defect, and a self-review of this migration caught it doing exactly that.
  ADD COLUMN IF NOT EXISTS is_emerging BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.reddit_post_intel.take_status IS
  'none = no take attempted; ready = renderable; suppressed = deliberately '
  'withheld (validator or confidence rule, see take_suppressed_reason); '
  'failed = generation error, retryable.';

-- Partial index: every reader-facing query filters to ready takes, which are a
-- minority of rows while the backfill is incomplete.
CREATE INDEX IF NOT EXISTS idx_rpi_take_ready
  ON public.reddit_post_intel (take_written_at DESC)
  WHERE take_status = 'ready';

-- Human review is the ground truth for the accuracy gate. Reddit comments are
-- not ingested (and adding them would be a new Reddit surface plus a PIA
-- amendment), so the consensus label the brief proposed is not available —
-- DECISIONS.md X9.
CREATE TABLE IF NOT EXISTS public.reddit_post_intel_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intel_id UUID NOT NULL
    REFERENCES public.reddit_post_intel(id) ON DELETE CASCADE,
  verdict TEXT NOT NULL CHECK (verdict IN (
    'agree',          -- take is right
    'wrong_type',     -- intent_label is wrong; corrected_label carries the fix
    'not_a_scam',     -- is_scam_report should have been false
    'unsafe_wording', -- reads as accusing a person, or is alarmist
    'pii'             -- leaked a name / handle / number the validator missed
  )),
  corrected_label TEXT,
  note TEXT,
  reviewer TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rpi_reviews_intel
  ON public.reddit_post_intel_reviews (intel_id);
CREATE INDEX IF NOT EXISTS idx_rpi_reviews_created
  ON public.reddit_post_intel_reviews (created_at DESC);

-- Same posture as every reddit_intel_* table (v82:201-225): service-role only.
-- These rows are read by server components through the service client, never
-- by anon/authenticated directly, so there is no public SELECT policy.
ALTER TABLE public.reddit_post_intel_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reddit_post_intel_reviews_service_all
  ON public.reddit_post_intel_reviews;
CREATE POLICY reddit_post_intel_reviews_service_all
  ON public.reddit_post_intel_reviews
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

COMMIT;

-- Verification (run after apply):
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name='reddit_post_intel' AND column_name LIKE 'take_%';
--     → take_tells, take_where, take_au_line, take_status,
--       take_suppressed_reason, take_model_version, take_prompt_version,
--       take_written_at
--
--   SELECT take_status, count(*) FROM reddit_post_intel GROUP BY 1;
--     → 100% 'none' until the generation PR ships behind its flag
--
--   SELECT relrowsecurity FROM pg_class
--   WHERE oid='public.reddit_post_intel_reviews'::regclass;  → true
