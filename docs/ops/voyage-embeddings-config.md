# Voyage embeddings — operator config & runbook

Single source of truth for the Voyage retrieval stack: env vars, feature flags, dashboard toggles, backfill triggers, smoke tests, and the deferred eval work. Reference for the full design lives in:

- ADR-0003 — embedding model versioning
- ADR-0004 — multi-domain embedding model selection
- ADR-0005 — pgvector index policy (HNSW vs IVFFlat)
- ADR-0006 — query-vector retention
- `packages/scam-engine/src/embeddings.ts` — the call site
- `packages/scam-engine/src/rerank.ts` — second-stage reranker

---

## 1. Production migration state (as of 2026-05-04)

| Migration | Applied | What it adds                                                                                                      |
| --------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| v82       | yes     | `reddit_post_intel.embedding`, `reddit_intel_themes.centroid_embedding` (IVFFlat lists=100/50)                    |
| v86       | yes     | `embedding_model_version` siblings on the v82 columns                                                             |
| v87       | yes     | `acnc_charities.name_mission_embedding` + HNSW + `match_charities_by_embedding` RPC                               |
| v88       | yes     | `match_reddit_intel` + `match_reddit_intel_themes` RPCs (IVFFlat probes=10)                                       |
| v89       | yes     | `scam_reports.embedding` + `verified_scams.embedding` + HNSW + `match_scam_reports` + `match_verified_scams` RPCs |

All RPCs set their own `set_config` for `hnsw.ef_search` (80) or `ivfflat.probes` (10) — no global tuning needed.

---

## 2. Env vars — all live in `turbo.json` `globalEnv` and Vercel project env

### Required (must be set on prod)

| Var                                        | Where  | Purpose                                |
| ------------------------------------------ | ------ | -------------------------------------- |
| `VOYAGE_API_KEY`                           | Vercel | Voyage API key for embeddings + rerank |
| `UPSTASH_REDIS_REST_URL` + `_TOKEN`        | Vercel | Single-text embed cache (7-day TTL)    |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | Vercel | Backfill + per-submission embed jobs   |

### Optional — model overrides

| Var                          | Default                 | Notes                                                                                                                         |
| ---------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `EMBEDDING_MODEL_GENERIC`    | `voyage-3.5`            | Used by every embed call without `domain` set                                                                                 |
| `EMBEDDING_MODEL_FINANCE`    | `voyage-finance-2`      | Used when `domain: "finance"` (or scam_type matches finance set)                                                              |
| `EMBEDDING_MODEL_MULTIMODAL` | `voyage-multimodal-3.5` | Registered but call path NOT yet implemented (throws on use)                                                                  |
| `EMBEDDING_PROVIDER`         | `voyage`                | Legacy switch — set to `openai` for the OpenAI fallback. Generic-domain only.                                                 |
| `VOYAGE_RERANK_MODEL`        | `rerank-2.5-lite`       | Used by `/api/v1/intel/search` and `/api/v1/scams/search`. Switch to `rerank-2.5` only if eval shows lite tier underperforms. |

### Feature flags (all `NEXT_PUBLIC_FF_*`, default OFF)

| Flag                                  | What it gates                                                                                                         |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_FF_REDDIT_INTEL_B2B_API` | `/api/v1/intel/{themes,digest,quotes,search}` — returns 503 when off (after API-key check)                            |
| `NEXT_PUBLIC_FF_SCAMS_SEARCH_B2B_API` | `/api/v1/scams/search` — same shape                                                                                   |
| `NEXT_PUBLIC_FF_CHARITY_CHECK`        | Consumer charity-check page; semantic typosquat detection lights up automatically once `acnc_charities` is backfilled |

---

## 3. One-time operator follow-ups (do these in order)

### 3.1 Voyage dashboard — toggle "zero-day retention"

Per ADR-0006, do not allow Voyage to retain query text. This is org-wide for our Voyage account.

```
1. Log in to https://dashboard.voyageai.com
2. Settings → Privacy & Data → Zero-day retention → ON
3. Confirm. Applies retroactively to future calls.
```

No code change. One-time action. Re-verify quarterly.

### 3.2 Per-environment `VOYAGE_API_KEY` split (recommended, not blocking)

Today prod and preview share one Voyage key, so a runaway preview deploy can eat into the prod quota. Split:

```
1. Voyage dashboard → API Keys → Create new
   - Name: "ask-arthur-prod" (existing key, rename if needed)
   - Name: "ask-arthur-preview" (new)
2. Vercel → ask-arthur project → Settings → Environment Variables
   - Set VOYAGE_API_KEY (Production scope) to the prod key
   - Set VOYAGE_API_KEY (Preview + Development scopes) to the preview key
3. Redeploy a preview to confirm the right key is active.
```

### 3.3 Backfill: ACNC charities (one-shot, ~$0.11 total)

The synchronous embed path covers new charities the moment the daily ACNC scraper adds them. The historical 63k tail needs a manual sweep:

```
# Trigger via Inngest dashboard (https://app.inngest.com → Events → Send)
# or via the Inngest send API in a one-off script
{
  "name": "acnc.charity-embed.backfill.v1",
  "data": {}
}
```

Each invocation embeds up to 5000 rows (25 batches of 200). Repeat until:

```sql
SELECT count(*) FROM acnc_charities WHERE name_mission_embedding IS NULL;
-- target: 0
```

~13 invocations expected. Cost is logged under `cost_telemetry` `feature='charity-check-embed'`.

### 3.4 Backfill: scam_reports + verified_scams (one-shot, sub-cent)

Same pattern, single invocation suffices at current row counts:

```
{
  "name": "scam-reports.backfill-embed.v1",
  "data": {}
}
```

Verification:

```sql
SELECT count(*) FROM scam_reports
  WHERE embedding IS NULL AND verdict != 'SAFE'
  AND length(scrubbed_content) >= 40;
-- target: 0

SELECT count(*) FROM verified_scams
  WHERE embedding IS NULL AND length(summary) >= 20;
-- target: 0
```

Cost telemetry: `feature='scam-reports-backfill-embed'`.

### 3.5 Flip B2B feature flags (when ready)

```
1. Vercel → Settings → Environment Variables
   - NEXT_PUBLIC_FF_REDDIT_INTEL_B2B_API=true (Production)
   - NEXT_PUBLIC_FF_SCAMS_SEARCH_B2B_API=true (Production)
2. Trigger a redeploy (push empty commit or use the Vercel UI redeploy)
```

Run the smoke tests in §4 immediately after.

### 3.6 Email Anthropic about enterprise Voyage credit

Anthropic has a partnership with Voyage and may extend credit / discount terms for our usage tier. Send the request to your existing Anthropic account contact with: monthly Voyage spend, projected 12-month spend, primary use case (anti-scam / consumer protection).

No code change. Status: **outstanding**.

---

## 4. Smoke tests — run after each flag flip

### 4.1 Charity Check semantic typosquat (no flag — runs as soon as backfill completes)

```
curl -X POST https://askarthur.au/api/charity-check \
  -H 'Content-Type: application/json' \
  -d '{"name": "Save Australian Children"}'
```

Expected (assuming the impersonator-style query): `typosquat_match: true` with `typosquat_signal` of `"semantic"` or `"both"`.

### 4.2 Reddit Intel search

```
curl -X POST https://askarthur.au/api/v1/intel/search \
  -H 'Authorization: Bearer <api-key>' \
  -H 'Content-Type: application/json' \
  -d '{"query": "myGov refund SMS", "limit": 5}'
```

Expected: `posts: [...]` + `themes: [...]` (depending on scope) + `usage.embedTokens > 0` + `usage.rerankTokens > 0` (or `fallback: true` if Voyage rerank was rate-limited).

### 4.3 Scams search

```
curl -X POST https://askarthur.au/api/v1/scams/search \
  -H 'Authorization: Bearer <api-key>' \
  -H 'Content-Type: application/json' \
  -d '{"query": "Bitcoin investment opportunity guaranteed returns", "scamType": "investment", "limit": 5}'
```

Expected: `domain: "finance"` (driven by the `scamType` hint) + `usage.embedModel: "voyage-finance-2"` + reports/verifiedScams arrays.

---

## 5. Deferred eval — Matryoshka 256-dim sweep

Voyage 3.5 supports Matryoshka truncation — we can drop from 1024 → 512 → 256 dims for ~50% / 75% storage savings respectively. Voyage's published numbers show only ~0.31% quality drop at 1024 int8 vs 2048 float, and binary-512 still beats OpenAI-3072-float by 1.16%.

**To run the sweep** (when row counts make it worth doing — currently no):

1. Take a 1000-row sample from `reddit_post_intel`.
2. Re-embed at `output_dimension: 512` and `output_dimension: 256` via the Voyage API directly (bypass the 1024 default in `embeddings.ts`).
3. Compute pairwise cosine F1 against the existing 1024-dim cluster assignments.
4. If F1 holds within 1% of baseline at 512, plan a migration to halve pgvector storage on `scam_reports` / `verified_scams` / `acnc_charities` (`v90+`).

Not a one-PR change — touches schema, the embed call, and the reindex policy. **Defer until storage cost matters** (currently <100 MB total for all embedding columns).

---

## 6. Cost monitoring

All Voyage spend is tagged in `cost_telemetry`:

```sql
-- Per-feature daily spend
SELECT feature, provider, sum(estimated_cost_usd) AS usd_today
  FROM cost_telemetry
 WHERE created_at >= NOW() - INTERVAL '1 day'
   AND provider = 'voyage'
 GROUP BY feature, provider
 ORDER BY usd_today DESC;
```

Expected features:

- `reddit-intel-embed` (daily ~\$0.001)
- `charity-check-embed` (one-shot during backfill, then ~\$0.0001/day delta)
- `scam-report-embed` (per-submission, scales with traffic)
- `scam-reports-backfill-embed` (manual triggers only)
- `intel-search` / `scams-search` (per B2B call, embed + rerank stages)

**Alerts**: existing daily-cost-check Inngest cron emails when feature spend exceeds the configured cap. No Voyage-specific cap is currently set — add `VOYAGE_DAILY_CAP_USD` if/when monthly spend exceeds \$50.

---

## 7. Reindex policy (per ADR-0003)

When swapping models (e.g. `voyage-3.5` → `voyage-4`):

1. Add the new model id to `MODEL_REGISTRY` in `embeddings.ts`. Don't flip the default.
2. Add the new model's pricing constant to `apps/web/lib/cost-telemetry.ts`.
3. Re-embed all rows where `embedding_model_version != <new>` via the relevant backfill Inngest function. Fire `acnc.charity-embed.backfill.v1`, `scam-reports.backfill-embed.v1`, etc. — the functions are idempotent on `embedding IS NULL` only, so to force re-embed temporarily you'd null the column first OR add a "force" path.
4. When `count(*) WHERE embedding_model_version != <new>` reaches zero across all tables, flip the default in `embeddings.ts`.
5. Keep the old model id callable in the registry for ~30 days for in-flight retries.

Until then, mid-rollout queries cosine-compare across model spaces and produce silent garbage. **Don't shortcut this.**
