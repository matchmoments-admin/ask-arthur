# Reddit ToS Compliance - Reddit Intel

**Status:** Draft, pending policy review  
**Owner:** Ask Arthur operator  
**Related:** [Privacy Impact Assessment](./privacy-impact-assessment.md), [Reddit Developer Terms](https://redditinc.com/policies/developer-terms), [Reddit API documentation](https://www.reddit.com/dev/api/)

## 1. Scope

This document covers Ask Arthur's use of Reddit public post content in the Reddit Intel pipeline. It records the operational commitments that keep the product aligned with Reddit content-use expectations while still allowing scam-pattern monitoring:

- Prefer official/OAuth access where available, with unauthenticated JSON/RSS fallback documented and bounded by migration triggers.
- Store only short, PII-scrubbed quotes.
- Attribute source posts with permalinks instead of re-hosting full Reddit content.
- Avoid individual user profiling.

It covers the scraper, classifier prompt, database constraints, public theme pages, and B2B Intel API routes. It does not cover unrelated Reddit marketing drafts or one-off research notes.

## 2. Data Flow

1. [`pipeline/scrapers/reddit_scams.py`](../../pipeline/scrapers/reddit_scams.py) fetches Reddit posts from OAuth when credentials exist, then falls back to `old.reddit.com`, `www.reddit.com`, and RSS.
2. `_scrub_usernames()` removes `/u/...` and `u/...` style username references before the title/body are written to `feed_items`.
3. [`reddit-intel-daily.ts`](../../packages/scam-engine/src/inngest/reddit-intel-daily.ts) classifies scrubbed posts and asks Sonnet to return structured fields plus up to three quotes per post.
4. The quote schema truncates any model output longer than 140 characters before insert; [`migration-v82`](../../supabase/migration-v82-reddit-intel-base.sql) adds a database CHECK constraint for the same limit.
5. [`apps/web/app/intel/themes/[slug]/page.tsx`](../../apps/web/app/intel/themes/%5Bslug%5D/page.tsx) and [`apps/web/app/api/v1/intel/themes/[id]/route.ts`](../../apps/web/app/api/v1/intel/themes/%5Bid%5D/route.ts) expose derived theme narratives and source URLs, not full Reddit post bodies.

## 3. Retention Table

| Artefact                                                  | ToS / content-use relevance                                          | Retention / control                                                                                 |
| --------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Reddit source URL in `feed_items.source_url`              | Required for attribution and takedown traceability                   | Retained with source row; deleted manually on takedown.                                             |
| Scrubbed title/body in `feed_items.title` / `description` | Source material used for classification; body truncated to 500 chars | Retained with source row; usernames scrubbed before storage; no full-body export.                   |
| `reddit_intel_quotes.quote_text`                          | Verbatim Reddit excerpt                                              | Maximum 140 chars enforced in prompt/schema/DB; deleted after 365 days by `reddit-intel-retention`. |
| `reddit_post_intel` free-text analysis                    | Derived classification/paraphrase                                    | Free-text fields NULLed after 180 days by `reddit-intel-retention`.                                 |
| `reddit_intel_themes`                                     | Aggregated derived narratives                                        | Retained indefinitely because no individual post body or user identifier is present.                |
| `reddit_processed_posts`                                  | Dedup tracker containing post IDs                                    | Deleted after 30 days by `cleanup_old_reddit_posts(30)`.                                            |

## 4. Cross-Border Disclosure (APP 8)

The ToS controls overlap with privacy controls because public Reddit posts can still include personal-information-adjacent details. Cross-border disclosure is documented in the [Privacy Impact Assessment](./privacy-impact-assessment.md). For this ToS document, the relevant commitments are:

- Anthropic receives scrubbed post content only for classification.
- Voyage receives derived narrative text for embeddings.
- Event payloads avoid raw post bodies where possible.
- Public/B2B outputs provide derived analysis plus attribution links, not bulk Reddit content export.

## 5. Decision Log

| Date       | Commitment                                                                                                                                                                                                                | Enforcement point                                                                                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-20 | OAuth-first preference with JSON/RSS fallback acknowledged; migration triggers are subscriber count approaching 1,000, material Reddit policy/API tightening, or Reddit 4xx response volume above 1% over a rolling week. | Endpoint priority in [`reddit_scams.py`](../../pipeline/scrapers/reddit_scams.py).                                                                                                                                                      |
| 2026-05-20 | Verbatim quotes are limited to 140 characters and PII-scrubbed.                                                                                                                                                           | Classifier prompt and schema in [`reddit-intel-daily.ts`](../../packages/scam-engine/src/inngest/reddit-intel-daily.ts); CHECK constraint in [`migration-v82`](../../supabase/migration-v82-reddit-intel-base.sql).                     |
| 2026-05-20 | Every theme detail surface links back to source posts.                                                                                                                                                                    | Public page [`apps/web/app/intel/themes/[slug]/page.tsx`](../../apps/web/app/intel/themes/%5Bslug%5D/page.tsx); B2B route [`apps/web/app/api/v1/intel/themes/[id]/route.ts`](../../apps/web/app/api/v1/intel/themes/%5Bid%5D/route.ts). |
| 2026-05-20 | No individual Reddit user profiling.                                                                                                                                                                                      | Username scrubber in [`reddit_scams.py`](../../pipeline/scrapers/reddit_scams.py); no username columns in [`migration-v82`](../../supabase/migration-v82-reddit-intel-base.sql); public/B2B routes expose post/theme IDs, not user IDs. |

## 6. Out-of-Scope Acknowledgement

- **Commercial Reddit data agreement:** This document does not claim that Ask Arthur has a Reddit commercial data license. It records the current low-volume, public-post, minimised-content posture and the triggers for escalating to formal access.
- **OAuth-only production enforcement:** The scraper prefers OAuth when configured but still supports unauthenticated JSON/RSS fallback. Making OAuth mandatory is future work triggered by subscriber count approaching 1,000, a material Reddit policy/API tightening, or Reddit 4xx response volume above 1% over a rolling week.
- **Bulk Reddit dataset resale:** Ask Arthur does not provide bulk raw Reddit post export. This document does not approve any future raw dataset product.
- **Per-user analysis:** No repeat-poster tracking, user scoring, karma analysis, or profile enrichment is in scope.
- **Copyright legal opinion:** The quote limit and attribution posture are operational controls, not a formal external legal opinion.
