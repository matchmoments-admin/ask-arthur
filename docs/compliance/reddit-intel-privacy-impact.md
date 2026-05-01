# Privacy Impact Assessment — Reddit Scam Intelligence

**Status:** draft, pending privacy advisor sign-off
**Date:** 2026-05-01
**Owner:** brendan
**Related:** [Reddit ToS compliance note](./reddit-intel-reddit-tos.md), [Build plan](../plans/reddit-intel.md)

This PIA covers the data flows, lawful basis, third-party processors, and
retention windows for the Reddit Scam Intelligence pipeline (F-01..F-13 in
the build plan). It aligns to APP 1, APP 3, APP 5, APP 8, and APP 11 of the
Privacy Act 1988 (Cth) and the 2024 amendments tightening cross-border
disclosure obligations.

---

## 1. Data sources

| Source                                | What we collect                                                                                                                                                   | Where it sits                            |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Reddit (r/scams, r/auscams, etc.)     | Public posts: title, body, URL, upvotes, source_created_at. Reddit usernames are scrubbed at ingest by `_scrub_usernames` in `pipeline/scrapers/reddit_scams.py`. | `feed_items` (existing pre-Wave-1 table) |
| Sonnet 4.6 inference output           | Per-post: intent label, modus operandi, brands impersonated, victim emotion, novelty signals, tactic tags, country hints, narrative summary, confidence           | `reddit_post_intel` (v82)                |
| Sonnet 4.6 inference output           | Up to 3 ≤140-char PII-scrubbed verbatim quotes per post                                                                                                           | `reddit_intel_quotes` (v82)              |
| Sonnet 4.6 inference output           | Daily aggregate: lead narrative, emerging threats, brand watchlist, stats                                                                                         | `reddit_intel_daily_summary` (v82)       |
| Voyage 3 (or OpenAI) embedding output | 1024-dim vector per post (used for clustering; not personal information)                                                                                          | `reddit_post_intel.embedding` (v82)      |
| Greedy clustering output              | Theme cluster heads with title, narrative, modus operandi, representative brands                                                                                  | `reddit_intel_themes` (v82)              |

We do **not** collect or store:

- Reddit usernames, account ages, karma, or any per-user identifier.
- Reddit post comments (only the original post body).
- Profile images, avatars, or other media linked from posts.

---

## 2. Lawful basis

We process this data under the **research / threat intelligence** ground
in APP 3.4(b) (collection of personal information necessary for one or
more of the entity's functions), specifically for the consumer-protection
function of warning Australians about emerging scam patterns.

The processing is also defensible under the **journalism / public
interest** carve-out where applicable, since Ask Arthur publishes scam
intelligence summaries to a consumer audience.

We do not engage in any individual-user profiling. The
`_scrub_usernames` step at the scraper layer is the technical control
that ensures we cannot link any analysed post back to an individual
Reddit user.

---

## 3. Third-party processors and cross-border disclosure (APP 8)

| Processor                     | Country        | Data sent                                          | Purpose                                               |
| ----------------------------- | -------------- | -------------------------------------------------- | ----------------------------------------------------- |
| Anthropic                     | US (us-east)   | Post title + body (PII-scrubbed at ingest)         | Sonnet 4.6 classification + naming                    |
| Voyage AI                     | US             | Post narrative + structured prefix                 | 1024-dim embedding generation                         |
| OpenAI (fallback only)        | US             | Post narrative + structured prefix                 | Embedding generation when `EMBEDDING_PROVIDER=openai` |
| Supabase (existing processor) | AU (Sydney)    | All persisted intel data                           | Database hosting                                      |
| Vercel (existing processor)   | Global edge    | Function execution                                 | Hosting + cron                                        |
| Inngest (existing processor)  | US (us-east-1) | Event payloads (feed_item IDs only — no body text) | Function orchestration                                |
| Resend (existing processor)   | EU/US          | Weekly digest email content + recipient address    | Email delivery                                        |

**Cross-border note (APP 8.1):** Anthropic, Voyage, OpenAI, Inngest, and
Resend are US-based. Disclosure to a US processor without their being
APP-equivalent triggers APP 8.1's accountability rule — Ask Arthur
remains responsible for any APP breach by the overseas recipient. We
mitigate via:

1. PII-scrubbed inputs (no user identifiers ever leave AU borders).
2. Standard contractual terms with each processor (or DPAs where
   available — Anthropic and Resend both publish them; Voyage's terms
   are reviewed at onboarding).
3. Annual review of each processor's stated security posture.

We monitor for Anthropic / Voyage to offer Sydney-region inference; when
that becomes available we will switch the inference path to AU residency
and update this PIA.

---

## 4. Retention

Operationalised by the `/api/cron/reddit-intel-retention` cron (daily
04:30 UTC). See the route source for the exact two-stage delete logic.

| Data                                                                                                                                         | Retention  | Mechanism                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------ |
| `feed_items.description` (Reddit post body)                                                                                                  | 90 days    | Existing scam-reports retention cron (separate from this PR) |
| `reddit_post_intel.modus_operandi`, `novelty_signals`, `narrative_summary` (free-text fields)                                                | 180 days   | NULL via stage-1 of retention cron                           |
| `reddit_post_intel` structured fields (intent_label, confidence, brands_impersonated, victim_emotion, tactic_tags, country_hints, embedding) | indefinite | Aggregate analysis, not personal information                 |
| `reddit_intel_quotes` (verbatim ≤140-char excerpts)                                                                                          | 365 days   | DELETE via stage-2 of retention cron                         |
| `reddit_intel_themes` (cluster heads)                                                                                                        | indefinite | Abstracted, no individual content                            |
| `reddit_intel_daily_summary` (aggregate narratives)                                                                                          | indefinite | Aggregate, no individual content                             |

These windows are intentionally **more conservative** than the brief's
original 90d / 180d proposal. Per locked decision D7 in the plan, easier
to tighten later than defend a deletion we regret. Subject to privacy
advisor review before the retention cron runs against production data
older than 180 days.

---

## 5. Subject access and deletion (APP 12, APP 13)

Because we do not store any per-individual identifier, we cannot fulfil
subject-access requests at the individual level — we have no way to
locate "all data about user X". This is an intentional design choice
that reduces our exposure rather than expands it.

If a Reddit user requests removal of analysis derived from their
specific post, we honour the request via a manual SQL DELETE keyed on
the source URL or Reddit post ID (which we DO retain in
`feed_items.external_id`). Process documented in the runbook (TBD).

---

## 6. Security (APP 11)

- All persisted intel data sits in Supabase with RLS enabled. Service-
  role-only writes; anon-key has no access (verified via the v82
  migration's policy block).
- API endpoints under `/api/v1/intel/*` require valid API keys
  (`validateApiKey`) and are rate-limited per existing v1 conventions.
- Cost-telemetry alerts fire if Anthropic or Voyage spend exceeds A\$50
  in a single day — early warning of either a runaway loop or an
  exfiltration attempt via inflated batch sizes.

---

## 7. Open follow-ups

1. Privacy advisor sign-off on the 180d / 365d retention windows.
2. Reddit OAuth migration — current scraper uses unauthenticated JSON
   endpoints. OAuth-first preference with JSON fallback should be added
   before subscriber count crosses ~1,000.
3. Documented subject-deletion runbook (currently a TBD reference).
4. Annual review trigger — set a CronCreate routine for 2027-05-01 to
   re-audit this PIA against any APP changes.
