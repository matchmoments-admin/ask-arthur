# Reddit Scam Intelligence — Build Plan

**Status:** **CODE COMPLETE 2026-05-02** — 14 PRs merged, Inngest functions
registered + producing data in prod (Wave 1 verified: 40 intel rows + 6
quotes + 1 daily summary on first successful classifier run). Awaiting:
(a) cluster pipeline producing first themes (depends on Voyage embed
succeeding now that VOYAGE_API_KEY is set),
(b) privacy advisor sign-off on the 180d/365d retention windows before
pre-180d data is reachable.
**Owner:** brendan
**Source brief:** internal design brief dated 30 April 2026 — 13 prioritised
features (F-01..F-13) across three waves, narrative-extraction layer over the
existing daily Reddit scrape.

Shipped commits on `main`:

- `c434058` #55 pre-work scaffolding (v82 migration, helpers, flags)
- `01508a5` #56 Wave 1 — daily Sonnet classifier + cron trigger
- `9502492` #57 Wave 1 hotfix — BATCH_SIZE 200→40, timeout 90s→240s
- `bd00bee` #58 Inngest SDK 3.27→3.54 (CVE-2026-42047)
- `d0f5a56` #59 phone-footprint concurrency 10→5 (Inngest plan limit)
- `3232683` #60 Wave 2 PR1 — Voyage embed + greedy pgvector clustering
- `35f6259` #63 Wave 3 PR1 — `/api/v1/intel/*` B2B API
- `6d55665` #64 Wave 3 PR2 — retention cron + PIA + Reddit-ToS docs
- `362246d` #61 Wave 2 PR2 — RedditIntelPanel dashboard widget
- `23668c2` #62 Wave 2 PR3 — weekly email v2 + tweet draft generator
- `0036bb3` #65 Plan doc status update
- `68bdff6` #66 Drop assistant prefill (Sonnet 4.6 rejects it) + JSON extraction
- `281ae17` #67 Unify diagnostic error sink across daily/embed/cluster
- (this PR) #68 reddit-intel cost brake — auto-pauses pipeline at $10/day

Feature flags (all default OFF, flip in Vercel env):

- `FF_REDDIT_INTEL_INGEST` — gates the cron trigger + daily classifier
- `NEXT_PUBLIC_FF_REDDIT_INTEL_DASHBOARD` — gates the threats-page widget
- `FF_REDDIT_INTEL_EMAIL` — gates the weekly intel digest send
- `NEXT_PUBLIC_FF_REDDIT_INTEL_B2B_API` — gates `/api/v1/intel/*` (returns 503 when off)

Steady-state cost projection: **~A\$10–12/month** Anthropic + Voyage,
well below the A\$50 cost-daily-check alert.

Cost safety nets (defence-in-depth):

1. **Per-call timeouts + maxTokens caps** on every Sonnet call.
2. **Inngest retries hard-capped at 3** per event — no infinite loops.
3. **`feature_brakes.reddit_intel`** auto-engages when a day's
   reddit-intel-\* spend exceeds `REDDIT_INTEL_CAP_USD` (default \$10).
   Sets `paused_until = now() + 24h`. All three Inngest functions check
   this at the top of their handler and short-circuit. Operator override:
   `DELETE FROM feature_brakes WHERE feature='reddit_intel'`.
4. **Telegram alert** at \$2 USD/day total spend (existing
   `cost-daily-check` cron, every 6h).
5. **Diagnostic error log** at `cost_telemetry WHERE
feature='reddit-intel-error'` — every classify/embed/name failure
   writes a row with the error message + stack for SQL-queryable triage
   without needing Inngest dashboard access.

Worst-case bound if everything fails permanently: ~\$3/day until the
brake fires at \$10/day OR the Telegram alert triggers at \$2/day —
whichever comes first. Total uncontrolled burn: **<\$3 USD before any
human intervention**.

This document is the durable working plan. It captures locked decisions,
codebase reality checks, the executable sequence, and the ops constraints
that informed each call. Read this before any future work in the area.

---

## 1. Goals

The daily Reddit scrape (`pipeline/scrapers/reddit_scams.py`) already harvests
IOCs (URLs, wallets, phones, flairs) into `feed_items`. It discards the
narrative content of each post — modus operandi, brand impersonations, victim
phrasing, week-on-week novelty. That narrative is the differentiator commercial
threat-intel platforms charge for; capturing it is the highest-leverage upgrade.

The end state:

- Per-post narrative classification persisted in `reddit_post_intel`.
- Daily and weekly digest summaries in `reddit_intel_daily_summary`.
- Greedy pgvector clustering produces stable theme objects in
  `reddit_intel_themes` with WoW velocity tracking.
- Dashboard widgets surface emerging themes, brand watchlists, narrative leads.
- Weekly email digest (recipient-of-one in v1) replaces the verified-scams-only
  template with narrative-first content.
- B2B `/api/v1/intel/*` namespace exposes themes for downstream customers.

---

## 2. Locked decisions

These are not up for debate without a fresh discussion — every downstream brief
assumes them.

| #   | Decision                                             | Choice                                                              | Why                                                                                                                                                                                             |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Per-post Haiku fan-out vs single batched Sonnet call | **Single batched daily Sonnet 4.6 call**                            | At ~270 posts/week (~38/day, confirmed via `feed_items` query 2026-05-01), per-post Inngest fan-out is wasted infra. Collapses F-01 + F-02 + F-06 into one function. Saves 4 Inngest functions. |
| D2  | Embedding provider                                   | **Voyage 3** with `EMBEDDING_PROVIDER` env abstraction              | Cheaper (~$0.06/M tokens), better retrieval on niche text. OpenAI text-embedding-3-small is the swap-in fallback.                                                                               |
| D3  | Theme clustering algorithm                           | **Greedy pgvector** (cosine ≥ 0.78 → join existing theme; else new) | BERTopic + UMAP + HDBSCAN is heavyweight for ~270 posts/week. Greedy assignment is ~50 lines of TS + SQL and scales to ~50k vectors. Revisit if drift becomes a problem after 6 months.         |
| D4  | pgvector index type                                  | **IVFFlat with `lists=100`**                                        | At <50k vectors HNSW's higher build cost and memory overhead don't pay off. Switch to HNSW only if recall on theme lookups becomes a problem.                                                   |
| D5  | Scam-type taxonomy                                   | **Reuse existing `feed_items.category` enum**                       | Already has 15 ACCC-aligned values. Inventing a parallel taxonomy would create permanent toil keeping them in sync.                                                                             |
| D6  | Email send-time                                      | **Keep current cron schedule** (Mon 14:00 UTC)                      | 0 active subscribers (confirmed 2026-05-01). A/B testing is irrelevant. Pivot to recipient-of-one (brendan) and add a "weekly tweet draft" stretch goal.                                        |
| D7  | Retention windows                                    | **180d body NULL, 365d quote DELETE**, themes never expire          | More conservative than the brief's 90d/180d. Easier to tighten later than defend a deletion you regret. Subject to privacy advisor review before F-13 ships.                                    |
| D8  | Migration numbering start                            | **v82**                                                             | Highest applied migration is `v81_site_audit_partial_fields` (2026-04-29). Breach-defence's claimed v82–v86 reservation in CLAUDE.md is unused; safe to take.                                   |

---

## 3. Codebase reality check

Items the source brief assumed exist but don't, or that have moved. Verified
2026-05-01 against `main`.

| Brief claim                                                           | Actual state                                              | Action taken                                                                           |
| --------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `lib/anthropic.ts` shared Claude wrapper                              | Doesn't exist; 4 ad-hoc importers                         | Pre-work creates `packages/scam-engine/src/anthropic.ts`                               |
| pgvector installed                                                    | Not installed                                             | v82 migration installs it                                                              |
| `EMBEDDING_PROVIDER` env pattern                                      | Doesn't exist                                             | Pre-work introduces it via `embeddings.ts` abstraction                                 |
| `get_dashboard_summary` RPC                                           | Doesn't exist (dashboard reads are direct selects)        | F-07 will use a fresh `get_reddit_intel_summary` RPC or direct selects                 |
| Reddit scraper emits Inngest events                                   | No — Python writes to `feed_items` directly via psycopg   | F-01/02 trigger via a new Vercel cron polling `feed_items` for unprocessed Reddit rows |
| Existing weekly-email cron                                            | `0 14 * * 1` UTC = Tue 00:00 AEST. Uses `verified_scams`. | F-11 keeps the schedule, swaps the data source. No `vercel.json` cron change.          |
| Brief `2026XXXX_*` migration naming                                   | Repo uses `migration-v##-*.sql`                           | Renamed to `migration-v82-*.sql`, `v83`, etc.                                          |
| Active subscribers                                                    | 0 (confirmed)                                             | Email send-to-self with tweet-draft stretch goal                                       |
| Sonnet 4.6 / Voyage / OpenAI embedding pricing in `cost-telemetry.ts` | Only Haiku 4.5 + Twilio + Whisper + Resend present        | Pre-work appends the missing constants                                                 |

---

## 4. Sequenced execution

### Pre-work scaffolding (½ week — single PR)

Branch: `reddit-intel/pre-work-scaffolding`

1. `docs/plans/reddit-intel.md` (this file)
2. Append `redditIntel*` flags to `packages/utils/src/feature-flags.ts`
3. Extend `apps/web/lib/cost-telemetry.ts` PRICING constants (Sonnet 4.6,
   Voyage 3, OpenAI text-embedding-3-small)
4. Append Reddit-intel event schemas to `packages/scam-engine/src/inngest/events.ts`
5. Create `packages/scam-engine/src/anthropic.ts` — shared wrapper with
   `cache_control: ephemeral` helper, model whitelist, Zod-validated JSON parse,
   automatic cost telemetry
6. Create `packages/scam-engine/src/embeddings.ts` — provider abstraction
7. Create `supabase/migration-v82-reddit-intel-base.sql` — installs pgvector and
   the foundational tables (`reddit_post_intel`, `reddit_intel_themes`,
   `reddit_post_intel_themes`, `reddit_intel_quotes`, `reddit_intel_daily_summary`)
8. Apply migration to prod via MCP, run advisors, fix any new ERRORs
9. Open PR, wait for Vercel preview green, squash-merge

### Wave 1 — ingest pipeline (1 PR, ~1 week)

Gate: `redditIntelIngest`. Collapses brief's F-01/F-02/F-04/F-05/F-06 into a
single daily Inngest function.

- New Vercel cron `apps/web/app/api/cron/reddit-intel-trigger/route.ts` runs
  every 6h, polls `feed_items WHERE source='reddit' AND id NOT IN
(SELECT feed_item_id FROM reddit_post_intel)`, batches them into a single
  `reddit.intel.batch_ready.v1` event.
- New Inngest function `packages/scam-engine/src/inngest/reddit-intel-daily.ts`:
  - `step.run("classify-batch")` — single Sonnet 4.6 call with the day's posts,
    returns structured output with per-post classification + 3-paragraph daily
    summary + extracted quotes + IOC link IDs.
  - `step.run("upsert-intel")` — writes `reddit_post_intel`, `reddit_intel_quotes`,
    `reddit_intel_daily_summary` in one transaction.
  - `step.run("link-iocs")` — joins extracted URLs/phones/wallets back to
    existing `scam_entities`/`scam_urls`/`crypto_wallets` rows.
- Backfill script `apps/web/scripts/reddit-intel-backfill.ts` for the prior
  30 days of `feed_items`.

### Wave 2 — surfacing (3 PRs, ~3 weeks)

- **F-07** dashboard widget — `apps/web/app/app/threats/_components/RedditIntelPanel.tsx`,
  new `/api/dashboard/reddit-intel` route. Gate: `redditIntelDashboard`.
- **F-08 + F-09** themes + trends — `migration-v83-reddit-intel-themes.sql`
  (uses pgvector from v82), greedy clustering Inngest function, theme-velocity
  computation, theme cards + drill-down `/app/threats/themes/[slug]`.
- **F-11** weekly email — replace `apps/web/app/api/cron/weekly-email/route.ts`
  data source, evolve `apps/web/emails/WeeklyDigest.tsx` to render narrative
  themes + brand watchlist + sample quote. Stretch: `apps/web/lib/tweet-draft.ts`
  generator that emits a 280-char digest summary for manual posting.

### Wave 3 — operations + B2B (2 PRs, ~2 weeks)

- **F-10** B2B API — `/api/v1/intel/{themes,themes/[id],digest,quotes}`.
  Gate: `redditIntelB2bApi`. Reuses `validateApiKey`. Update `docs/openapi.yaml`.
- **F-13** retention — `apps/web/app/api/cron/reddit-intel-retention/route.ts`
  modelled on `vuln-retention/route.ts`. Two-stage: 180d NULL body, 365d DELETE
  quotes. New `vercel.json` cron `0 4 * * *`.

### Honest timeline

9–10 weeks solo. De-scope candidates if pressed: F-09 trend deltas → F-08-only,
F-10 B2B API → defer until first paying customer asks, F-04 quote extraction →
narrative summaries without verbatim quotes. Cutting all three drops to ~6 weeks.

---

## 5. Cost ceiling and observability

Projected Anthropic + Voyage spend across all phases at current Reddit volume:
**A$5–15/month**. Hard alert in `cost-daily-check` set at A$50/day to catch
loops or prompt regressions.

Each Anthropic and Voyage call writes to `cost_telemetry` with a stable
`feature` tag (`reddit-intel-classify`, `reddit-intel-embed`) so the existing
`/admin/costs` dashboard segments it correctly.

---

## 6. Privacy and retention

The Reddit posts themselves remain on Reddit forever; SafeVerify is not the
system of record. We are storing **derived narrative analysis** and **extracted
PII-scrubbed quotes**.

- Reddit username never stored (existing `_scrub_usernames` in scraper).
- `feed_items.description` / image URLs: keep 90 days (existing `vuln-retention`
  pattern).
- `reddit_post_intel` free-text fields (`scammer_playbook`, `red_flag_phrases`):
  NULL after 180 days; structured fields (`intent_label`, `confidence`) retained.
- `reddit_intel_quotes`: DELETE after 365 days.
- `reddit_intel_themes`: retained indefinitely.
- Embeddings: retained indefinitely (vectors, not personal information).

Compliance docs to ship before F-13 enables retention cron in prod:

- `docs/compliance/privacy-impact-assessment.md` (PIA covering Anthropic US +
  Voyage US cross-border disclosure under APP 8)
- `docs/compliance/reddit-tos-compliance.md` (OAuth-first preference,
  ≤140-char quote limit, permalink attribution, no individual user profiling)

---

## 7. Open follow-ups (not blocking pre-work)

1. Privacy advisor sign-off on derived-narrative storage of public Reddit
   content. Blocks F-13 prod rollout, not pre-work.
2. Reddit OAuth migration — current scraper uses unauthenticated JSON
   endpoints. OAuth-first preference with JSON fallback should be added before
   subscriber count crosses 1,000 or we approach Reddit's Public Content Policy
   reporting threshold.
3. Tweet-draft stretch — useful while subscriber count = 0; needs an X API
   or manual-paste flow. Not in the critical path.
4. Model-version drift — pricing constants use Sonnet 4.6 numbers ($3/$15).
   When Sonnet 4.7 (or whatever's next) lands, add new PRICING constants and
   bump `MODELS.SONNET` in `packages/scam-engine/src/anthropic.ts` rather than
   silently re-pointing the same ID.
