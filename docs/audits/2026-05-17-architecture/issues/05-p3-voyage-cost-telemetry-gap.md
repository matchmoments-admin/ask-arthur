---
severity: P3
title: "[P3] Add logCost() to getSimilarReports + getRelevantThemes (Voyage gap)"
labels: severity:p3, ready-for-agent, domain:cost-telemetry
action_type: code · single PR
estimated_time: ~1 hour
---

## Summary

Two retrieval-side modules call Voyage embeddings (and one rerank) but don't emit `cost_telemetry` rows. This makes a small but real slice of daily AI spend invisible to the cost dashboard at `/admin/costs` and to the `scraper-brake-alert` cron.

## Affected files

| File                                                    | Voyage calls missing telemetry                            | Est. cost/day                                    |
| ------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------ |
| `packages/scam-engine/src/retrieval/similar-reports.ts` | `embedQuery` (query vector) + `rerank-2.5-lite` on top-50 | ~$0.0002/call × ~500 calls/day = ~$0.10/day      |
| `packages/scam-engine/src/retrieval/themes.ts`          | `embedQuery` (decorative theme matching)                  | ~$0.000003/call × ~5,000 calls/day = ~$0.015/day |

Total invisible spend: ~$0.115/day. Small absolute number today, but the **wrong shape**: any retrieval-traffic spike (B2B onboarding wave, viral consumer event) would never hit the brake.

## Fix

Standard pattern — match the shape used by other retrievers (e.g. `scam-report-embed`):

```typescript
// Before
const queryVec = await voyageEmbedRetry({ input: text, model: "voyage-3.5" });

// After
const { embedding: queryVec, tokens } = await voyageEmbedRetry({
  input: text,
  model: "voyage-3.5",
});
await logCost({
  feature: "similar-reports-retrieval", // or 'themes-retrieval'
  provider: "voyage",
  operation: "embed-query",
  units: tokens,
  cost_usd: tokens * (0.06 / 1_000_000),
});
```

For `getSimilarReports`, also wrap the rerank call with `feature='similar-reports-rerank'`, `operation='rerank'`, pricing `0.02 / 1_000_000`.

Ensure `voyageEmbedRetry` (in `packages/scam-engine/src/voyage/client.ts` or similar) returns token counts. If it doesn't already, thread them back from the Voyage SDK response.

## Optional: also fix `match_b2b_exposure`

See issue #09 — needs separate audit to confirm coverage.

## Verification

```sql
-- Run after PR ships and traffic hits the surface
SELECT feature, count(*), sum(cost_usd)
FROM cost_telemetry
WHERE feature IN ('similar-reports-retrieval','similar-reports-rerank','themes-retrieval')
  AND created_at > now() - interval '1 day';
-- Should be non-zero within a day of merge.
```

Also verify `/admin/costs` dashboard now shows these features in the per-feature breakdown.

## Publish

```bash
gh issue create \
  --repo matchmoments-admin/ask-arthur \
  --title "[P3] Add logCost() to getSimilarReports + getRelevantThemes (Voyage gap)" \
  --label "severity:p3,ready-for-agent,domain:cost-telemetry" \
  --body-file 05-p3-voyage-cost-telemetry-gap.md
```
