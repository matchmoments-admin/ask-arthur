-- v86: track which embedding model produced each vector.
--
-- WHY: Voyage and OpenAI both ship new embedding model versions on a
-- multi-month cadence. When we ladder voyage-3.5 -> voyage-4 (or swap
-- in voyage-finance-2 for the crypto/investment vertical), we need to
-- know which existing vectors are already on the new model and which
-- need re-embedding. Without a sibling version column, mid-rollout
-- queries cosine-compare vectors from different model spaces and
-- produce silent garbage clusters.
--
-- See docs/adr/0003-embedding-model-versioning.md for the policy:
-- every embedding-bearing column gets a TEXT *_model_version sibling,
-- written from EmbedResult.modelId at insert time. New vectors land
-- with the current model; old vectors are backfilled to the
-- model that produced them (here: 'voyage-3') after this migration
-- applies.
--
-- IDEMPOTENT: ALTER TABLE ... ADD COLUMN IF NOT EXISTS and
-- CREATE INDEX IF NOT EXISTS make this safe to re-apply.

-- ---------------------------------------------------------------------------
-- 1. reddit_post_intel.embedding_model_version
-- ---------------------------------------------------------------------------

ALTER TABLE reddit_post_intel
  ADD COLUMN IF NOT EXISTS embedding_model_version TEXT;

COMMENT ON COLUMN reddit_post_intel.embedding_model_version IS
  'The Voyage/OpenAI model id (e.g. ''voyage-3.5'') that produced the '
  'embedding column. NULL only for rows whose embedding was never '
  'computed. See docs/adr/0003-embedding-model-versioning.md.';

CREATE INDEX IF NOT EXISTS reddit_post_intel_embedding_model_version_idx
  ON reddit_post_intel (embedding_model_version)
  WHERE embedding IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. reddit_intel_themes.centroid_embedding_model_version
-- ---------------------------------------------------------------------------

ALTER TABLE reddit_intel_themes
  ADD COLUMN IF NOT EXISTS centroid_embedding_model_version TEXT;

COMMENT ON COLUMN reddit_intel_themes.centroid_embedding_model_version IS
  'Model id that produced the centroid_embedding column. Should match '
  'the embedding_model_version of the member posts whose vectors were '
  'averaged to form the centroid. See ADR-0003.';

CREATE INDEX IF NOT EXISTS reddit_intel_themes_centroid_model_version_idx
  ON reddit_intel_themes (centroid_embedding_model_version)
  WHERE centroid_embedding IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Backfill: tag existing rows as voyage-3 (the model in use until this
--    migration; the embed() default flips to voyage-3.5 in the same PR).
-- ---------------------------------------------------------------------------

UPDATE reddit_post_intel
   SET embedding_model_version = 'voyage-3'
 WHERE embedding_model_version IS NULL
   AND embedding IS NOT NULL;

UPDATE reddit_intel_themes
   SET centroid_embedding_model_version = 'voyage-3'
 WHERE centroid_embedding_model_version IS NULL
   AND centroid_embedding IS NOT NULL;
