# Cost reduction plan

**Drafted:** 2026-05-18
**Aggression level:** Conservative — zero user-visible regressions.
**Scope:** Three workstreams chosen via [`cost scope` Q on 2026-05-18]:

1. Scraper + Vercel cron + Inngest audit
2. Anthropic Batch API rollout to non-latency-sensitive features
3. Unified infra-cost dashboard + weekly digest

**Not in scope:** dropping infra tiers (Vercel Pro → Hobby, Supabase Pro → free), dropping feeds without data showing they're useless, anything that adds user-visible latency.

---

## Existing cost surface (baseline)

Before drafting new work, this is what's already in place — built so future agents know where to look.

### Runtime cost (mature)

| Surface                | System                                                                                                                                          | Files                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Per-call AI/API spend  | `cost_telemetry` table + `logCost()` helper                                                                                                     | `packages/utils/src/cost-telemetry.ts`            |
| Per-feature spend caps | `DAILY_COST_THRESHOLD_USD=2`, `VULN_AU_ENRICHMENT_CAP_USD=5`, `REDDIT_INTEL_CAP_USD=10`, `PHONE_FOOTPRINT_CAP_USD=5`, `CHARITY_CHECK_CAP_USD=5` | env vars                                          |
| Brake mechanism        | `feature_brakes` table — rows written by `cost-daily-check` cron, read by feature code as a kill switch                                         | `apps/web/app/api/cron/cost-daily-check/route.ts` |
| Daily alerts           | Telegram DM when threshold breached                                                                                                             | `cost-daily-check` cron, every 6h                 |
| Weekly digest          | WoW comparison                                                                                                                                  | `cost-weekly-digest` cron, Sundays 22:00 UTC      |
| Admin dashboard        | `/admin/costs` + tile grid landing at `/admin` (PR #257)                                                                                        | `apps/web/app/admin/costs/`                       |
| DB safety nets         | Hot-table list, chunked writes, `pg-stuck-query-watchdog` (every 5min), HNSW/large-GIN ban on hot tables                                        | CLAUDE.md "Critical Rules"                        |

### CI / build cost (well-optimized)

| Surface            | State                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| CI duration        | avg **1.27 min** (last 30 runs, range 0.05–2.47 min)                                                    |
| Turbo remote cache | wired via `TURBO_TOKEN`, `TURBO_TEAM`, `TURBO_REMOTE_CACHE_SIGNATURE_KEY` in `.github/workflows/ci.yml` |
| PR builds          | affected-only via `--filter="...[origin/<base>]"`                                                       |
| `main` builds      | full run to warm cache for next preview                                                                 |
| Concurrency        | `cancel-in-progress: true` cancels superseded runs                                                      |
| Scrapers           | **tiered** (3h / 6h / 12h / daily) + HTTP `If-None-Match` / `If-Modified-Since` short-circuit           |
| Build cache rules  | `turbo.json` excludes `*.test.*`, `*.md`, `__tests__/**` from invalidation                              |

### What's NOT explicitly managed (the gap this plan closes)

| Surface                        | Gap                                                                                                                               | Est. addressable $/month |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Vercel function invocations    | 16 crons + ~30 Inngest functions, no per-function invocation report. `pg-stuck-query-watchdog` alone = 8,640 invocations/month    | Low–medium               |
| GitHub Actions scraper minutes | `scrape-feeds.yml` avg 8.1 min × tiered = ~3,900 min/month; `scrape-vulnerabilities.yml` avg 6.9 min × ~24/day = ~5,000 min/month | High                     |
| Anthropic Batch API adoption   | Only PR-C1 (regulator-intel) uses Batch. Everything else is realtime at full price. Most Inngest features are latency-tolerant    | High                     |
| Supabase compute hours         | Watchdog catches stuck queries but no proactive query-cost report. `pg_stat_statements` exists but no dashboard reads it          | Medium                   |
| Unified infra-cost digest      | Anthropic-only via `cost_telemetry`. No combined Vercel + GA + Supabase + Anthropic single-pane                                   | Org leverage             |

---

## Sequencing principle

**Audit before cut.** Every later decision depends on having the numbers. The order below is cheap-and-safe first.

```
Phase 0 — Observability       (PR A1, A2, A3)  ← ship the data first
Phase 1 — Unified digest      (PR B1)          ← surface it weekly
Phase 2 — Conservative cuts   (PR C1, C2, C3)  ← data-driven, each revertable
Phase 3 — Batch API rollout   (PR D1 audit + D2…DN migrations)
```

Phases 0–2 are ~7 PRs, all small/medium. Phase 3 is 1 audit PR + ~6 migration PRs.

---

## Phase 0 — Observability (3 PRs, all read-only)

### PR A1 — `/admin/costs/infra` unified dashboard + nightly billing pulls

**Effort:** M (~2 days)
**Risk:** Low — read-only dashboard, no behaviour change to existing features
**Blast radius:** new Inngest function + new DB table + new admin page

**Scope:** New Inngest function `billing-ingest-nightly` runs at 02:00 UTC daily, pulls usage from:

- **Vercel** — `GET https://api.vercel.com/v1/usage` (needs `VERCEL_TOKEN` + `VERCEL_TEAM_ID` env vars — setup steps in issue #299)
- **GitHub Actions** — `GET https://api.github.com/repos/{owner}/{repo}/actions/billing/usage` (uses existing `GITHUB_TOKEN`)
- **Anthropic** — already in `cost_telemetry`; just `SUM(cost_usd) WHERE created_at::date = $1`
- **Supabase** — **verified 2026-05-18: no public usage API** via Management token (`/v1/projects/<ref>/usage` and org-level usage all return 404). Instead derive cost from: (a) fixed Pro tier base via `INFRA_COST_SUPABASE_MONTHLY_BASE_USD=25` env var, (b) compute hours / storage GB / egress GB via direct SQL on `pg_stat_database` + `pg_database_size` + `pg_stat_replication`. One row per dimension stored as `provider='supabase-base|compute|storage|egress'`. Cleaner than a dashboard scraper.

**Migration:** new table `infra_cost_daily (date, provider, usd_cents, raw_usage_jsonb)`.

**Page:** extend `/admin/costs` with an "All surfaces" tab. Reuses existing admin HMAC auth from `lib/adminAuth.ts`. Tile grid on `/admin` (PR #257) gets a new tile linking to the All-surfaces view.

**CLAUDE.md compliance:**

- ✅ New table = lean write target, no hot-table risk
- ✅ No `SET statement_timeout = 0`; nightly ingest takes seconds
- ✅ Inngest function header comment documents expected duration

**Validation:**

- Apply migration via `mcp__supabase__apply_migration` on `rquomhcgnodxzkhokwni`
- Run Inngest function manually, confirm row written per provider
- `/admin/costs/infra` renders all 3 providers' last 30 days

**Rollback:** Drop the new function + table + page. No impact to existing cost system.

---

### PR A2 — Per-scraper runtime + new-row telemetry

**Effort:** S (~1 day)
**Risk:** Low — pure observation
**Blast radius:** new Inngest function + new DB table + dashboard column

**Scope:** New nightly Inngest function `scraper-cost-audit` writes per-scraper metrics to a new `scraper_telemetry` table:

```sql
CREATE TABLE scraper_telemetry (
  date date,
  source text,         -- 'scamwatch_alerts', 'urlhaus', etc.
  rows_added int,      -- new rows in feed_items / verified_scams / etc. attributed to this source
  runtime_seconds int, -- from GitHub Actions API
  runs int,            -- runs in that day
  PRIMARY KEY (date, source)
);
```

Source-of-truth: `feed_items.source` for row counts; GitHub Actions API `/repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs` for runtime stats.

Surfaces a sortable table on `/admin/costs/infra` showing `$/row` (using GA minutes × rate) and `rows/run` per scraper. The "$/row" column is what informs Phase 2's dead-feed deletion decisions.

**Validation:**

- Run function manually, verify row count matches `SELECT count(*) FROM feed_items WHERE source = X AND created_at::date = yesterday`
- Sort by `rows/run ASC`: any zero-row scrapers become PR C1's deletion candidates

**Rollback:** Drop function + table + dashboard column.

---

### PR A3 — Inngest + Vercel cron invocation report

**Effort:** S (~1 day)
**Risk:** Low
**Blast radius:** new Inngest function + new DB table + dashboard column

**Scope:** New nightly Inngest function `function-invocation-audit` writes to `function_invocation_daily`:

```sql
CREATE TABLE function_invocation_daily (
  date date,
  function_name text,   -- 'pg-stuck-query-watchdog', 'reddit-intel-trigger', etc.
  invocations int,
  avg_duration_ms int,
  source text,          -- 'vercel-cron' | 'inngest'
  PRIMARY KEY (date, function_name)
);
```

- **Inngest:** verified 2026-05-18 — no `/v1/runs`, `/v1/functions`, or `/v1/account` endpoints exist on the current plan tier (all return 404). Only `/v1/events` is exposed. **Derive counts** by paginating `GET /v1/events?name=inngest/function.finished&from=...&to=...` (returns events with `data.function_id` + `data.runtime_ms`), grouped per function. More code than expected; doable with existing `INNGEST_API_TOKEN`.
- **Vercel crons:** count = (events per day from `vercel.json` schedule) — deterministic. Optionally cross-check with Vercel logs API for actual fires (catches missed runs).

Sortable column on `/admin/costs/infra` showing "invocations/day" + "avg duration" per function. PR C2's cron right-sizing decisions key off this.

**Validation:** Compare derived Inngest counts against a known function (e.g. `pg-stuck-query-watchdog` should be ~288/day). Vercel: compare against `vercel.json` declared crons × days, tolerance ±5%.

**Rollback:** Drop function + table + dashboard column.

---

## Phase 1 — Unified weekly digest (1 PR)

### PR B1 — Replace `cost-weekly-digest` body with all-surfaces view

**Effort:** S (~½ day)
**Risk:** Low — Telegram-only change, no DB or feature impact
**Blast radius:** `apps/web/app/api/cron/cost-weekly-digest/route.ts` body builder

**Scope:** Same Sunday 22:00 UTC cron, expanded message. Pulls last 7 days from `infra_cost_daily` + `scraper_telemetry` + `function_invocation_daily`, compares to prior 7 days, sends one Telegram message with sections:

```
📊 Weekly Cost Digest — week N

ANTHROPIC          $XX.XX  (▲ +$X.XX vs last wk)
VERCEL             $XX.XX  (▼ -$X.XX)
GITHUB ACTIONS     $XX.XX
SUPABASE           $XX.XX  (manual)
                ──────────
TOTAL              $XX.XX  (▲ +$X.XX, +X%)

🔝 Top movers:
- urlhaus scraper +320min/day (vs 180 prev wk)
- enrich-vulnerability +$3.20/day Anthropic

📉 Quiet feeds (consider deletion in next sweep):
- pfra_members: 0 rows added in 7 days
- old_feed_x: 0 rows added in 30 days
```

Existing per-feature Anthropic digest body is preserved as a section, not replaced.

**Validation:** Manually trigger cron in dev, compare Telegram output to dashboard data, expect parity.

**Rollback:** Revert the route handler. No DB / schema change.

---

## Phase 2 — Conservative cuts (3 PRs, data-driven from Phase 0)

### PR C1 — Drop scrapers that produced zero new rows in 30 days

**Effort:** S per scraper × N candidates
**Risk:** Low — by definition the feed was useless; restoration is a workflow-file revert
**Blast radius:** workflow file + Python scraper file + Inngest fan-out branch per dead feed
**Depends on:** PR A2 data (28+ days needed before this can be filed with evidence)

**Scope:** Concrete deletion list comes from PR A2's `rows_added_30d = 0` query. For each:

1. Remove workflow input from `.github/workflows/scrape-feeds.yml`
2. Remove the Python scraper file in `pipeline/scrapers/`
3. Remove the Inngest fan-out branch in `packages/scam-engine/src/inngest/feed-sync.ts`
4. Keep the DB table (no schema drop — preserves historical rows)
5. Document in `docs/system-map/background-workers.md` that this scraper was retired and why

**Anti-pattern:** Don't drop a feed because it's slow. Drop only when 0 rows × 30 days.

**Validation:** Confirm in `infra_cost_daily` that GA minutes drop in the week following deletion.
**Rollback:** Revert the workflow + scraper deletion. Table is intact; backfill possible.

---

### PR C2 — Lower frequency on overprovisioned Vercel crons

**Effort:** S
**Risk:** Low if Phase 0 data supports it
**Blast radius:** `apps/web/vercel.json` per-cron changes
**Depends on:** PR A3 data

**Rule:** Lower a cron's cadence ONLY if (a) the freshness budget supports it AND (b) no downstream feature breaks.

**Candidate inventory (current frequencies):**

| Cron                      | Current cadence | Possible lower | Notes                                                                                                                                       |
| ------------------------- | --------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `pg-stuck-query-watchdog` | `*/5 * * * *`   | **DO NOT cut** | Born from incident 2026-05-09; cutting it trades $/month vs another 20-hour outage. ~$8.64/month at typical Vercel rates — cheap insurance. |
| `cost-daily-check`        | every 6h        | every 12h      | Brakes still fire same-day; alerts arrive up to 6h later max. Acceptable for early-stage.                                                   |
| `bot-queue-sweep`         | every 6h        | keep           | Already conservative; bot UX is timing-sensitive                                                                                            |
| `bot-queue-cleanup`       | daily 04:00     | keep           | Already daily                                                                                                                               |
| `scraper-brake-alert`     | `*/15 * * * *`  | every 30 min   | Audit PR A3 first — if this rarely fires, can stretch                                                                                       |
| `vuln-retention`          | daily 03:00     | keep           | Already daily                                                                                                                               |
| `scam-reports-retention`  | daily 03:30     | keep           | Already daily                                                                                                                               |
| `reddit-intel-retention`  | daily 04:30     | keep           | Already daily                                                                                                                               |
| `ensure-partitions`       | daily 02:00     | keep           | Idempotent, daily is right                                                                                                                  |
| `feedback-digest`         | daily 09:00     | keep           | User-facing cadence                                                                                                                         |
| `health-digest`           | daily 22:00     | keep           | Already daily                                                                                                                               |
| `reddit-intel-trigger`    | daily 08:00     | keep           | Already daily                                                                                                                               |
| `weekly-blog`             | Mon 12:00       | keep           | Already weekly                                                                                                                              |
| `weekly-email`            | Mon 14:00       | keep           | Already weekly                                                                                                                              |
| `nurture`                 | daily 23:00     | keep           | Already daily                                                                                                                               |
| `cost-weekly-digest`      | Sun 22:00       | keep           | Already weekly                                                                                                                              |

**Realistic v1 changes:** drop `cost-daily-check` from 6h → 12h. Audit `scraper-brake-alert` invocations via PR A3 before touching. Everything else is appropriately tuned.

**Validation:** After each frequency change, monitor for 7 days. If anything degrades, revert.
**Rollback:** Per-cron revert.

---

### PR C3 — Inngest function consolidation

**Effort:** S
**Risk:** Low — pure refactor
**Depends on:** PR A3 data

**Scope:** PR A3's data identifies functions that do near-identical work. Candidates to look for (audit-first, no presumption):

- Multiple retention crons hitting the same table on different days (consolidate if so)
- Fan-out functions that always run the same children (collapse if branches are identical)
- Test scaffolding functions still firing in prod

**Anti-pattern:** Don't consolidate functions that look similar but have different ownership / SLAs / failure modes. The point of separate functions is independent retry semantics.

---

## Phase 3 — Anthropic Batch API rollout

### PR D1 — Anthropic feature classification

**Effort:** S (~½ day)
**Risk:** None — pure analysis

**Scope:** New doc `docs/ops/anthropic-cost-classification.md`. Each feature that calls Claude gets tagged:

- **Realtime** — user-facing, <30s budget, MUST NOT use Batch
- **Latency-tolerant** — background job, OK to wait minutes-to-24h, eligible for Batch (~50% cost)

**Confirmed Realtime (do NOT migrate):**

- `/api/analyze` — user-facing scan
- `/api/media/analyze` — user-facing OCR scan
- `/api/extension/analyze` — Chrome extension scan
- `meta-brp-report` if user-triggered
- All bot endpoints (Telegram/WhatsApp/Slack/Messenger) — user waiting

**Strong Latency-tolerant candidates (Batch fits):**

- `reddit-intel-classifier` (daily Sonnet 4.6 classifier run)
- `enrich-vulnerability` Inngest function (daily enrichment)
- `cluster-builder` (daily)
- `analyze-brand` Inngest function (post-analyze enrichment, async)
- `acnc-charity-backfill-embed` (one-shot backfill)
- Weekly digest classifiers (Reddit Intel weekly email)
- `feedback-triage-refresh` if model-assisted
- Any future "classify in bulk" pipeline

**Output:** The doc lists each, with its eligibility decision and the migration PR number.

---

### PR D2…DN — One PR per latency-tolerant feature migration

**Effort:** S per PR
**Risk:** Low — each feature is already async (Inngest), failure mode is "batch never completes → function retries", which matches today's retry semantics
**Reference shape:** PR-C1 (regulator-intel) is the first use of Batch in this codebase. Memory notes: "ship partial-results / resume story in verification" — preserve that pattern.

**Migration recipe per feature:**

1. Read the current `anthropic.messages.create` call
2. Swap for `anthropic.beta.messages.batches.create` with the same prompt
3. Inngest function emits an `await step.waitForEvent` for the batch-completion webhook
4. On completion, process results identically to current realtime path
5. Cost telemetry continues to write to `cost_telemetry` (no schema change), with `cost_usd` halved

**Concrete PR list (each independent):**

- **PR D2** — `reddit-intel-classifier` Batch migration
- **PR D3** — `enrich-vulnerability` Batch migration
- **PR D4** — `cluster-builder` Batch migration
- **PR D5** — `analyze-brand` Batch migration
- **PR D6** — `acnc-charity-backfill-embed` Batch migration (largest single-feature spend, since it's a 63K-row backfill)
- **PR D7** — weekly digest classifiers Batch migration

**Validation per PR:**

- Run new Batch path in parallel with old realtime path for 7 days on a feature-flag canary
- Compare output diff: must be ≤1% disagreement rate
- Check `cost_telemetry` shows ~50% cost reduction for that feature
- Flip flag to Batch-only; remove realtime code in a follow-up PR

**Rollback per PR:** Feature-flag flip back to realtime.

---

## Expected savings (order-of-magnitude, not commitments)

| Phase        | Rough savings                                                                                                                               | Notes                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Phase 0      | $0 direct — observability investment                                                                                                        | Required for every later optimization            |
| Phase 1      | $0 direct — surfaces data weekly                                                                                                            |                                                  |
| Phase 2 (C1) | ~10–20% of GA scraper minutes IF 2–4 dead feeds confirmed                                                                                   | Per-feed savings: ~$0.50–$2/month each           |
| Phase 2 (C2) | ~$5–15/month from cron right-sizing                                                                                                         | Small but real; consolidation is mostly tidiness |
| Phase 3      | **The big number.** If migrated features represent ~30% of Anthropic spend, and Batch is ~50% off, that's ~15% of total Anthropic spend cut | Likely the largest single line item              |

**Total project cost:** ~9 PRs × small/medium. Done as a focused sprint: 2–3 weeks. Interleaved with other work: 6–8 weeks.

---

## Items intentionally NOT in this plan

- **Dropping Vercel Pro / Supabase Pro tiers** — usage on hot tables (PR A3 will show) and Anthropic concurrency needs (current usage) probably don't fit Hobby/Free yet. Revisit once Phase 0 data is in.
- **Switching Anthropic models** (e.g. Haiku 4.5 → smaller) — quality risk; out of scope for "cost reduction without UX regression".
- **Caching Anthropic responses aggressively** — would need a separate sliding-cache plan; the prompt-cache feature is per-call. Defer.
- **Cutting `pg-stuck-query-watchdog` frequency** — explicitly preserved per incident 2026-05-09. Costs ~$8.64/month at most; saves a 20-hour outage.
- **Dropping triage labels / archive systems** — out of scope.

---

## Setup questions — RESOLVED 2026-05-18

1. ✅ **Vercel tokens** — not currently in env. Setup steps captured in issue [#299](https://github.com/matchmoments-admin/ask-arthur/issues/299) (Create read-only token at vercel.com/account/tokens → fetch team ID via `/v2/teams` → add `VERCEL_TOKEN` + `VERCEL_TEAM_ID` to Vercel env across Prod/Preview/Dev + mirror to local `.env.local`).
2. ✅ **Inngest counts** — verified: no per-function endpoint exists (`/v1/runs`, `/v1/functions`, `/v1/account` all 404). Only `/v1/events` works. **Derive counts** from `inngest/function.finished` events by pagination. PR A3 (#301) scope updated.
3. ✅ **Supabase usage** — verified: no public usage endpoint via Management API. **Don't scrape the dashboard.** Use fixed Pro tier base (`INFRA_COST_SUPABASE_MONTHLY_BASE_USD=25`) + direct SQL probes for compute/storage/egress overage. Cleaner, no fragility. PR A1 (#299) scope updated.
