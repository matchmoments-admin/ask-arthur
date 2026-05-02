# Embedding model versioning

**Status:** accepted (2026-05-03)

Every pgvector column we write must have a sibling `*_model_version TEXT` column that records the embedding model id (e.g. `voyage-3.5`) that produced the vector. The version is sourced from `EmbedResult.modelId` in `packages/scam-engine/src/embeddings.ts` and persisted at insert/update time.

We adopted this because Voyage and OpenAI ship new embedding model generations on a multi-month cadence, and we plan to add domain-specific models (`voyage-finance-2` for crypto/investment scams, `voyage-multimodal-3.5` for image+text). Vectors from different models live in different geometric spaces — cosine-comparing them silently produces garbage. Without a version column, a mid-rollout state (some rows on the old model, some on the new) is undetectable, and any cluster job operating across the mix produces incoherent themes that look correct from the outside.

## Reindex policy

When a model is deprecated or being rolled forward:

1. Add the new model id to `SPECS` in `embeddings.ts`. Do not flip the default yet.
2. Re-embed all rows with `embedding_model_version != <new>` in batches via an Inngest job. Each row gets the new vector + the new version stamped atomically.
3. Once `SELECT count(*) FROM <table> WHERE embedding_model_version != <new>` reaches zero, flip the default in `SPECS`.
4. Keep the old model id callable (do not delete from `SPECS`) for at least 30 days so any in-flight retries don't fail.

For `reddit_intel_themes.centroid_embedding_model_version` specifically: a centroid is the running mean of post embeddings. During a rollout, a centroid's version is stamped with the most-recent contributor's model. A future re-embed sweep should detect any centroid whose `centroid_embedding_model_version` is older than the modal version of its current member posts and recompute it from scratch.

## Why not infer the model from a single global "current model" config?

Because re-embeds are not atomic. The window where some rows have the new vector and some have the old can last hours. During that window we need to know per-row which model was used. A per-row tag is the only correct primitive.

## Why not store the model id in metadata JSONB?

Querying JSONB is more expensive and the column is load-bearing for the reindex policy above (we filter by it constantly). A first-class column with an index keyed on `WHERE embedding IS NOT NULL` is the right ergonomic and performance trade.
