# Privacy Impact Assessment - Reddit Intel

**Status:** Draft, pending privacy advisor sign-off  
**Owner:** Ask Arthur operator  
**Related:** [Reddit ToS compliance](./reddit-tos-compliance.md), [Reddit Intel plan](../plans/reddit-intel.md), [parent issue #212](https://github.com/matchmoments-admin/ask-arthur/issues/212)

## 1. Scope

This Privacy Impact Assessment covers the Reddit Intel narrative pipeline end to end:

- Reddit public scam posts are scraped by [`pipeline/scrapers/reddit_scams.py`](../../pipeline/scrapers/reddit_scams.py).
- Scrubbed source rows land in `feed_items`.
- The daily classifier in [`packages/scam-engine/src/inngest/reddit-intel-daily.ts`](../../packages/scam-engine/src/inngest/reddit-intel-daily.ts) sends post title/body content to Anthropic Sonnet 4.6 and writes `reddit_post_intel`, `reddit_intel_quotes`, and `reddit_intel_daily_summary`.
- The embedder in [`packages/scam-engine/src/inngest/reddit-intel-embed.ts`](../../packages/scam-engine/src/inngest/reddit-intel-embed.ts) sends derived narrative content to Voyage and writes vectors to `reddit_post_intel.embedding`.
- The clusterer in [`packages/scam-engine/src/inngest/reddit-intel-cluster.ts`](../../packages/scam-engine/src/inngest/reddit-intel-cluster.ts) writes `reddit_intel_themes` and `reddit_post_intel_themes`.
- Consumer and B2B reads are gated by Reddit Intel feature flags and API-key checks through `/intel/themes/*` and `/api/v1/intel/*`.

The assessment focuses on Australian Privacy Principles (APPs), especially APP 1, APP 3, APP 5, APP 8, APP 11, APP 12, and APP 13. It treats public Reddit text as personal-information-adjacent because a post can include details about a real person even after usernames are removed.

Out of scope for this PIA: non-Reddit threat feeds, direct user-submitted scam reports, Charity Check, Phone Footprint, and general platform security controls except where they directly protect Reddit Intel data.

## 2. Data Flow

1. **Collection:** [`reddit_scams.py`](../../pipeline/scrapers/reddit_scams.py) fetches new posts from Reddit OAuth endpoints when credentials exist, then falls back to `old.reddit.com`, `www.reddit.com`, and RSS. It combines title and body for IOC extraction.
2. **Scrubbing at ingest:** `_scrub_usernames()` in [`reddit_scams.py`](../../pipeline/scrapers/reddit_scams.py) replaces Reddit username references with `[REDACTED]` before storage. The scraper stores a scrubbed title, up to 500 characters of scrubbed body text, post ID, source URL, timestamps, and extracted IOCs in `feed_items`.
3. **Classifier:** [`reddit-intel-trigger`](../system-map/background-workers.md) emits `reddit.intel.batch_ready.v1`; [`reddit-intel-daily.ts`](../../packages/scam-engine/src/inngest/reddit-intel-daily.ts) sends the batch to Anthropic Sonnet 4.6 and stores structured outputs in `reddit_post_intel`. The prompt instructs the model not to include names, locations, employers, or other identifiers in quotes.
4. **Quote guardrail:** The classifier schema truncates quotes to 140 characters before insert; [`supabase/migration-v82-reddit-intel-base.sql`](../../supabase/migration-v82-reddit-intel-base.sql) also enforces `char_length(quote_text) <= 140` on `reddit_intel_quotes`.
5. **Embedding:** `reddit-intel-embed` sends derived narrative text to Voyage and stores 1024-dimensional embeddings for similarity search and clustering.
6. **Clustering:** `reddit-intel-cluster` writes aggregate themes to `reddit_intel_themes` and memberships to `reddit_post_intel_themes`.
7. **Access:** Public theme pages read through [`apps/web/app/intel/themes/[slug]/page.tsx`](../../apps/web/app/intel/themes/%5Bslug%5D/page.tsx). B2B endpoints under [`apps/web/app/api/v1/intel/`](../../apps/web/app/api/v1/intel) require API keys and feature flags.
8. **Retention:** [`apps/web/app/api/cron/reddit-intel-retention/route.ts`](../../apps/web/app/api/cron/reddit-intel-retention/route.ts) NULLs free-text intel fields after 180 days and deletes quote rows after 365 days. [`cleanup_old_reddit_posts(30)`](../../supabase/migration-v37-reddit-improvements.sql) prunes the scraper dedup tracker, not the intel tables.

## 3. Retention Table

| Store / field                                                                                                           | Personal-information-adjacent content                        | Retention class                                                                           | Enforcing control                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `feed_items.external_id` for Reddit rows                                                                                | Reddit post ID; can identify the original public post        | Source provenance, retained with the feed row unless takedown/manual deletion is required | Manual deletion keyed by `feed_items.external_id`; scraper dedup tracker separately pruned by `cleanup_old_reddit_posts(30)` |
| `feed_items.title`                                                                                                      | Scrubbed public post title, truncated to 300 chars           | Source provenance, retained with the feed row                                             | Username scrub in `_scrub_usernames()` before insert; manual deletion on takedown                                            |
| `feed_items.description`                                                                                                | Scrubbed public post body, truncated to 500 chars            | Source provenance, retained with the feed row                                             | Username scrub in `_scrub_usernames()` before insert; manual deletion on takedown                                            |
| `feed_items.source_url`                                                                                                 | Reddit permalink to the source post                          | Attribution/provenance, retained with the feed row                                        | Used for permalink attribution in theme pages and B2B API; manual deletion on takedown                                       |
| `feed_items.url`                                                                                                        | First non-Reddit IOC URL extracted from the post, if present | Threat intel IOC, retained with the feed row                                              | Existing feed/IOC retention controls; not modified by Reddit Intel F-13                                                      |
| `feed_items.reddit_image_url`, `feed_items.r2_image_key`                                                                | Evidence image reference if captured                         | Evidence/provenance, retained with the feed row                                           | Existing feed/evidence retention controls; not modified by Reddit Intel F-13                                                 |
| `reddit_post_intel.modus_operandi`                                                                                      | Free-text paraphrase of the scam method                      | NULL after 180 days                                                                       | `reddit-intel-retention` stage 1                                                                                             |
| `reddit_post_intel.novelty_signals`                                                                                     | Free-text array of observed phrases or new indicators        | Reset to empty array after 180 days                                                       | `reddit-intel-retention` stage 1                                                                                             |
| `reddit_post_intel.narrative_summary`                                                                                   | Free-text paraphrase of what happened                        | NULL after 180 days                                                                       | `reddit-intel-retention` stage 1                                                                                             |
| `reddit_post_intel.intent_label`, `confidence`, `brands_impersonated`, `victim_emotion`, `tactic_tags`, `country_hints` | Structured classification fields, not user identifiers       | Retained indefinitely for aggregate analysis                                              | Service-role-only RLS in `migration-v82`; no expiry cron                                                                     |
| `reddit_post_intel.embedding` and `embedding_model_version`                                                             | Vector embedding of derived narrative text                   | Retained indefinitely for similarity and clustering                                       | Service-role-only RLS; no expiry cron                                                                                        |
| `reddit_intel_quotes.quote_text` and linked quote metadata                                                              | Verbatim but PII-scrubbed excerpt, maximum 140 chars         | DELETE after 365 days                                                                     | `reddit-intel-retention` stage 2                                                                                             |
| `reddit_intel_themes.title`, `narrative`, `modus_operandi`, `representative_brands`, centroid fields                    | Aggregate cluster head, not individual post text             | Retained indefinitely                                                                     | Service-role-only RLS; no expiry cron                                                                                        |
| `reddit_post_intel_themes`                                                                                              | Membership join between intel rows and themes                | Retained with linked intel/theme rows                                                     | FK cascade in `migration-v82`                                                                                                |
| `reddit_intel_daily_summary.lead_narrative`, `emerging_threats`, `brand_watchlist`, `stats`                             | Aggregate daily narrative and counts                         | Retained indefinitely                                                                     | Service-role-only RLS; no expiry cron                                                                                        |
| `reddit_processed_posts.post_id`, `subreddit`, `processed_at`                                                           | Scraper dedup tracker, not exposed to users                  | DELETE after 30 days                                                                      | `cleanup_old_reddit_posts(30)` RPC, called by scraper cleanup and `reddit-processed-posts-retention`                         |

Privacy advisor sign-off is required before treating the 180-day and 365-day windows as approved for production-wide consumer rollout.

## 4. Cross-Border Disclosure (APP 8)

Ask Arthur remains accountable under APP 8 for overseas recipients that process Reddit Intel data.

| Processor | Jurisdiction                           | Data disclosed                                               | Purpose                                                  | Safeguards                                                                                                                                                                                                                   |
| --------- | -------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anthropic | United States                          | Scrubbed post title/body batch and structured prompt context | Sonnet 4.6 classification and daily narrative generation | Enterprise security posture and contractual terms through Anthropic's official [enterprise / trust center](https://www.anthropic.com/product/enterprise); no Reddit usernames are sent; quotes are constrained and scrubbed. |
| Voyage AI | United States                          | Derived narrative text and structured prefix for embedding   | 1024-dimensional embeddings for search and clustering    | Voyage AI [privacy policy](https://www.voyageai.com/privacy) and [terms](https://www.voyageai.com/tos); only derived narrative text is embedded, not account identifiers.                                                    |
| Inngest   | United States                          | Event payloads containing IDs and orchestration metadata     | Retry/orchestration for Reddit Intel functions           | Event payloads avoid raw Reddit post bodies; service-role database reads happen in controlled functions.                                                                                                                     |
| Supabase  | Australia, Sydney                      | Persisted Reddit Intel tables                                | Database hosting                                         | Region-local Postgres; service-role-only RLS on Reddit Intel tables.                                                                                                                                                         |
| Vercel    | Sydney edge / global platform services | Function execution metadata and responses                    | Hosting, crons, API routes                               | Feature flags, route auth, and API-key gates restrict exposed surfaces.                                                                                                                                                      |

The current control strategy is data minimisation plus contractual/vendor review:

- Strip Reddit usernames before storage or model processing.
- Send only the fields needed for classification and embeddings.
- Retain direct excerpts for a bounded period.
- Require API keys or feature flags for consumer/B2B surfaces that expose derived intel.
- Revisit this PIA if Anthropic or Voyage offer an Australian inference region suitable for this workload.

## 5. Decision Log

| Date       | Decision                                                                                                          | Owner / signer      | Evidence                                                        |
| ---------- | ----------------------------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------- |
| 2026-05-01 | Draft PIA created for Reddit Intel Wave 1-3.                                                                      | Ask Arthur operator | Prior note at `docs/compliance/reddit-intel-privacy-impact.md`. |
| 2026-05-20 | Canonical six-section PIA created under `docs/compliance/privacy-impact-assessment.md`; pending advisor sign-off. | Pending             | Issue #213 close-out.                                           |
| TBD        | Privacy advisor sign-off on 180-day free-text NULL and 365-day quote DELETE windows.                              | Pending advisor     | Add dated approval before F-13 production rollout.              |

## 6. Out-of-Scope Acknowledgement

- **Reddit OAuth migration:** The scraper already prefers OAuth when credentials exist, but unauthenticated JSON/RSS fallback remains. A separate PRD should make OAuth the enforced production path before subscriber count approaches 1,000 or Reddit policy materially tightens.
- **Source-feed retention redesign:** This PIA documents `feed_items` provenance retention as currently implemented. It does not add a new feed row deletion policy.
- **Subject access by Reddit username:** Ask Arthur intentionally does not store Reddit usernames. User-level subject access cannot be performed by username because the identifier is scrubbed at ingest.
- **Manual takedown runbook:** The technical path is deletion by `feed_items.external_id` or `source_url`; a fuller operator runbook remains future work.
- **Privacy advisor selection:** The operator selects the advisor outside this repository. This document only reserves the decision-log slot and evidence requirements.
