# Clone-watch (Layer 0) — Operational Config Checklist

**Purpose.** Single source of truth for every env var, feature flag,
verification SQL, cost-telemetry tag, and operator runbook step that the
Layer 0 clone-watch surface depends on. If a flag needs flipping, a
suspect run needs verifying, or rows need wiping for a re-run — it goes
here.

Referenced from [CLAUDE.md](../../CLAUDE.md) Quick Reference and from
[docs/plans/clone-watch-mvp.md](../plans/clone-watch-mvp.md). Keep updated
each PR.

> **Status (2026-05-24, post-PR #408).** Layer 0 LIVE in prod.
> `FF_SHOPFRONT_CLONE_WATCH=true`. v2 matcher (scam-context-token gate)
> shipped. Day-1 verification: 5 hits / 20% FP / 4 brands → passes the
> <30% FP + ≥3 daily-hits acceptance gate. v3 follow-up [#409](https://github.com/matchmoments-admin/ask-arthur/issues/409)
> tracks the `au`-token mid-word leak (`autoecolesoultbycfconduite.fr`
> class). Page `/clone-watch` rendering with `noindex,nofollow` until #371
> v1 lawyer-vetted copy returns.

**Status legend**

| Marker | Meaning                           |
| ------ | --------------------------------- |
| ✅     | Live / configured / shipped       |
| ⏳     | In progress this sprint           |
| ❌     | Not started                       |
| 🔒     | Blocked — waiting on external dep |

---

## 1. Feature flag

| Flag (env var)             | Type   | Default | Status | Gates                                                                                                                                                                                                                                                                            | Flip when                                                                                           |
| -------------------------- | ------ | ------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `FF_SHOPFRONT_CLONE_WATCH` | server | `false` | ✅     | Master switch on the `shopfront-nrd-daily-ingest` Inngest function. When `false`, the function short-circuits before downloading the NRD zip and emits no telemetry. When `true`, the daily 08:30 UTC run downloads, parses, matches, and inserts into `shopfront_clone_alerts`. | After PR #398 ship + post-merge smoke. Currently ON in prod since 2026-05-24 (flag flip + 1st run). |

The page surface (`apps/web/app/clone-watch/page.tsx`) reads from the
table directly and does NOT consult the flag — flipping the flag back to
`false` stops new rows from landing but the page continues to render the
last successful run's data. To blank the surface entirely, flip the flag
AND truncate `WHERE source='nrd'`.

---

## 2. Environment variables

| Var                        | Status | Where set                      | Notes                                                                                                                                                                                               |
| -------------------------- | ------ | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FF_SHOPFRONT_CLONE_WATCH` | ✅     | Vercel → Production            | Master flag. Flipped ON 2026-05-24.                                                                                                                                                                 |
| `WHOISDS_NRD_ZIP_URL`      | (none) | Vercel → Production (optional) | **Optional override**. PR #400 made the URL deterministic via `computeNrdUrl(yesterdayUtc())`. Leave unset in normal ops; only set when back-filling a specific historical date or swapping source. |
| `INNGEST_EVENT_KEY`        | ✅     | Vercel → Production            | Already provisioned (used by every other Inngest function). Required by the manual-trigger curl in §5.                                                                                              |
| `TELEGRAM_ADMIN_CHAT_ID`   | ✅     | Vercel → Production            | Already provisioned (used by other digests). Receives the per-run digest "Today's clone-watch: N hits across M brands."                                                                             |

No new third-party API keys. whoisds.com NRD daily zip is free-tier,
no-auth, deterministic-URL.

---

## 3. Cost-telemetry tag

| Tag (snake_case)              | Cost               | Notes                                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shopfront_clone_watch`       | A$0/mo (free tier) | Successful daily run. Metadata: `{ hits_found: N, rows_inserted: M, brands_with_hits: K, duration_ms: T }`. **Distinct from `shopfront_clone_scan`** (Phase A future scope — installed-merchant scanner). The hyphen-to-underscore convention matches `phone_footprint`, `reddit_intel`, `charity_check`, `vuln_au_enrichment`. |
| `shopfront_clone_watch_error` | A$0                | Per-step failure inside the Inngest function. Triggers Telegram page.                                                                                                                                                                                                                                                           |

No `feature_brakes.shopfront_clone_watch` row exists or is needed at MVP —
whoisds is free, the run produces A$0 marginal spend per execution.

---

## 4. Verification SQL queries

These are the operationally important pieces. Copy-paste against the
Supabase prod project (`rquomhcgnodxzkhokwni`) via `mcp__supabase__execute_sql`
or the dashboard SQL editor.

### Daily hit count + acceptance-gate floor check

The acceptance gate requires ≥3 daily hits (the "floor" — distinguishes
a tighter matcher from a silenced one) AND <30% FP rate.

```sql
-- Daily hit count + distinct brand-coverage over the last 7 days
SELECT date_trunc('day', first_seen_at) AS day,
       COUNT(*) AS hits,
       COUNT(DISTINCT inferred_target_domain) AS distinct_brands
FROM public.shopfront_clone_alerts
WHERE source='nrd' AND first_seen_at >= now() - interval '7 days'
GROUP BY 1
ORDER BY 1 DESC;
```

A day with `hits < 3` is a floor breach — investigate whether the matcher
silently over-tightened or whoisds dropped the zip. The FP-rate side of
the gate is eyeball-verified against the per-brand ledger below.

### Per-brand alert ledger (FP spot-check)

The right shape for the daily 5-minute eyeball pass — review each row
against your knowledge of the brand and flag obvious FPs (real businesses,
common-word collisions).

```sql
-- Per-brand alert ledger for FP spot-check
SELECT inferred_target_domain AS brand,
       candidate_domain,
       signals->0->>'signal_type' AS signal_type,
       signals->0->>'score' AS score,
       severity_tier,
       first_seen_at
FROM public.shopfront_clone_alerts
WHERE source='nrd'
ORDER BY inferred_target_domain, candidate_domain;
```

To narrow to a single day's run:

```sql
WHERE source='nrd' AND first_seen_at >= date_trunc('day', now())
```

### Telemetry — hits found vs rows inserted per run

UPSERT idempotency means `hits_found` (matcher output) is normally ≥
`rows_inserted` (rows actually new vs touching an existing
`(inferred_target_domain, url_hash)` row). A widening gap over multiple
days suggests the matcher is re-finding stable candidates from the same
brand-set; a narrowing gap suggests the underlying NRD universe is
churning faster.

```sql
SELECT created_at,
       metadata->>'hits_found' AS hits,
       metadata->>'rows_inserted' AS rows_inserted,
       metadata->>'brands_with_hits' AS brands_with_hits,
       metadata->>'duration_ms' AS duration_ms
FROM public.cost_telemetry
WHERE feature='shopfront_clone_watch'
ORDER BY created_at DESC
LIMIT 10;
```

### Error telemetry

If the Telegram digest didn't land or a step failed, this is the first
query.

```sql
SELECT created_at, metadata
FROM public.cost_telemetry
WHERE feature='shopfront_clone_watch_error'
ORDER BY created_at DESC
LIMIT 20;
```

---

## 5. Operator runbook

### Manual ad-hoc trigger

The event-trigger path (PR #402) is the cleanest way to fire an ad-hoc
run between cron ticks — for back-fills, post-fix verifications, or
demos. Bypasses the Inngest dashboard.

```bash
# 1. Pull INNGEST_EVENT_KEY from Vercel (one-shot, no persistence):
ENV_ID=$(curl -sS -H "Authorization: Bearer $VCTOKEN" \
  "https://api.vercel.com/v9/projects/prj_U3DtIAy2zEzrYrsXwUFCiZ2t54Bp/env?decrypt=false" \
  | python3 -c "import sys,json; [print(e['id']) for e in json.load(sys.stdin)['envs'] if e['key']=='INNGEST_EVENT_KEY' and 'production' in e['target']]")
KEY=$(curl -sS -H "Authorization: Bearer $VCTOKEN" \
  "https://api.vercel.com/v1/projects/prj_U3DtIAy2zEzrYrsXwUFCiZ2t54Bp/env/$ENV_ID" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['value'])")

# 2. Fire the manual-trigger event:
curl -X POST "https://inn.gs/e/$KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"shopfront/nrd.manual-trigger.v1","data":{"source":"ops-runbook"}}'
```

Alternative: Inngest dashboard → app `askarthur` → fn
`shopfront-nrd-daily-ingest` → "Invoke".

### Wipe rows + re-fire (post-matcher-change verification flow)

Used after shipping a matcher-side PR (#403, #408, future #409 v3) to
get a clean ledger.

```sql
-- Wipe (CAREFUL — drops the daily ledger for source='nrd' only)
DELETE FROM public.shopfront_clone_alerts WHERE source='nrd';
```

Then re-fire via the manual-trigger curl above. Wait ≤5 min for the
Inngest run to complete, then run the verification SQL in §4 to compute
the new hit count / FP rate.

This flow is safe at MVP because `source='nrd'` rows are reproducible
from yesterday's NRD zip + the current matcher. It is NOT safe once
Phase A's `source='corpus'` writes start because those rows have
historical provenance the corpus search no longer re-derives.

### Flag flip back to OFF

If the matcher misbehaves (FP rate breaches 30% on a single run, or the
public page shows defamation-risk language):

1. Set `FF_SHOPFRONT_CLONE_WATCH=false` in Vercel → Production. Vercel
   auto-redeploys.
2. Cron stops firing on the next 08:30 UTC tick. Today's rows remain on
   the page (the page reads the table, not the flag).
3. To blank the page, `DELETE FROM shopfront_clone_alerts WHERE
source='nrd'` after the flag is OFF.

### Pre-flip checklist for a matcher-change PR

Every PR that touches `packages/shopfront-glue/src/lexical-match.ts` must
walk through this before merge:

- [ ] `pnpm turbo build` + `pnpm --filter @askarthur/shopfront-glue test` green
- [ ] `/local-ultrareview <PR#>` clean
- [ ] Migration (if any) applied to prod via `mcp__supabase__apply_migration` + `mcp__supabase__get_advisors` no new ERRORs
- [ ] Vercel preview build green
- [ ] Post-merge: wipe `source='nrd'` rows + manual-trigger fire + verification SQL → FP <30% + hits ≥3 (the locked acceptance gate)

If the post-merge run fails the acceptance gate, the PR is rolled back
(revert + redeploy) before the next cron tick.

---

## 6. Acceptance gate (locked, v2 matcher onward)

Per ADR-0017 and the matcher evolution log in
`docs/plans/clone-watch-mvp.md`:

1. **FP rate <30%** on the daily NRD run (eyeball-verified against the
   per-brand ledger SQL in §4).
2. **Daily hit count ≥3** ("the floor"). A matcher that silences itself
   to 0 hits is a regression, not an improvement.

Any future matcher iteration that breaches either gate on the post-merge
verification run is rolled back. Both gates apply to every iteration —
v3, v4, etc.

---

## 7. Related

- [docs/plans/clone-watch-mvp.md](../plans/clone-watch-mvp.md) — the MVP build plan + matcher evolution log
- [docs/adr/0015-clone-detection-signal-model.md](../adr/0015-clone-detection-signal-model.md) — signal taxonomy + post-#408 substring-gating amendment
- [docs/adr/0016-clone-detection-source-layering.md](../adr/0016-clone-detection-source-layering.md) — Layer 0 source-layering decision + pull-forward amendment
- [docs/adr/0017-clone-detection-substring-gating.md](../adr/0017-clone-detection-substring-gating.md) — v2 matcher rationale: token list, ccTLD drop, why substring gated but not confusable/Levenshtein
- `packages/shopfront-glue/src/lexical-match.ts` — the matcher (`SCAM_CONTEXT_TOKENS` set, `hasScamContext` helper, `MIN_BRAND_LEN_FOR_LOOSE_SUBSTRING=5`)
- `packages/shopfront-glue/src/au-brand-watchlist.ts` — the ~50-entry static watchlist; opt-out happens by editing this file
- `packages/scam-engine/src/inngest/shopfront-nrd-daily-ingest.ts` — the Inngest function (cron `30 8 * * *` + `shopfront/nrd.manual-trigger.v1` event handler)
- `apps/web/app/clone-watch/page.tsx` — the public surface
- Issue [#409](https://github.com/matchmoments-admin/ask-arthur/issues/409) — v3 matcher: word-boundary check for `au` token
- BACKLOG.md #25 (flip `/clone-watch` to indexable after #371 v1 copy) + #26 (re-evaluate cross-surface dedupe with `brand_impersonation_alerts`)
