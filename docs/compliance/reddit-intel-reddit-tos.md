# Reddit ToS Compliance — Scam Intelligence Pipeline

**Status:** active
**Date:** 2026-05-01
**Related:** [PIA](./reddit-intel-privacy-impact.md), [Build plan](../plans/reddit-intel.md)

Reddit's 2024 robots.txt update, 2025 API pre-approval rollout, and the
_Reddit v. Anthropic_ (June 2025) and _Reddit v. SerpApi_ (late 2025)
cases collectively raise the bar for derivative use of Reddit content.
This document captures Ask Arthur's stance and the technical controls
that back it up.

---

## 1. Access tier

We currently scrape via **unauthenticated JSON / RSS endpoints** through
`pipeline/scrapers/reddit_scams.py`. This is below Reddit's stated free
OAuth limit of ~100 queries per minute, well below any commercial tier.

**Roadmap:** migrate to **OAuth-first via PRAW** with the unauthenticated
path retained as a defensive fallback. Triggers for prioritising the
migration:

- Subscriber count crosses 1,000.
- Reddit's robots.txt or Public Content Policy materially tightens
  (monitored ad-hoc).
- Any 4xx response volume from Reddit endpoints exceeds 1% over a
  rolling week.

---

## 2. What we DO with Reddit content

- **Classify** — Sonnet 4.6 produces structured intelligence (intent
  label, modus operandi, brand impersonations, narrative summary).
  This is our own creative output.
- **Aggregate** — daily summaries combine signals across many posts
  into editorial narratives and statistical digests.
- **Cluster** — Voyage embeddings + greedy assignment group similar
  posts into themes. The cluster heads have new titles + narratives
  written by Sonnet from a sample of members.
- **Quote (sparingly)** — up to 3 ≤140-character verbatim excerpts per
  post, scrubbed of PII, for editorial colour. Quoting falls within
  fair-dealing for criticism / review and journalism / news (Copyright
  Act 1968, ss 41 / 42).

---

## 3. What we DON'T do

- **No republication of full Reddit post bodies** to subscribers, the
  public dashboard, or the B2B API. The closest we come is:
  - The dashboard widget shows our **paraphrased narrative summary**
    plus optional ≤140-char quotes.
  - The weekly email shows narratives + a single scam-of-the-week
    quote.
  - The B2B `/intel/themes/[id]` endpoint returns our derived analysis
    plus the source `feed_items.url` for deep-link attribution — never
    the full post body.
- **No individual-user profiling.** Reddit usernames are scrubbed at
  ingest. We do not track repeat posters, build user profiles, or score
  individuals.
- **No bulk export of raw post bodies** outside our service boundary.

---

## 4. Attribution

Every theme detail page (and the B2B `/intel/themes/[id]` response)
links back to the original Reddit post via `feed_items.source_url`. This
satisfies Reddit's expected redistribution norm of "link, don't
re-host".

---

## 5. Quote sourcing

The ≤140-char limit on `reddit_intel_quotes.quote_text` is enforced at
the database layer (CHECK constraint in v82 migration). The Sonnet
classifier prompt instructs the model to:

- Pick quotes characteristic of the scam tactic (pressure phrases,
  gift-card-style demands).
- Strip any victim name, location, employer, or other identifier.
- Mark `speakerRole` so consumers know whether the quote is the victim
  or the alleged scammer.

These rules sit in `packages/scam-engine/src/inngest/reddit-intel-daily.ts`
SYSTEM_PROMPT. Bumping the prompt version (e.g. for a quote-policy
change) triggers re-classification of new posts under the new rules
without affecting historical rows.

---

## 6. Takedown / removal posture

If Reddit (or a Reddit user via Reddit) sends a takedown notice for
content derived from a specific post:

1. Identify the row(s) by `feed_items.external_id` (Reddit post ID).
2. DELETE the corresponding `reddit_post_intel`, `reddit_intel_quotes`,
   and the source `feed_items` row. Cascade FKs handle dependent rows.
3. Flag the `feed_items.external_id` in a future `reddit_intel_blocklist`
   table to prevent re-ingestion if the scraper sees the same post URL
   again. (Table TBD; for now, manual SQL.)
4. Acknowledge within 7 business days.

We have not received any such notice as of the date on this document.

---

## 7. Internal lawful-basis statement

For internal counsel / legal review:

> Ask Arthur processes public Reddit posts under a research /
> threat-intelligence purpose (Privacy Act 1988 APP 3.4(b)). Posts are
> classified and aggregated to identify emerging scam patterns
> targeting Australians. No individual Reddit user is profiled,
> scored, or contacted; usernames are scrubbed at ingest. Quotes are
> limited to ≤140-char fair-dealing excerpts with permalink
> attribution to the source. Derived analytical outputs are Ask
> Arthur's own creative work and are licensed to subscribers under
> Ask Arthur's standard terms.

---

## 8. Review cadence

- **Quarterly** — re-read this document against any new Reddit policy
  updates and any further enforcement cases.
- **On API tier change** — re-evaluate when Reddit changes their
  commercial tier pricing or eligibility criteria.
- **On Australian copyright reform** — re-evaluate quote thresholds if
  the s 41 / s 42 fair-dealing carve-outs change.
