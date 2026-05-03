# Query-vector retention

**Status:** accepted (2026-05-04)

Query-time embeddings — the 1024-dim vectors we compute from a B2B client's search query in `/api/v1/intel/search` and `/api/v1/scams/search`, or from a charity-name lookup in the consumer charity-check pillar — are **not persisted**. They live in memory for the duration of the request, get used to call the relevant `match_*` RPC, and are discarded when the response returns.

We adopted this because the alternative (caching query vectors keyed by `hash(text)` to dedupe re-queries) carries privacy risk that outweighs the cost saving. A B2B client searching "did anyone report a scam from $vendor at $email" exposes data we shouldn't retain past the single request — even hashed. Our consumer charity-check pillar is similar: the user is asking "is THIS charity legit", and the question itself is sensitive.

## What this allows and forbids

- **Allowed**: in-memory caching within a single Next.js Lambda invocation (e.g. retry the same query inside one request).
- **Allowed**: retaining the resulting _match list_ (post-RPC, post-rerank) in our standard request logs subject to the existing retention policy — those are derived results about our corpus, not the inbound query.
- **Allowed**: cost_telemetry rows tagged with stage=`query-embed` that include the model id, token count, and a request id. These don't carry the query text.
- **Forbidden**: persisting the query embedding vector in any table.
- **Forbidden**: caching query embeddings in Redis keyed by hash(text). Even hashed, the vector itself is enough to re-derive close-paraphrase queries via known-plaintext attacks.
- **Forbidden**: passing query text into Voyage's training data. Set the dashboard's "zero-day retention" toggle to ON for our Voyage account (this is an org-wide setting, applies to all our calls).

## Document-side embeddings are different

This ADR governs **query** vectors only. The document embeddings we persist on `scam_reports.embedding`, `verified_scams.embedding`, `acnc_charities.name_mission_embedding`, `reddit_post_intel.embedding`, etc. are stored long-term — they're our corpus. ADR-0003 governs their lifecycle (re-embed on model swaps, version-tag every row). The retention rule for document embeddings is "as long as the source row lives"; for queries it's "request-lifetime only".

## Why not implement an explicit retention TTL?

Because the simplest safe state is "never write the query vector to disk." A TTL would be additional complexity to enforce a policy a cleaner architecture can guarantee structurally. If a future feature genuinely needs query-vector caching (e.g. a heavily-trafficked B2B endpoint with paraphrase repetition), revisit this ADR — explicitly in-scope for amendment, not in-scope for ad-hoc bypass.

## Why not log the query text either?

Inbound query text from B2B clients is logged at the API gateway for debugging and rate-limit reasons (existing api_keys + log_api_usage path), retained 90 days, and is subject to the standard data-handling commitments in our API agreement. The query embedding adds nothing to that log — it's a derived form of the same text. Not writing it to a vector column is what this ADR enforces.
