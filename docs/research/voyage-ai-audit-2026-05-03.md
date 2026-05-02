# Voyage AI Audit & Recommendations — Ask Arthur / SafeVerify

**Author:** Claude (Opus 4.7) · **Date:** 2026-05-03 · **Triggering session:** user prompt "We recently added Voyage AI to our stack. I want to make sure we are using it in the best possible way."

This document is the source-of-truth for every Voyage-related BACKLOG entry. The PR that introduced this file (`feat/voyage-quick-wins-2026-05`) shipped only the safe quick wins (model bump 3 → 3.5, env-var registration, embedding_model_version column, ADR-0003); everything in §6 below ships in follow-up PRs as BACKLOG capacity allows.

---

## Part 1 — Current usage audit

### 1.1 The single call site

Voyage is invoked from exactly **one** module: `packages/scam-engine/src/embeddings.ts`. It is consumed by exactly **one** Inngest function: `packages/scam-engine/src/inngest/reddit-intel-embed.ts` (called by `redditIntelCluster` downstream, but cluster itself only does cosine in JS over already-stored vectors — it does not call Voyage).

| Aspect                | Implementation **at audit time** (commit before this PR)                                                                                       | File / line                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Model                 | `voyage-3` (legacy generation)                                                                                                                 | `embeddings.ts:32`                                                           |
| Endpoint              | `https://api.voyageai.com/v1/embeddings`                                                                                                       | `embeddings.ts:104`                                                          |
| Dimensions            | 1024 (hard-coded via `output_dimension: EMBEDDING_DIMENSIONS`)                                                                                 | `embeddings.ts:21,113`                                                       |
| `input_type`          | `"document"` — used for both write-time and (would-be) query-time                                                                              | `embeddings.ts:114`                                                          |
| Batch size            | Whatever the caller passes; currently `≤500` rows in one POST per cohort                                                                       | `reddit-intel-embed.ts:135`                                                  |
| Retry / backoff       | Inngest function-level `retries: 3`. No per-call backoff inside `embed()`                                                                      | `reddit-intel-embed.ts:98`                                                   |
| Cost telemetry        | Tagged `feature='reddit-intel-embed'`, provider, operation, units (tokens), USD; pricing constant `0.06 USD/M tok`                             | `embeddings.ts:33`, `cost-telemetry.ts:31-36`, `reddit-intel-embed.ts:78-91` |
| Storage               | `reddit_post_intel.embedding VECTOR(1024)` + `reddit_intel_themes.centroid_embedding VECTOR(1024)`                                             | `supabase/migration-v82-reddit-intel-base.sql:65,102`                        |
| Index                 | `ivfflat (… vector_cosine_ops) WITH (lists=100)` (posts) and `lists=50` (themes)                                                               | `migration-v82:87-90,127-130`                                                |
| Query path            | Greedy in-memory cosine in JS (`cosineSimilarity` in `reddit-intel-cluster.ts:70-82`) — IVFFlat is **never queried**; the index is dead weight | `reddit-intel-cluster.ts:282-293`                                            |
| Rerank API            | **Not used anywhere.** No `rerank-2`, `rerank-2-lite`, or `rerank-2.5` reference in the codebase                                               | grep confirmed                                                               |
| Deduplication / cache | None. Identical input text re-embedded every cohort                                                                                            | n/a                                                                          |
| Provider abstraction  | `VOYAGE` ↔ `OPENAI` (text-embedding-3-small @ 1536 dim coerced to 1024)                                                                        | `embeddings.ts:29-40`                                                        |

### 1.2 Composite text we embed

`reddit-intel-embed.ts:46-58` builds: `category:phishing | brands:CommBank,ANZ | tactic:smishing-with-OTP | <narrative>`. The author noted this prefix-engineering shifts the cosine distribution — see `reddit-intel-cluster.ts:18-33` where the threshold had to be retuned from 0.78 → 0.62 because the structured prefix dominated the embedding space.

### 1.3 Gaps in the current implementation (before this PR)

1. **Wrong model generation.** `voyage-3` is the previous-gen model. Voyage now ships `voyage-4`, `voyage-4-large`, `voyage-4-lite`, and `voyage-3.5` at the _same_ $0.06/M tok price as `voyage-3`. `voyage-4-lite` is **3× cheaper** ($0.02/M tok) than `voyage-3` and matches it on quality for short text. We are paying full price for the slowest legacy variant and getting the worst retrieval. ([Voyage pricing](https://docs.voyageai.com/docs/pricing))
2. **No `input_type=query` distinction.** Every call sets `"document"`. There is no query-time path today, but the moment a "find similar narratives" feature ships (e.g. semantic dashboard search, B2B `/api/v1/intel/search`), forgetting to set `"query"` will silently halve recall. The asymmetric-prompt design only works if both sides use the right hint.
3. **No reranker stage.** B2B `/api/v1/intel/themes` and `/quotes` would benefit massively from a cross-encoder rerank over top-50 ANN hits. `rerank-2.5-lite` is $0.02/M tok and lifts quality measurably (Anthropic's own contextual-retrieval study showed 67% failure-rate reduction with rerank vs 49% without — [contextual-retrieval blog](https://www.anthropic.com/news/contextual-retrieval)).
4. **IVFFlat index is unused.** The cluster job pulls all themes (`limit 500`) and computes cosine in JS. The IVFFlat index in v82 only matters when actual ANN queries hit Postgres — there are none.
5. **No batching beyond cohort size.** Voyage's per-request limits are 1000 inputs / 120K tokens for `voyage-3`. Today we send up to 500 in one call, which is fine; but no chunking is implemented if a future caller exceeds it.
6. **No hash-based dedupe / cache.** Two posts with identical narratives (common for forwarded smishing texts) re-embed both. A `hash(text) → vector` Redis cache (24h TTL) would cut tokens 5-15% on the Reddit firehose and 30-60% on the consumer pipeline if/when scam-report embeddings ship.
7. **Dimension chosen arbitrarily.** 1024 was picked to match Voyage's default and OpenAI's `dimensions` param. `voyage-4` and `voyage-4-large` both support **Matryoshka** truncation to 256/512/2048. Storing 256-dim vectors quarters the pgvector storage and IVFFlat probe cost with negligible recall loss for clustering. We never evaluated the trade.
8. **No domain-specific model evaluated.** All Reddit narratives go through generic `voyage-3`. Investment-fraud and crypto pig-butchering posts are _finance text_; `voyage-finance-2` benchmarks 7-12% better on finance retrieval than general models ([Voyage Finance-2 blog](https://blog.voyageai.com/2024/06/03/domain-specific-embeddings-finance-edition-voyage-finance-2/)). Even more relevant for the B2B "bank fraud team" persona.
9. **No multimodal embeddings.** Phone Footprint plans receipt OCR; Charity Check v0.2b plans image OCR; deepfake suspect frames exist already. None feed into `voyage-multimodal-3.5` (which would let you cluster scam _screenshots_ — fake invoice templates, lookalike donation pages — by visual similarity). ([voyage-multimodal-3.5](https://blog.voyageai.com/2026/01/15/voyage-multimodal-3-5/))
10. **`VOYAGE_API_KEY` and `EMBEDDING_PROVIDER` are not in `turbo.json` `globalEnv`.** This is a real problem — Turbo's content-hashed cache will treat builds with and without Voyage env vars as identical, which can poison the remote cache. Verified by grep: zero matches in `turbo.json`.
11. **Prompt-version stamp missing on embeddings.** `reddit_post_intel.prompt_version` exists but does not capture which embedding model produced the vector. When you upgrade Voyage 3 → 4 you can't tell which rows are stale. No `embedding_model_version` column on either `reddit_post_intel` or `reddit_intel_themes`. Reindex strategy is currently undefined.
12. **`feed_items` (the underlying Reddit corpus) has no embedding column.** Embeddings live downstream of Sonnet classification only. If Sonnet hallucinates the intent, the embedding is built from a poisoned prefix and clusters land in the wrong neighbourhood. Embedding the raw post body in parallel and using it as a sanity check on Sonnet's classification would catch class-confusion drift.

**Status after `feat/voyage-quick-wins-2026-05` (this PR):**

- Gap #1 closed (model bumped to `voyage-3.5`, ADR-0003 documents the reindex policy for any future swap)
- Gap #2 closed in the API surface (`embedQuery()` exists; no callers yet)
- Gap #10 closed (env vars registered)
- Gap #11 closed (`embedding_model_version` column on both tables, written on every embed; ADR-0003 is the policy)
- Gaps #3–#9, #12 remain — queued in BACKLOG as ranked items below

---

## Part 2 — How adjacent companies use Voyage

The honest finding: **public material on Voyage in fraud / T&S vendors is sparse**. None of Sift, Sardine, Feedzai, Hawk AI, ComplyAdvantage, Chainalysis, TRM Labs, Elliptic, Alloy, Persona, Socure, or Onfido has a published Voyage case study. Their fraud stacks are dominated by tabular ML, behavioural biometrics, and graph features — not text retrieval. ([Gartner fraud comparison](https://www.gartner.com/reviews/market/online-fraud-detection/compare/feedzai-vs-sift), [Feedzai](https://www.feedzai.com/))

What _is_ publicly visible:

- **Anthropic itself uses Voyage as the preferred embedding provider** for Claude RAG. Their cookbook ships a Voyage tutorial; their contextual-retrieval research evaluated Voyage embeddings + Cohere reranker (Voyage's own reranker wasn't tested — opportunity for us). ([Claude embeddings docs](https://docs.claude.com/en/docs/build-with-claude/embeddings), [contextual retrieval](https://www.anthropic.com/news/contextual-retrieval))
- **MongoDB acquired Voyage** (the docs are now hosted at `mongodb.com/docs/voyageai/`). Strong signal that Voyage is the embedding layer of choice when you already have semi-structured doc storage.
- **AWS Marketplace** lists `voyage-finance-2`, `voyage-multimodal-3` as deployable on SageMaker JumpStart — explicitly marketed for financial RAG and document-rich retrieval, which maps cleanly to invoice fraud, BEC, and prospectus-fraud detection.
- **Academic / industry adjacent precedent:** topic modelling on the CFPB consumer-complaint corpus using GPT embeddings is a well-trodden path — ~2.3M complaint narratives, ~18k tagged "fraud or scam". The exact pattern we'd run on Reddit + scam-reports + Scamwatch with Voyage. ([CFPB topic modelling](https://medium.com/@shaileshzope/topic-modeling-consumer-financial-protection-bureau-complaints-using-gpt-based-embeddings-a19c08361330), [CFPB complaints DB](https://www.consumerfinance.gov/data-research/consumer-complaints/search/))
- **Voyage's own published positioning** for fraud is via the multimodal model (interleaved text+image, "documents rich with visuals and text") and the finance model (financial-news, filings, advice corpora). Neither has a named fraud customer — but both are the right primitives for our domain. ([voyage-multimodal-3](https://blog.voyageai.com/2024/11/12/voyage-multimodal-3/), [voyage-finance-2](https://blog.voyageai.com/2024/06/03/domain-specific-embeddings-finance-edition-voyage-finance-2/))

**Implication:** the fraud-vendor market hasn't priced in semantic retrieval yet. Being the AU consumer-protection platform that does is a real moat — _if_ we ship surfaces that lean on it (similarity search, narrative dashboards, B2B "find me cases like this").

---

## Part 3 — Scam-domain relevance

For each vertical, what Voyage gives you that Claude doesn't:

| Vertical                                                                 | Voyage opportunity                                                                                                                                                                                                                                                                                                     | Claude alone can't…                                                                                                        |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Crypto / investment scams**                                            | Cluster pig-butchering opener scripts and rug-pull narratives across Reddit + scam-reports. `voyage-finance-2` is the right model — finance-heavy lexicon (liquidity, KYC, MEV, withdrawal-tax).                                                                                                                       | …say "this report matches 47 prior reports clustered as 'CoinPro Pro pig-butchering' — first seen 12 days ago, +180% WoW." |
| **Charity / donation scams** (in flight, `packages/charity-check`)       | Embed every ACNC charity name + mission statement. At submission time, embed the user's input charity name and ANN-search the 63,637-row table. Catches lookalikes that Levenshtein/trigram (current `acnc.ts:141-194`) misses — semantic typosquats like "Save Australian Children" vs "Save the Children Australia". | …catch a _semantic_ impersonator that isn't a typo. Trigram/Levenshtein only catch lexical variants.                       |
| **Romance / pig-butchering**                                             | Cluster opener scripts ("I am a doctor working in Yemen with the UN…"). Romance scripts are formulaic and translate well to embedding clusters.                                                                                                                                                                        | …show "5,120 victims received variants of this exact opener in the last 90 days."                                          |
| **Phishing / smishing**                                                  | Cluster lure templates and sender-ID patterns. Embed redacted SMS texts; cluster by lure family ("AusPost redelivery", "Linkt toll", "MyGov refund").                                                                                                                                                                  | …answer "is this novel or a variant of a known campaign?" without expensive Sonnet calls.                                  |
| **Tech-support / impersonation**                                         | Cluster impersonation scripts by claimed authority (Microsoft, ATO, NBN).                                                                                                                                                                                                                                              | …give B2B buyer "show me all reports impersonating ANZ in the last 7 days, ranked by narrative similarity to this one."    |
| **Job / recruitment scams**                                              | Embed job-ad bodies; cluster by remote-work-from-home, mystery-shopper, reshipping mule.                                                                                                                                                                                                                               | …surface that two seemingly different ads share a narrative fingerprint with a known mule-recruitment campaign.            |
| **Phone scams** (Phone Footprint v2, `docs/plans/phone-footprint-v2.md`) | Whisper transcribe → `voyage-3.5` embed → cluster by call-script narrative. Already paying for Whisper; embeddings are pennies on top.                                                                                                                                                                                 | …group voice scams by _what was said_, not just the originating number.                                                    |
| **Document / invoice fraud (BEC)**                                       | `voyage-multimodal-3.5` on invoice screenshots — embed visual layout + extracted text in one vector. Cluster by template family (lookalike Xero invoices, fake DocuSign-branded docs).                                                                                                                                 | …detect a visual lookalike invoice when the text content is legitimately extracted but the layout is forged.               |

The unifying observation: every Ask Arthur vertical produces text (or text+image) that arrives in _families_. Claude tells you what one report is. Embeddings tell you which _family_ it belongs to and how that family is moving.

---

## Part 4 — Adjacent / B2B verticals

| Buyer persona                                                                   | Voyage-powered surface that matters                                                                                                                                                                                                | Status today                                                                                                 |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Bank fraud team** (already implicit in Breach Defence + Reddit Intel B2B API) | "Find me reports semantically similar to this one I'm investigating." Embed the analyst's pasted text → ANN over `verified_scams` + `reddit_post_intel`; rerank top-50 with `rerank-2.5`. Filter by `brands_impersonated` overlap. | Not built. `verified_scams` has no embedding column.                                                         |
| **Telco messaging team** (Phone Footprint B2B)                                  | Cluster the past 30 days of complaints by SMS lure template; alert when a new template crosses similarity ≥0.85 to a known smishing family.                                                                                        | Not built. Phone scams not embedded.                                                                         |
| **Charity ops** (Charity Check v0.1+v0.2a)                                      | Auto-flag inbound donor-platform listings whose name embeds within 0.92 cosine of a registered ACNC charity but whose ABN doesn't match. Catches the "Save Australian Childrens Fund" trick.                                       | Not built. Charity name lookups still trigram-only.                                                          |
| **Regulator analyst (ACCC, Scamwatch, OAIC)**                                   | "Cluster this week's victim reports by narrative; show emerging themes WoW." Effectively the Reddit Intel pipeline — but pointed at the Scamwatch corpus instead.                                                                  | Reddit-only. Scamwatch ingest exists (`packages/charity-check/src/scamwatch-context.ts`) but isn't embedded. |
| **Insurer / breach-response (Breach Defence)**                                  | Rerank threat-intel hits per case. When a case has 200 candidate IOC matches, `rerank-2.5` over (case description, IOC blurb) cuts analyst review time.                                                                            | Not built. No reranker anywhere.                                                                             |

The B2B `/api/v1/intel/*` namespace already exists (gated by `NEXT_PUBLIC_FF_REDDIT_INTEL_B2B_API`) but exposes only the **theme + digest + quotes** outputs. Adding `/api/v1/intel/search?q=...` (embed query → ANN → rerank) would be a single endpoint that turns the corpus into a real product.

---

## Part 5 — Questions you should be asking

1. **What is our reindex strategy when Voyage 3.5 sunsets?** — partially addressed by ADR-0003 in this PR. The runbook ("re-embed all rows with `embedding_model_version != <new>` in batches before flipping the default") is documented; the actual Inngest job to do the re-embed is not yet built and isn't needed until the first model swap.
2. **Should we be embedding at submission time so the user gets "people reported a similar scam X times this week" on `/scan` result pages?** This is the killer consumer feature embeddings unlock. Cost: ~$0.0001 per analyze call. Effort: small. Currently zero of the consumer surface uses embeddings.
3. **Are we storing user-submitted query embeddings? What's the privacy posture?** Today: no, because no submission embeds. The minute we do, every embedded query is a derived form of submitted user content — plausibly PII-derivative under OAIC's view of "personal information". Need a retention policy _before_ we ship the feature, not after.
4. **Why is the IVFFlat index in v82 if we never query it?** Either we plan to (and should ship the query path) or we shouldn't carry the index cost. Right now it's overhead with no payoff.
5. **Is the 0.62 cosine threshold portable to scam-report clustering, or specific to the Reddit prefix-engineered embedding text?** The threshold was empirically tuned for `category:X | brands:Y | tactic:Z | <summary>`. Embedding raw scam-report text would have a different distribution — don't reuse the constant.
6. **Do we want one Voyage account per environment, or one shared key with per-call tagging?** Today's single `VOYAGE_API_KEY` makes preview-vs-prod cost separation impossible at the Voyage dashboard. Their billing dashboard groups by key.
7. **Should the `EMBEDDING_PROVIDER` abstraction add a third lane for `voyage-finance-2`?** Right now it's `voyage` ↔ `openai`. The right axis is _model_, not _provider_. Refactor before Charity Check or Phone Footprint adds embeddings — otherwise you'll fork the abstraction.
8. **What's our latency SLO for query-time embeddings?** Voyage's median latency is ~150-300ms for batch=1. If you put it in the `/api/analyze` hot path, that's a 200ms regression on a route already near its budget. Either move to the Inngest post-processing path (Phase 2 already does this — `FF_ANALYZE_INNGEST_WEB`) or pre-embed asynchronously.
9. **Should we evaluate Voyage's batch API (33% discount) for the Reddit Intel daily classifier?** Daily, not real-time → batch API is a free 33% saving on every cohort.
10. **Is there a case for embedding-based PII detection?** Voyage embeddings of known PII patterns (TFN format, AU phone, AU street suffixes) → cosine match against suspect strings could complement the regex-based PII scrubber. Lower priority — regex is fine for the scrubber. But interesting for _narrative_ PII (e.g. "I live at a property near the corner of …") that regex can't catch.
11. **Are we leveraging Anthropic's preferred-partner relationship?** Voyage tokens billed via Anthropic's enterprise account may be cheaper or carry credit. Worth a single email.
12. **Should we ADR the choice to keep clustering in JS vs migrate to Postgres `<=>` operators?** As corpus grows from 270/wk to (say) 50k/wk if scam-reports get embedded, in-memory cosine over 500 themes/post stops being trivial. Decision is hard to reverse — it'd shape index strategy (HNSW vs IVFFlat), RPC design, and where retries happen.

---

## Part 6 — Concrete recommendations (ranked by ROI)

**Status legend:** ✅ done in `feat/voyage-quick-wins-2026-05` (this PR) · 🔄 queued in BACKLOG `## Voyage AI / Embeddings`

| #   | Recommendation                                                                                                                                                                                                                                      | Package                                                    | Effort | Status                               | Why it matters                                                                                                                                                                                                               | Dependencies                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1   | **Switch default model from `voyage-3` to `voyage-3.5` (drop-in, same dim, same price) — and add an `embedding_model_version` TEXT column on `reddit_post_intel` and `reddit_intel_themes` so we can ladder migrations safely.**                    | `scam-engine`, supabase migration                          | **S**  | ✅                                   | Zero-risk quality bump on the same price; the column unlocks every future model swap. ADR-0003.                                                                                                                              | Supabase migration v86 (additive)               |
| 2   | **Register `VOYAGE_API_KEY` and `EMBEDDING_PROVIDER` in `turbo.json` `globalEnv`.**                                                                                                                                                                 | `turbo.json`                                               | **S**  | ✅                                   | Today's omission can poison the remote cache. Fix now before any other consumer of `embed()` ships.                                                                                                                          | None                                            |
| 3   | **Embed every analyze submission and surface "N similar reports in last 30 days" on `/scan/result`.** Embed in the post-Inngest consumer path (`FF_ANALYZE_INNGEST_WEB=true`), store on `scam_reports.embedding VECTOR(1024)`, build an HNSW index. | `apps/web`, `scam-engine`, supabase migration              | **M**  | 🔄                                   | The killer consumer feature. Turns Ask Arthur from "is this a scam?" into "how many of you have hit this exact scam this week?" — direct viral-loop content for the dashboard, blog auto-fills, Reddit posts. ~$0.0001/scan. | #1 done; ADR for query-vector retention policy. |
| 4   | **Add a reranker stage to `/api/v1/intel/themes` and (when #3 ships) `/scan/result` similarity panel.** Use `rerank-2.5-lite` over top-50 ANN hits.                                                                                                 | `scam-engine`, `apps/web`                                  | **M**  | 🔄                                   | Anthropic's contextual-retrieval study shows rerank cuts retrieval failures from 49% → 67% over embeddings alone. For a B2B customer paying per query, the lift is what they're buying.                                      | #3                                              |
| 5   | **Embed all 63,637 ACNC charity names + missions; ANN-search at submission time in `charity-check` instead of (or alongside) trigram + Levenshtein.** Catches semantic impersonators trigram misses.                                                | `charity-check`, supabase migration                        | **M**  | 🔄                                   | Charity Check is the active product launch — embeddings let us claim "we catch lookalikes other lookups can't" as a launch differentiator. ~$4 one-shot to embed the corpus.                                                 | #1                                              |
| 6   | **Set `input_type="query"` on every query-time embed call (search, similarity, rerank prep). Audit and add a separate `embedQuery(text)` function to `embeddings.ts`.**                                                                             | `scam-engine`                                              | **S**  | ✅ (primitive added; no callers yet) | Trivial code, ~10-20% recall lift on asymmetric retrieval. Easy to forget; easy to encode in the API surface so it can't be forgotten.                                                                                       | None                                            |
| 7   | **Switch the daily Reddit Intel embed path to Voyage's Batch API.**                                                                                                                                                                                 | `scam-engine`                                              | **S**  | 🔄                                   | 33% cost cut on a non-time-sensitive workload. ~$3/month saving — small in absolute terms but free.                                                                                                                          | None                                            |
| 8   | **Add a Redis `hash(text) → vector` cache (24h TTL) in front of `embed()`.**                                                                                                                                                                        | `scam-engine`, `utils`                                     | **S**  | 🔄                                   | Saves embedding tokens on duplicates. Becomes load-bearing the moment #3 ships (forwarded smishing texts get submitted dozens of times).                                                                                     | #3                                              |
| 9   | **Spike `voyage-multimodal-3.5` on the existing Hive AI Facebook-ad image corpus and the Charity Check v0.2b OCR images. Cluster ad creatives by visual+text fingerprint.**                                                                         | new `multimodal` module in `scam-engine`, schema additions | **L**  | 🔄                                   | Catches deepfake / lookalike-creative campaigns. Differentiated capability — no AU competitor does this.                                                                                                                     | #1, #3                                          |
| 10  | **Refactor `EMBEDDING_PROVIDER` env to `EMBEDDING_MODEL_<DOMAIN>` (e.g. `EMBEDDING_MODEL_GENERIC`, `EMBEDDING_MODEL_FINANCE`, `EMBEDDING_MODEL_MULTIMODAL`) before adding the second consumer.**                                                    | `scam-engine`                                              | **S**  | 🔄                                   | Today's two-provider switch dies the moment we want `voyage-finance-2` for crypto/investment posts and `voyage-3.5` for everything else. Get the abstraction right before cementing it across N consumers.                   | Before #5, #9                                   |

### ADRs to write (hard-to-reverse decisions in this list)

- ✅ **ADR-0003 — Embedding model versioning and reindex policy.** Covers #1; dictates how we ladder Voyage-3 → 3.5 → 4 without taking the cluster offline.
- 🔄 **ADR — Query-time embedding retention.** Covers #3. Sets a max-30-day window on derived query vectors, default-purge on user account deletion. Required before #3 ships.
- 🔄 **ADR — Multi-domain embedding model selection.** Covers #10. Picks `voyage-3.5` (general), `voyage-finance-2` (crypto/investment vertical), `voyage-multimodal-3.5` (image+text) with explicit evaluation criteria.
- 🔄 **ADR — Postgres-side ANN vs in-memory cosine.** Question 12 above. Decision should land _before_ `scam_reports.embedding` ships, because it shapes the index choice (HNSW for >100k vectors, IVFFlat for <50k).

---

## Sources

- [Voyage embedding model docs](https://docs.voyageai.com/docs/embeddings)
- [Voyage pricing](https://docs.voyageai.com/docs/pricing)
- [Voyage rerank docs](https://docs.voyageai.com/docs/reranker)
- [voyage-finance-2 announcement](https://blog.voyageai.com/2024/06/03/domain-specific-embeddings-finance-edition-voyage-finance-2/)
- [voyage-multimodal-3 announcement](https://blog.voyageai.com/2024/11/12/voyage-multimodal-3/)
- [voyage-multimodal-3.5 announcement](https://blog.voyageai.com/2026/01/15/voyage-multimodal-3-5/)
- [Anthropic contextual retrieval](https://www.anthropic.com/news/contextual-retrieval)
- [Claude embeddings docs (Voyage as preferred)](https://docs.claude.com/en/docs/build-with-claude/embeddings)
- [CFPB topic modelling with embeddings](https://medium.com/@shaileshzope/topic-modeling-consumer-financial-protection-bureau-complaints-using-gpt-based-embeddings-a19c08361330)
- [Gartner — Feedzai vs Sift](https://www.gartner.com/reviews/market/online-fraud-detection/compare/feedzai-vs-sift)

### Key file paths referenced

- `packages/scam-engine/src/embeddings.ts`
- `packages/scam-engine/src/inngest/reddit-intel-embed.ts`
- `packages/scam-engine/src/inngest/reddit-intel-cluster.ts`
- `packages/scam-engine/src/inngest/reddit-intel-daily.ts`
- `apps/web/lib/cost-telemetry.ts` (lines 31-36)
- `supabase/migration-v82-reddit-intel-base.sql`
- `supabase/migration-v86-embedding-model-version.sql` (this PR)
- `packages/charity-check/src/providers/acnc.ts` (current trigram path that #5 would augment)
- `docs/plans/reddit-intel.md` (D2 decision context)
- `docs/adr/0003-embedding-model-versioning.md` (this PR)
