# Arthur's Take — Phase 0 Discovery

> Answers D1–D10 of the "Arthur's Take" brief (v0.1, 2026-09-04) with file:line references
> and live prod measurements. **Read this before designing anything in the feed / Reddit-intel
> area** — three of the brief's assumptions are wrong, and two of them change the architecture.
>
> Verified against `main` @ `d5134157`. Prod queried 2026-09-04 via `apps/web/scripts/_query.ts`
> (read-only Management API runner). Baseline tests at that commit:
> `@askarthur/scam-engine` 713 passed / 18 skipped (63 files);
> `@askarthur/web` 1529 passed / 1 skipped (137 files).

---

## 0. Headline — the brief describes a system that mostly exists

The brief proposes a new LLM pipeline over raw Reddit posts writing to a new `feed_item_takes`
table. **~80% of that is already built, shipped, and running in production** as the Reddit Intel
pipeline (migration v82, 2026-05-02).

`reddit_post_intel` already stores, per Reddit post: `intent_label` (the 15-value ACCC-aligned
taxonomy — a near-duplicate of the brief's §6.2 proposed taxonomy), `confidence` (0–1),
`modus_operandi` (one sentence on how the scam works), `tactic_tags[]`, `brands_impersonated[]`,
`narrative_summary`, `novelty_signals[]`, `country_hints[]`, `victim_emotion`, `theme_id`,
`embedding`, `model_version`, `prompt_version`.

Sampled output (post 41994, `reddit-intel-v2@2026-06-28`):

> **modus_operandi** — "Fake brand collaboration offer requires a model to pay $95 upfront for
> shipping a 'hard contract', with a promise of reimbursement upon completion of the shoot."
> **intent_label** `advance_fee` · **confidence** 0.88 · **tactics** `fake_legitimacy`,
> `reciprocity`, `urgency_window`

That is already "what Arthur sees in this pattern". What it lacks is exactly three things: a
reader-facing **tells** list, **actions**, and an explicit **not-a-scam** signal — plus it repeats
dollar amounts, which the brief rightly forbids in a public take.

**Consequence for North Star filter #3** ("Does something already built do this? Activation beats
construction"): the brief's parallel table + second prompt + lazy generation is construction where
activation would do. See `DECISIONS.md` X1.

---

## 1. D1 — Reddit ingest

| Question   | Answer                                                                                                                                                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Job        | `pipeline/scrapers/reddit_scams.py`, `scrape()` at :789                                                                                                                                                                                                                        |
| Scheduler  | `.github/workflows/scrape-feeds.yml:296-307` ("Scrape Reddit r/Scams"), tier-6h cron `0 */6 * * *` (`scrape-feeds.yml:36`) — **6-hourly, not daily**                                                                                                                           |
| Subreddits | `r/Scams` and `r/phishing`, limit 100 each (`reddit_scams.py:62-65`). `r/scambait` removed 2026-05-16 (:66-71)                                                                                                                                                                 |
| Endpoints  | Cascading: OAuth `https://oauth.reddit.com/r/{sub}/new` → `old.reddit.com/.../new.json` → `www.reddit.com/.../new.json` → Atom RSS (`reddit_scams.py:52-55`, `_fetch_subreddit_posts` :698-762). Working tier cached per run (:509, :765); 7s inter-subreddit rate limit (:57) |
| Gates      | `vars.ENABLE_SCRAPER` at job level (`scrape-feeds.yml:70`); circuit breaker `enforce_backoff_or_skip("reddit", threshold=3)` (`reddit_scams.py:791-792`)                                                                                                                       |
| Dedupe     | Two layers: `reddit_processed_posts` (PK `post_id`, 30-day window) loaded wholesale and checked before any work (`reddit_scams.py:840-843`); plus partial unique index `(source, external_id)` (`migration-v44-scam-feed.sql:60`)                                              |
| Telemetry  | `feed_ingestion_log` via `log_ingestion(...)` (`reddit_scams.py:1016-1027`). No cost telemetry — no paid API on this path                                                                                                                                                      |

### What is stored per post (`reddit_scams.py:894-910` → RPC `upsert_feed_item`, `migration-v44-scam-feed.sql:87-141`)

| `feed_items` column                 | Source                                                                    | Note                                                            |
| ----------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `source`                            | literal `"reddit"`                                                        |                                                                 |
| `external_id`                       | Reddit base36 post id                                                     | dedupe key                                                      |
| `title`                             | `_scrub_usernames(title)`                                                 | **truncated to 300 chars** (:897)                               |
| `description`                       | `_scrub_usernames(selftext)`                                              | **truncated to 500 chars** (:898) — see §11                     |
| `url`                               | first extracted IOC URL                                                   | _not_ the post link                                             |
| `source_url`                        | `https://reddit.com{permalink}`                                           | the attribution link                                            |
| `category`                          | flair → `FLAIR_MAP` (:75-107), else `_classify_by_keywords` (:283-306)    | **NULL on 3,090 / 6,168 rows**                                  |
| `country_code`                      | `_detect_country` — `[XX]` title tag → subreddit → AU keywords (:163-191) | NULL 3,982 · US 1,652 · GB 156 · **AU 86**                      |
| `upvotes`                           | `post.score`                                                              | effectively **frozen at scrape time** — all 6,168 rows are `<5` |
| `r2_image_key` / `reddit_image_url` | R2 upload, else source URL                                                |                                                                 |
| `source_created_at`                 | `created_utc`                                                             |                                                                 |

Never written by the Reddit path: `body_md`, `tags`, `published_at`, `embedding`,
`impersonated_brand`, `channel`. **`subreddit` is not stored on `feed_items` at all** — it survives
only inside `source_url`.

On conflict the RPC overwrites `upvotes` and COALESCE-fills `description`/`category`/images, but
because layer-1 dedupe blocks the re-fetch, a post is upserted once and its score never refreshes.
Edited posts are never re-read.

## 2. D2 — Reddit comments

**Not fetched, not stored, anywhere.** No `/comments/` API call exists; `num_comments` appears zero
times in the repo. The only `comments` references are permalink path-parsing
(`_extract_post_id_from_permalink`, `reddit_scams.py:611-622`). Documented as a deliberate exclusion
in `docs/compliance/reddit-intel-privacy-impact.md:30` ("only the original post body").

**Impact on brief goal G3** (accuracy benchmark vs Reddit thread consensus): not feasible without
adding a new Reddit surface, a PIA amendment and fresh ToS exposure. Deferred — see `DECISIONS.md` X9.

## 3. D3 — Schema

`feed_items` created in `migration-v44-scam-feed.sql:16-46`, extended by v97 (`body_md`, `tags`,
`published_at`, `embedding`), v98 (archive), v210/v213 (source + category enums), v214
(`competitor_extracted_at`). Generated types: `packages/types/src/db.generated.ts:2903-2998`.

- **There is no `metadata` jsonb column.** `tags TEXT[]` is the only extensible bag, and it is empty
  on every Reddit row.
- **Category chips** on feed cards come from `feed_items.category` (single text column) mapped via
  `CATEGORY_CONFIG` in `apps/web/lib/feed.ts:1-20`. Not from `tags`.
- **Category enum**: the 15 ACCC-aligned values (v44:24-29) plus `competitor_intel` (v210:14-22,
  never publishable per ADR-0021).
- **RLS**: `feed_items_public_read` — `FOR SELECT USING (published = TRUE)` (v44:73-75).
  `reddit_post_intel` and the four sibling intel tables are **service-role only, no anon policy**
  (`migration-v82-reddit-intel-base.sql:201-225`). Any new page must read them through the service
  client, as `apps/web/lib/intel/themes.ts` already does.

`reddit_post_intel` columns and the `intent_label` CHECK (15 values, identical to
`feed_items_category_check` minus `competitor_intel`): `migration-v82-reddit-intel-base.sql:34-73`,
plus `embedding_model_version` (v86:25). `UNIQUE(feed_item_id)` is the idempotency key.

## 4. D4 — Feed API and surfaces

| Surface                        | File                                                | Shape / caching                                                                                                                                                                  |
| ------------------------------ | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/scam-feed` list page         | `apps/web/app/(marketing)/scam-feed/page.tsx`       | `force-dynamic` (:12), `gateOrNotFound("scamFeed")` (:32), SSR first 20 + client `FeedList`                                                                                      |
| `GET /api/feed`                | `apps/web/app/api/feed/route.ts`                    | `{items,total,page,limit,hasMore}`; `select("*")` — leaks `embedding`, `body_md`; `s-maxage=60` (:87); flag-off → empty 200 (:10-12); sole consumer `components/FeedList.tsx:90` |
| RSC loaders                    | `apps/web/lib/feed-loaders.ts:21-55`                | first 20 + 3 pinned regulator alerts                                                                                                                                             |
| `/intel/regulator-alerts`      | `apps/web/app/intel/regulator-alerts/page.tsx`      | 50 rows, `revalidate = 1800`                                                                                                                                                     |
| `/api/mobile/regulator-alerts` | mobile only, regulators only, 10 rows               |
| B2B                            | `/api/v1/intel/search`, `/api/v1/intel/themes[/id]` | gated `redditIntelB2bApi`                                                                                                                                                        |

**There is no per-feed-item detail page.** No `/scam-feed/[id]`, `/feed/[id]`, or `/scams/[slug]`.
The deferral is documented at `apps/web/app/intel/regulator-alerts/page.tsx:8-10` (external_id is a
SHA-256 hash for narrative sources, so a slug column would be needed). Feed cards are a single
`<a target="_blank">` to `source_url` (`components/FeedCard.tsx:151-157`) — every click leaves the site.

No RSS for `feed_items`; `apps/web/app/sitemap.ts` emits only the static `/scam-feed` URL plus
`reddit_intel_themes` and clone-watch rows.

**What the live page actually shows** (fetched 2026-09-04): the primary content is Reddit post
excerpts, predominantly US-tagged, with a small collapsible regulator strip above.

## 5. D5 — Scanner internals (the path that must not regress)

- Route `apps/web/app/api/analyze/route.ts:353-362` → `analyzeWithClaude()`
  (`packages/scam-engine/src/claude.ts:467`).
- Model **Haiku 4.5** hardcoded (`claude.ts:609`), `max_tokens` 700/1200, assistant prefill `"{"` (:628).
- Prompt is an inline const `SYSTEM_PROMPT` at `claude.ts:211-307`, cached ephemeral (:613-619), with
  two deliberately-uncached optional blocks (`themesPromptBlock` RAG, marketplace).
- Output is `JSON.parse`d then run through the **hand-written** `validateResult()` (`claude.ts:360`) —
  unknown verdict coerces to `SUSPICIOUS`, confidence < 0.6 downgrades to `UNCERTAIN`. The Zod shapes
  live in `packages/types/src/analysis.ts` (`VerdictSchema` :15 has four values; the prompt offers three).
- **PII scrub before the LLM**: `scrubPII` (`packages/scam-engine/src/sanitize.ts:59`) applied via
  `buildInjectionSandwich(..., { scrubPii: true })` at `claude.ts:504-511`. Importable as
  `@askarthur/scam-engine/sanitize`.
- Shared wrapper `packages/scam-engine/src/anthropic.ts` `callClaudeJson` (:213): model whitelist
  (`MODELS` :47-69), Zod parse, tool-use mode, `cache_control: ephemeral`, `ClaudeTruncatedOutputError`.
  **It does not scrub PII** (:251-252) and **does not auto-log cost** (:204-206) — the caller owns both.
- `scamType` on the Scanner side is a free-text 9-value vocabulary (`claude.ts:227`:
  `phishing|advance_fee|tech_support|romance|investment|impersonation|smishing|other|none`) that is
  **incompatible with the feed taxonomy** (`romance` vs `romance_scam`, `smishing` vs `sms_scam`).
  Pre-existing drift, five uncoordinated copies of the taxonomy exist; out of scope for this feature
  but worth an issue.

## 6. D6 — Feature flags

`packages/utils/src/feature-flags.ts`. Two patterns: `NEXT_PUBLIC_FF_*` read as a literal
(`scamFeed` :205) so build-time inlining works in the client bundle, and `readBoolEnv()` for
server-only flags (trims whitespace, bracket-notation access). Page gating uses `gateOrNotFound()`
(`apps/web/lib/featureGate.ts:52`) which **requires `force-dynamic`** — see the warning at
`featureGate.ts:16-33` and the enforcing test `apps/web/__tests__/featureGateRuntime.test.ts`.

## 7. D7 — Background jobs

Inngest (functions registered in `packages/scam-engine/src/inngest/functions.ts` and app-local under
`apps/web/app/api/inngest/functions/`) plus Vercel crons in `apps/web/vercel.json`. Production-only
cron guard via `isProductionDeployment()`. **Every new function needs a row in
`docs/inngest-brakes.md`** — enforced by `apps/web/__tests__/inngestBrakesMatrixDrift.test.ts`.

The Reddit Intel chain: `reddit-intel-trigger` (Vercel cron `0 8 * * *`, `vercel.json:56-59`) →
`reddit.intel.batch_ready.v1` → `reddit-intel-daily` → `reddit.intel.summarised.v1` →
`reddit-intel-embed` → `reddit.intel.embedded.v1` → `reddit-intel-cluster`.

## 8. D8 — Tests

vitest, run scoped: `pnpm --filter @askarthur/scam-engine test`, `pnpm --filter @askarthur/web test`,
`cd pipeline/scrapers && python -m pytest tests/ -v`. Baselines at the top of this document.
Existing coverage in the area: `reddit-intel-output-budget.test.ts`,
`reddit-intel-cluster.assign.test.ts`, `featureGateRuntime.test.ts`, `inngestBrakesMatrixDrift.test.ts`.

The repo's `evals/` directory is a three-layer structure (vitest / promptfoo / e2e) covering **only
the consumer analyze path** — `evals/runner.ts`, four fixtures, and `evals/e2e/run.mjs`.
There is **no golden set and no model comparison for the Reddit classifier**. Note the warning
recorded at `evals/e2e/run.mjs:19-22`: promptfoo reported green 24/24 for 86 days without ever
having executed.

## 9. D9 — Observability

- **Axiom** via `withAxiomLogging`; INFO is sampled at 10% with the keep/drop decision taken once per
  run, so a low-frequency function is effectively invisible. The established fix is one `warn`-level
  `"<fn-id>.summary"` event per run (live in `reddit-brands-discover.ts`).
- **`cost_telemetry`** — the classifier writes `reddit-intel-classify`, `-classify-retry`,
  `-truncated` ($0 diagnostic), `-error` ($0 diagnostic) via direct inserts
  (`reddit-intel-daily.ts:422-484`, `reddit-intel-error-log.ts:70-99`); packages cannot import
  apps/web's `logCost`.
- **Brake**: `feature_brakes.reddit_intel`, read by `isRedditIntelBraked()`
  (`reddit-intel-error-log.ts:31-48`) at the top of all three intel functions; engaged by
  `cost-daily-check` (`apps/web/app/api/cron/cost-daily-check/route.ts:410-438`) against an explicit
  tag allowlist (:204-214) with cap `REDDIT_INTEL_CAP_USD` (default $10/day).
- **First-party analytics**: `apps/web/lib/analytics-events.ts` — adding an event type needs **no
  migration** (`event_props` is jsonb, metadata only).

## 10. D10 — Privacy handling of ingested Reddit content

| Control                       | State                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Username scrubbing            | `_scrub_usernames` (`reddit_scams.py:264-266`) strips `/u/name` and `u/name` only. The post's `author` field is never read, so it never lands in the DB. A bare handle written without the `u/` prefix is **not** scrubbed.                                                                                                                                                           |
| Phone / email                 | **Extracted, not scrubbed** — `_AU_PHONE_RE`, `_EMAIL_RE` (:199-204) feed `scam_entities` after `_classify_role` excludes victim-owned contacts via an 80-char lookback (:218-247). The values remain in `description`.                                                                                                                                                               |
| `[removed]` / `[deleted]`     | **No handling at all** — zero matches repo-wide. A tombstoned post stores the literal string as its description; a post removed _after_ ingest is never revisited. (Prod today: 0 such rows, but nothing prevents them.)                                                                                                                                                              |
| `feed_items` retention        | Reddit rows are **explicitly excluded** from archival: `archive_feed_items_batch` filters `source IN ('scamwatch_alert','acsc','asic_investor')` (`migration-v98-feed-retention.sql:81-136`, header at :19 — "reddit → keep forever"). Nothing NULLs `description` after N days. **Unbounded retention.**                                                                             |
| `reddit_post_intel` retention | `modus_operandi`, `narrative_summary`, `novelty_signals` NULLed at **180 days**; `reddit_intel_quotes` DELETEd at 365 days (`apps/web/app/api/cron/reddit-intel-retention/route.ts:17-18`).                                                                                                                                                                                           |
| Reddit ToS position           | `docs/compliance/reddit-intel-reddit-tos.md:49-52` — "No republication of full Reddit post bodies to subscribers, the public dashboard, or the B2B API"; quotes capped at ≤140 chars with permalink attribution; no individual-user profiling. The live `/scam-feed` shows the 500-char excerpt, which is an excerpt rather than a full body — but any new surface must not widen it. |

**Retention asymmetry worth raising**: our derived analysis dies at 180 days while the raw Reddit
excerpt is kept forever. That is backwards from a privacy standpoint.

---

## 11. Three findings that change the design

### F1 — 81% of Reddit bodies are truncated at 500 characters

`reddit_scams.py:898` stores `selftext[:500]`. In prod, **4,974 of 6,168** Reddit rows have
`length(description) = 500` exactly. The classifier reads `description` (`reddit-intel-daily.ts:527-530`),
so every analysis of a long scam story is an analysis of its first paragraph.

`feed_items.body_md` already exists (added v97 for narrative sources, capped 50k chars at v101:138)
and is NULL on every Reddit row. Storing the full scrubbed body there costs nothing extra to publish
(the public excerpt stays `description`) and improves intel quality, not just takes.

### F2 — Theme clustering has collapsed; the "new scam" seam is inert

| Measure                                                           | Prod value                                 |
| ----------------------------------------------------------------- | ------------------------------------------ |
| Themes total                                                      | 200                                        |
| Themes with `signal_strength` other than `'weak'`                 | **0**                                      |
| Largest theme (`social-media-platform-scams-targeting-creators…`) | **2,263 of 4,313 posts (52%)**             |
| Themes with exactly 1 member                                      | 138                                        |
| Themes born since 2026-08-01                                      | **0** (160 in May, 40 in July, none since) |
| Rows with non-null `wow_delta_pct`                                | **0 of 200**                               |

Root causes, all in `packages/scam-engine/src/inngest/reddit-intel-cluster.ts`:
`COSINE_THRESHOLD = 0.62` (:57, lowered from 0.78 in May 2026 when the opposite failure — 1:1
theme:post — appeared); `signal_strength` has exactly one writer, the hardcoded literal `"weak"`
(:511); `is_active` is never set false; `wow_delta_pct` is declared (v82:112) and **never written by
any code or SQL** while being returned by the B2B API (`api/v1/intel/themes/route.ts:79`).
Anti-runaway guards (`CENTROID_FREEZE_AT = 50`, `MAX_THEME_MEMBERS_FOR_JOIN = 250`, :85-86) were
added after the mega-theme was noticed, but births are still zero — every new post finds _some_
theme above 0.62.

Every theme ranking in the product orders by cumulative `member_count DESC`
(`apps/web/lib/reddit-intel.ts:98`, `api/v1/intel/themes/route.ts:42`). **`first_seen_at` is
displayed but never filtered on**; there is no "born this week" query anywhere.

**The one working novelty primitive** is the weekly synthesis
(`packages/scam-engine/src/reddit-intel/weekly-synthesis.ts:137,325-372`): a deterministic set-diff of
this week's `brands_impersonated` / `tactic_tags` against a 28-day trailing baseline, producing
`novelBrands` / `novelTactics`, with Sonnet tagging each story `new` / `rising` / `ongoing` and the
counts attached in code rather than invented by the model. It is persisted to
`reddit_intel_weekly_digest` (8 rows in prod) — and it is **email-only**. Its web reader
`getLatestWeeklyIntelDigest()` (`apps/web/lib/reddit-intel.ts:143`) has **zero callers**.

### F3 — The classifier runs daily; the scraper runs 6-hourly

`vercel.json:56-59` schedules `reddit-intel-trigger` at `0 8 * * *` while the scrape tier is
`0 */6 * * *`. Items at the top of the feed are therefore hours old with no analysis attached, and
the drain rate (40/run × 1 run/day) sits barely above the ~37 posts/day arrival rate — so a single
missed day never recovers, and the ~1,855 pre-May rows outside the newest-1000 candidate window
(`reddit-intel-trigger/route.ts:57`) are permanently unreachable.

---

## 12. Prod measurements (2026-09-04)

| Metric                            | Value                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| Reddit `feed_items`               | 6,168 (May 1,172 · Jun 1,104 · Jul 1,160 · Aug 966)                                            |
| Classified in `reddit_post_intel` | 4,313 (all since May 2026)                                                                     |
| Confidence ≥0.8 / 0.5–0.8 / <0.5  | 2,616 / 1,532 / 138                                                                            |
| Prompt versions                   | v2 2,286 · v1 1,960 · v1-on-Haiku 40                                                           |
| `country_hints` contains AU       | **87 of 4,313 (2%)**                                                                           |
| Reddit `country_code`             | NULL 3,982 · US 1,652 · GB 156 · AU 86                                                         |
| `category` NULL on Reddit rows    | 3,090 (50%)                                                                                    |
| `novelty_signals` non-empty       | 2,370 (55%) — read only by `monthly-intel-blog.ts:162`                                         |
| 30-day Reddit-intel spend         | **US$4.85** (classify $4.27 · retry $0.33 · synthesis $0.20 · name-themes $0.05 · embed $0.00) |
| `scam_reports`                    | 77 lifetime, **19 in 30 days**                                                                 |
| `competitor_intel_observations`   | 80 in 30 days                                                                                  |

The AU figure is the one to sit with: the feed is a **~98% non-Australian** corpus on an AU-first
product. That is an argument for making takes globally useful with an AU line (see `DECISIONS.md` X2),
not for suppressing global content.

---

## 13. Corrections to the brief

| Brief claim                                                 | Reality                                                                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| "~5.6k scam reports" in the feed                            | 6,168 Reddit + ~280 from all other sources                                                                                            |
| Feed items have a `tags` field driving the "Phishing" chips | Chips come from `feed_items.category`; `tags` exists but is empty on Reddit rows                                                      |
| Detail page exists to add a take to                         | No per-item page exists; one must be built                                                                                            |
| Reddit comments available for a consensus label (G3)        | Not ingested; not available without a new Reddit surface                                                                              |
| §6.2 proposes a new 14-value closed taxonomy                | A 15-value closed taxonomy already exists and is shared with `feed_items.category` and brand aggregation                              |
| PII scrubbing exists on ingested Reddit text                | Only `u/` usernames; phones and emails remain in `description`                                                                        |
| Lazy per-view generation is needed for coverage             | A daily batch already covers ~37 posts/day at US$0.0045 each; freshness is a cron-schedule problem, not a generation-strategy problem |

## 14. Golden set

47 stratified candidates (3 per label, 4 each for `informational` / `other`, all with
`length(description) ≥ 200` and classified under prompt v2) are listed in `GOLDEN-SET.md` for human
labelling at Gate 2.
