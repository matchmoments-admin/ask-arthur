# Ask Arthur — API Costs, Caching & Scale Review

_Status: **Active plan** (2026-05-10). Source: full-codebase audit on branch `claude/review-api-costs-caching-RPzI3`. Drafted as funder due-diligence reference + actionable punch-list for Claude Code agents working on remediation._

> **For Claude Code agents:** Each item under §6 includes file paths, line ranges, and the specific change required. Use those as scope when picking up an item. Do **not** broaden scope without updating this plan first.

---

## 0. TL;DR

Spend is **dominated by Claude Haiku** (consumer analysis) and **Voyage embeddings + Vonage CAMARA** (Phone Footprint). Defense-in-depth caching deflects an estimated 60–75% of would-be Claude calls on common scams and ~95% of regulator-feed fetches via conditional GETs. Cost telemetry covers ~85% of paid call sites with per-feature daily brakes; the major gap is the brake's silent failure on non-numeric env values. Largest scale-out risks are (1) the consumer Charity Check launch blocker (HNSW on a write-hot table), (2) HIBP and several rerank call sites are uncapped, and (3) DR (R2 backup + drill) is documented but not yet executed.

---

## 1. Paid API surface

| Provider | Feature | Unit cost | Telemetry | Cache | Call site |
|---|---|---|---|---|---|
| **Anthropic Haiku 4.5** | `/api/analyze`, extension, bots | $1/M in, $5/M out (~$0.005/call) | Conditional on `FF_ANALYZE_INNGEST_WEB` | 15m–48h Redis by verdict | `packages/scam-engine/src/anthropic.ts`, `claude.ts` |
| **Anthropic Sonnet 4.6** | Reddit-intel classifier | ~$0.20/batch | Logged (Inngest layer) | Inngest idempotency | `packages/scam-engine/src/inngest/reddit-intel-daily.ts` |
| **Voyage 3.5 / Finance / Lite** | Embeddings (Reddit, scams, feeds, charities) | $0.02–$0.12/M tokens | Logged on embed; **rerank requires manual logCost** | 7d Redis + permanent DB on sibling tables | `packages/scam-engine/src/embeddings.ts`, `rerank.ts:100–185` |
| **Vonage NI v2 + CAMARA SIM/Device** | Phone Footprint pillars 3 & 4 | $0.04 × 3 ≈ **$0.12 per paid refresh** | `telco_api_usage` table — **invisible on `/admin/costs` UI** | Per-msisdn rate limits | `packages/scam-engine/src/phone-footprint/providers/vonage.ts:103–132` |
| **Twilio Lookup v2** | Phone identity (pillar 5) | $0.018/lookup | Logged | 24h Redis (`askarthur:twilio:{phone}`) | `packages/scam-engine/src/twilio-lookup.ts` |
| **Twilio Verify** | Phone OTP (pillar 3.5) | $0.10/cycle | Logged | 3/24h per phone, 10/24h per IP | `apps/web/lib/twilioVerify.ts` |
| **OpenAI Whisper** | Audio transcription | $0.006/min | Logged | None | `apps/web/lib/whisper.ts` |
| **Resemble AI** | Deepfake audio (fallback) | $0.086/min | Logged (units=1, duration TBD) | None | `apps/web/lib/resembleDetect.ts` |
| **Reality Defender** | Deepfake image | $0 placeholder, paid tier TBD | Logged as `$0` | None | `apps/web/lib/realityDefender.ts` |
| **Hive AI** | Facebook-ad image scan | Undocumented | Logged as `$0` | Per-IP burst limit | `packages/scam-engine/src/hive-ai.ts`, `apps/web/app/api/extension/analyze-ad/route.ts:155` |
| **HIBP** | Breach lookup | ~$0.001/call | **NOT LOGGED** | 24h Redis | `apps/web/app/api/breach-check/route.ts` |
| **IPQualityScore** | Phone fraud (Vonage fallback) | $0.003/call | Logged | — | `packages/scam-engine/src/phone-footprint/providers/ipqs.ts` |
| **Resend** | Transactional email | $0.0004/email | Logged | — | `apps/web/lib/resend.ts` |
| **Google Safe Browsing, VirusTotal, ABR, crt.sh** | URL/business reputation | Free tier | Quota-bound, untracked | Local memory / Redis 1–6h | `packages/scam-engine/src/safebrowsing.ts`, `abr-lookup.ts`, `ct-monitor.ts` |

**Free-but-quota-bound** providers (Safe Browsing, VirusTotal, ABR, Hive free tier, Reality Defender free tier) are not telemetered — a runaway flag flip could exhaust the quota before anyone notices.

---

## 2. Caching strategy (defense in depth)

| Layer | What it deflects | Hit rate (est.) | TTL | File |
|---|---|---|---|---|
| **Analysis cache** — keyed by `prompt-version + surface + model + content hash`, PII scrubbed before cache | Claude Haiku | 60–75% on common scams | 48h SAFE / 6h SUSPICIOUS / 1h UNCERTAIN / 15m HIGH_RISK | `packages/scam-engine/src/analysis-cache.ts:1–213` |
| **Embedding cache** — keyed by `model + input-type + text hash` | Voyage single-text calls | 30–50% | 7d Redis, permanent on DB sibling | `packages/scam-engine/src/embedding-cache.ts:1–122` |
| **Idempotency key** — triple-layer (client header → RPC `ON CONFLICT` → Inngest `idempotency: "event.data.requestId"`) | Duplicate Claude calls on retry | ~100% of retries | 24h event window | v73 migration; `packages/scam-engine/src/inngest/events.ts:20–28` |
| **Conditional GET** — ETag / If-Modified-Since | Scamwatch / ACSC / ASIC / FTC / FBI fetches | ≥95% | 30d retention | `pipeline/scrapers/common/http_cache.py:1–154`; v97/v98 migrations |
| **HIBP / Twilio / Safe Browsing per-key Redis** | Per-provider lookups | 40–60% | 24h / 1h / 6h | `hibp.ts`, `twilio-lookup.ts`, `safebrowsing.ts` |
| **Rate-limit buckets** — 18 named buckets (PF / BD / CC / generic) | Hard cap on Twilio Verify, Vonage, HIBP, ABR | 100% of over-limit traffic | per-bucket window | `packages/utils/src/rate-limit.ts:1–493` |
| **Next.js ISR / CDN** — badge SVG, sitemap, blog | CPU & bandwidth | high | 1h–24h | `apps/web/app/badge/[domain]/route.ts`, `sitemap.ts`, `blog/page.tsx` |
| **Sibling-table embeddings** (ADR-0003) — HNSW on `acnc_charity_embeddings`, `scam_reports.embedding` (NULL on SAFE), `verified_scams.embedding` | Disk-IO budget on write-hot parents | — | permanent | Migrations v87–v89 |
| **Inngest fan-out batching** — Reddit cluster caps batch at 60; `feed-items-embed` 40/poll | Voyage batched embeds | — | per cron tick | `packages/scam-engine/src/inngest/feed-items-embed.ts`, `reddit-intel-cluster.ts` |

**Observability:** hit/miss currently goes to Vercel structured logs only — there is no dashboard chart of cache hit rate. Funder-facing claim must say "logged" not "monitored."

---

## 3. Cost observability & brakes

- **`cost_telemetry` table** (`apps/web/lib/cost-telemetry.ts:1–158`) — `logCost()` helper writes via `waitUntil`. Dimensions: `feature, provider, operation, units, unit_cost_usd, estimated_cost_usd, metadata, user_id, request_id`.
- **`/admin/costs` dashboard** (`apps/web/app/admin/costs/page.tsx:1–127`) — queries `today_cost_total` + `daily_cost_summary` views.
- **Global brake**: `DAILY_COST_THRESHOLD_USD` (default $2) — Telegrams admin if exceeded (`apps/web/app/api/cron/cost-daily-check/route.ts:18–25`).
- **Per-feature brakes** (`feature_brakes` table, 24h pause window): Reddit Intel $10, Vuln AU $5, Phone Footprint $5, Charity Check $5 (`cost-daily-check/route.ts:99–140`).
- **Vonage spend** lives in `telco_api_usage` (`vonage.ts:118–131`); cron aggregates both tables (line 45–60) but the dashboard UI does not.
- **Pricing constants** (`cost-telemetry.ts:19–103`, `anthropic.ts:40–61`) snapshotted April 2026; no automatic sync from provider pricing pages.

---

## 4. Issues (honest list for funder due-diligence)

### Critical (cost-runaway)
1. **`parseFloat` NaN footgun on brake env vars** (`cost-daily-check/route.ts:99–140`). If `REDDIT_INTEL_CAP_USD` is set to `"$10"`, `"10 USD"`, or any typo, `parseFloat → NaN`, and `cost > NaN === false` **silently disables the brake**. CLAUDE.md flags this; not yet hardened.
2. **HIBP has no per-IP rate limit and is not in `cost_telemetry`** (`apps/web/app/api/breach-check/route.ts`). Bot hitting it in parallel charges linearly. ~$3/mo today; $300+/mo at 10k DAU.
3. **Vonage spend invisible on `/admin/costs`** — lives in `telco_api_usage` only. Brakes still work; human dashboard view shows wrong number.
4. **Hive AI logged as `$0`** pending pricing contract — flipping `WXT_FACEBOOK_ADS=true` + `NEXT_PUBLIC_FF_FACEBOOK_ADS=true` could meter at unknown rates with no live cost signal.
5. **Rerank costs require manual logging** — `rerank.ts:100–185` returns `estimatedCostUsd` but does not write it. Reddit-intel cluster + intel search consume rerank; needs callsite audit.
6. **Inngest `retries: 3` with no circuit breaker** (`reddit-intel-cluster.ts:200`, `analyze-report.ts:28`, `feed-items-embed.ts:76`) — Anthropic/Voyage outage at 10× traffic triples spend before manual intervention.

### Pre-launch blockers
7. **Charity Check consumer launch blocked** — `acnc_charities` HNSW (481 MB) was dropped during incident remediation (2026-05-09); must move to `acnc_charity_embeddings` sibling table before flipping `NEXT_PUBLIC_FF_CHARITY_CHECK` on. ~1 deploy cycle.
8. **Deepfake detection orphaned** — `apps/web/lib/realityDefender.ts`, `resembleDetect.ts`, `deepfakeDetection.ts` exist but media pipeline never calls them. ~2 hours to wire.

### Operational gaps (documented, not executed)
9. **HIBP leaked-password protection toggle** — 30-second manual action in Supabase Auth dashboard; lone security advisor WARN.
10. **R2 DR bucket not enabled** — workflow shipped (PR #173) but gated on `vars.ENABLE_DR_DUMP`; 4-step setup pending. RPO today is the Supabase PITR window only.
11. **First DR drill never executed** — scheduled 2026-07-01; restore-to-sibling-project script doesn't exist yet (`apps/web/scripts/smoke.ts` deliverable).
12. **Database hygiene backlog** — 245 advisor INFOs (177 unused indexes, 21 empty partitioned shadows, 16 `USING (true)` RLS policies, 5 multiple-permissive WARNs). Baseline clock started 2026-05-08, sweep planned after 2026-06-08.

### Verified controls (post-2026-05-09 incident)
- ✅ `pg-stuck-query-watchdog` cron (`*/5 * * * *`, `apps/web/app/api/cron/pg-stuck-query-watchdog/route.ts`) — pages Telegram at ≥10 min, auto-terminates at 60 min (currently observation-only, `PG_WATCHDOG_AUTO_TERMINATE=false`).
- ✅ Middleware `withTimeout(getUser, 3000)` (`apps/web/middleware.ts:65–69`) + `apps/web/lib/auth.ts:42–54` `AuthUnavailableError` (5s) — degraded Supabase Auth no longer 504s every request.
- ✅ ACNC chunked update (`pipeline/scrapers/acnc_register.py:39–47`) — 5,000 rows × `statement_timeout=300s` per chunk.

---

## 5. Scale ceilings at 10× traffic

| Ceiling | Current | At 10× | Mitigation |
|---|---|---|---|
| Vercel `/api/analyze` timeout | 30s | Slow Anthropic + serial enrichment can 504 | Add explicit per-call timeouts; partially offloaded via `FF_ANALYZE_INNGEST_WEB` |
| Middleware 25s cap | 3s `withTimeout` ✅ | OK | — |
| Supabase pooler (Pro) | ~60 conn | Saturates around 1k DAU sustained | Read replica on Pro+ |
| Inngest concurrency | default 1/function | Reddit clustering serialises | Per-function `concurrency` config |
| Upstash QPS | ~667 ops/sec at 10k req/min | Headroom to ~10k ops/sec on starter | Upgrade tier before launch |
| Disk IO (Supabase compute) | Comfortable post-incident | HNSW reintroduction without sibling pattern depletes | Enforce sibling-table rule (CLAUDE.md) |
| Vector index growth | `verified_scams` + `scam_reports` (NULL-on-SAFE) | Lean | Continue NULL-on-SAFE policy |

---

## 6. Punch-list (prioritised, agent-ready)

Each item is a single PR. Branch name suggestions follow the existing `<scope>/<short-task-name>` convention. Apply migrations via `mcp__supabase__apply_migration` on project `rquomhcgnodxzkhokwni` per CLAUDE.md §"Standard ship workflow."

### P0 — Before next consumer launch

#### 6.1 Harden cost-brake env-var parsing (~30 min)
- **Branch:** `cost-telemetry/brake-parse-validation`
- **Files:** `apps/web/app/api/cron/cost-daily-check/route.ts:99–140`
- **Change:** Replace each `parseFloat(process.env.X ?? "DEFAULT")` with a Zod-validated coercer that throws on `NaN` and falls back to the documented default, logging a WARN to `cost_telemetry` with `feature='cost-brake-config-error'`. Add a unit test asserting `"$10"` and `"10 USD"` raise.
- **Why funder-relevant:** removes the silent-disable footgun called out in CLAUDE.md "Never Do" list.
- **Acceptance:** typecheck + new unit test green; manually set `REDDIT_INTEL_CAP_USD=$10` in a preview env and confirm a WARN row lands in `cost_telemetry` and the brake defaults to `10`.

#### 6.2 HIBP `logCost()` + per-IP rate limit (~2 hours)
- **Branch:** `cost-telemetry/hibp-instrumentation`
- **Files:** `apps/web/app/api/breach-check/route.ts`; `packages/scam-engine/src/hibp.ts`; `packages/utils/src/rate-limit.ts`
- **Change:** (1) Add `logCost({ feature: 'breach-check', provider: 'hibp', operation: 'lookup', units: 1, unit_cost_usd: 0.001 })` after every cache-miss HIBP call. (2) Add `askarthur:bd:hibp` bucket — 5/1h per IP — to `rate-limit.ts` and gate the route. Skip `logCost` on cache hits.
- **Why funder-relevant:** removes the only uncapped paid endpoint; closes the $300+/mo at-10k-DAU exposure.
- **Acceptance:** rate-limit unit test passes; smoke against preview shows `cost_telemetry` row per cache miss only.

#### 6.3 Surface Vonage on `/admin/costs` (~1 hour)
- **Branch:** `cost-telemetry/admin-costs-vonage-overlay`
- **Files:** `apps/web/app/admin/costs/page.tsx`; new SQL view `daily_cost_summary_with_telco`
- **Change:** Create a UNION ALL view combining `cost_telemetry` aggregates with `telco_api_usage` aggregates (provider='vonage', feature='phone_footprint'). Wire the dashboard to the new view. Keep `daily_cost_summary` intact for back-compat.
- **Why funder-relevant:** the cost dashboard currently shows a wrong total during diligence demos.
- **Acceptance:** `/admin/costs` shows a Vonage row; numbers reconcile with `cost-daily-check` cron output.

#### 6.4 Move ACNC HNSW to sibling table — unblock Charity Check (~1 day)
- **Branch:** `charity-check/embedding-sibling-table`
- **Files:** new migration (next sequential after v98); `packages/charity-check/`; `pipeline/scrapers/acnc_register.py`; `packages/scam-engine/src/inngest/acnc-charity-backfill-embed.ts`
- **Change:** (1) Migration: `CREATE TABLE acnc_charity_embeddings (charity_abn text PRIMARY KEY REFERENCES acnc_charities(abn) ON DELETE CASCADE, embedding vector(1024), embedded_at timestamptz, model text)` + HNSW on `embedding`. (2) Move backfill writes from parent to sibling. (3) Update consumer reads to JOIN. (4) Document in `docs/ops/charity-check-config.md`.
- **Why funder-relevant:** unblocks the consumer launch; prevents a repeat of the 2026-05-09 incident.
- **Acceptance:** advisors clean; preview has working semantic search via JOIN; hot-write rate on `acnc_charities` unchanged. Then flip `NEXT_PUBLIC_FF_CHARITY_CHECK` per CLAUDE.md "Before flipping any consumer feature flag" checklist.

#### 6.5 Flip HIBP leaked-password protection toggle (30 sec)
- **Where:** Supabase Auth dashboard → Auth Providers → Password → "Check against HaveIBeenPwned" → ON.
- **Verification:** re-run `mcp__supabase__get_advisors --type security`; the lone WARN should clear.
- **Tracker:** also remove the line from `docs/ops/pending-manual-setup.md` §1.

### P1 — Before scaling traffic 5–10×

#### 6.6 Rerank cost logging audit (~2 hours)
- **Branch:** `cost-telemetry/rerank-callsites`
- **Files:** every consumer of `rerank.ts` — at minimum `packages/scam-engine/src/inngest/reddit-intel-cluster.ts` and intel search route handlers under `apps/web/app/api/v1/intel/`
- **Change:** After each `await rerank(...)` call, add `logCost({ feature: <caller-feature>, provider: 'voyage', operation: 'rerank', units: <docs>, unit_cost_usd: <returned>, estimated_cost_usd: result.estimatedCostUsd })`. Alternatively, wrap inside `rerank.ts` itself — pick the wrapper if all callers should always log (recommended).
- **Acceptance:** grep for `await rerank(` returns zero unlogged sites; smoke against preview shows `cost_telemetry` rows with `provider='voyage', operation='rerank'`.

#### 6.7 Inngest provider-failure circuit breaker (~1 day)
- **Branch:** `cost-telemetry/inngest-circuit-breaker`
- **Files:** `packages/scam-engine/src/inngest/reddit-intel-cluster.ts:200`, `analyze-report.ts:28`, `feed-items-embed.ts:76`; new `feature_brakes` write helper
- **Change:** On consecutive failure (e.g. 5 in 5 min) for an upstream provider, immediately upsert a `feature_brakes` row with `paused_until = now() + 1h` and trigger a Telegram page. Don't wait for the daily aggregation. Track per `(feature, provider)`.
- **Acceptance:** simulate Anthropic 503 in a preview Inngest run; brake row appears within 5 min; subsequent invocations early-return.

#### 6.8 R2 DR bucket setup + first restore drill (~1 day setup + 1 day drill)
- **Files:** follow `docs/ops/pending-manual-setup.md` §2 (R2 bucket + Object Lock + API token + GitHub secrets + `vars.ENABLE_DR_DUMP=true`); then write `apps/web/scripts/smoke.ts` for the post-restore smoke.
- **Why funder-relevant:** RPO/RTO claims for the funder doc need to be defensible; today RPO is "the last Supabase PITR window."

#### 6.9 Cache hit-rate dashboard panel (~½ day)
- **Branch:** `observability/cache-hit-dashboard`
- **Files:** `apps/web/app/admin/costs/page.tsx` (or sibling `apps/web/app/admin/cache/page.tsx`); a Vercel Logs query or new structured-log → DB roll-up
- **Change:** Add a panel that reads from a daily roll-up view of `cache_hit` / `cache_miss` log events (source: `analysis-cache.ts`, `embedding-cache.ts`). If Vercel Logs are not queryable from SQL, write a small Inngest cron that scrapes the structured logs hourly into a `cache_hit_daily` table.
- **Why funder-relevant:** "60–75% deflection on common scams" should be a measured number, not an estimate.

#### 6.10 Deepfake pipeline wiring (~2 hours)
- **Branch:** `media/deepfake-orchestrator`
- **Files:** `apps/web/lib/deepfakeDetection.ts`; whichever media route currently hands off to Whisper/Vision (likely `apps/web/app/api/analyze/` media branch)
- **Change:** Wire the orchestrator that calls Reality Defender (image) and Resemble (audio fallback) into the media pipeline behind `NEXT_PUBLIC_FF_DEEPFAKE`. Ensure both call sites already log to `cost_telemetry` (Resemble does; Reality Defender logs `$0` placeholder — leave for now until paid tier confirmed).
- **Acceptance:** preview with flag ON: image upload → Reality Defender call observed; audio fallback works; flag OFF preserves current behaviour.

### P2 — Hygiene, sequenced after baseline windows

#### 6.11 Database hygiene sweep (after 2026-06-08)
- **Source:** BACKLOG.md → "Database Hygiene & SPF Readiness".
- **Scope:** drop 177 unused indexes (with apples-to-apples re-snapshot first), consolidate multiple-permissive RLS, rewrite 16 `USING (true)` policies, drop 21 empty partitioned shadows, relocate `pg_trgm`.
- **Sequencing:** do this AFTER the Charity Check sibling-table migration (6.4) to avoid double-touching index footprints.

#### 6.12 Pricing-constant freshness (~½ day, recurring)
- **Files:** `apps/web/lib/cost-telemetry.ts:19–103`, `packages/scam-engine/src/anthropic.ts:40–61`
- **Change:** Add a quarterly calendar reminder + a one-line CHANGELOG comment in `cost-telemetry.ts` noting the snapshot date and provider price page URLs. Optional: a CI check that fails if the snapshot date is >120 days old.

---

## 7. Funder-facing summary (defensible claims)

When briefing a funder on cost discipline + scale readiness, lead with these — each is sourced from a specific file/line above so it survives challenge:

- **"~85% of paid API calls are individually cost-telemetered."** Source: §1 instrumentation column. Caveat: HIBP, Hive, Reality Defender, two rerank call sites are gaps with named owners in §6.
- **"Defense-in-depth caching deflects an estimated 60–75% of Claude calls on repeat content and ≥95% of regulator-feed fetches."** Source: §2 hit-rate column. Caveat: deflection is from structured logs, not a live dashboard yet (item 6.9).
- **"Per-feature daily spend brakes pause runaway features for 24h before manual intervention."** Source: `feature_brakes` table + `cost-daily-check/route.ts`. Caveat: parseFloat NaN footgun is item 6.1.
- **"Post-incident controls (2026-05-09) include a 5-min stuck-query watchdog, 3s middleware auth timeout, and chunked UPDATEs on every hot table."** Source: §4 verified-controls list.
- **"Known gaps before consumer scale: Charity Check sibling-table migration, R2 DR bucket activation, first DR drill, HIBP leaked-password toggle."** Source: §4 operational-gaps list. All are tracked in §6 with sized work.

---

## 8. Out of scope (deliberate)

- **Stripe / R2 / Plausible / Upstash recurring spend** — flat or volume-tiered SaaS bills, not per-call. Track in finance, not in `cost_telemetry`.
- **Reddit official API spend** — currently $0; if Reddit API pricing reactivates, add to §1.
- **Pipeline scraper compute (GitHub Actions minutes)** — bounded by repo plan; not paid per-call.
- **Stripe fee instrumentation** — payment-processor fees aren't an external API spend in the cost-control sense.

---

## Changelog

- **2026-05-10** — Initial plan, drafted from cross-codebase audit. Three parallel research agents (cost surface, caching, scaling issues) on branch `claude/review-api-costs-caching-RPzI3`.
