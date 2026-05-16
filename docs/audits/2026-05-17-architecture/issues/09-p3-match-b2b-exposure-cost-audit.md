---
severity: P3
title: "[P3] Audit match_b2b_exposure for cost-telemetry coverage"
labels: severity:p3, ready-for-agent, domain:cost-telemetry, investigation
action_type: investigation → possibly 1 PR
estimated_time: ~30 min audit · ~1 hour fix if gap confirmed
---

## Summary

While auditing the Voyage embedding flow (issue #05), I noticed that the B2B exposure search path likely also calls Voyage but I couldn't immediately confirm `logCost()` coverage. This is a quick investigation that may or may not produce a fix.

## Investigation steps

1. Locate the function:
   ```bash
   grep -rln "match_b2b_exposure\|b2bExposure" packages/scam-engine/ apps/web/lib/ apps/web/app/api/
   ```
2. Trace whether it calls `voyageEmbedRetry` or `rerank` directly, or whether it only calls a pre-computed-vector path
3. If Voyage is called, check whether `logCost({ feature: 'b2b-exposure-*', provider: 'voyage', ... })` is invoked on the same code path
4. Cross-reference: `SELECT feature, count(*) FROM cost_telemetry WHERE feature LIKE 'b2b-exposure%' GROUP BY 1` — if zero rows but the B2B exposure endpoint is hit in `usage_log`, that's the smoking gun

## If gap confirmed

Apply the same fix pattern as issue #05 — thread token counts back from the Voyage client, call `logCost()` per call. Ship as part of the same PR if both gaps are open at the same time (preferred — bundle related work, per established team norm).

## If no gap (no Voyage in this path)

Close this issue with a short comment explaining the trace.

## Publish

```bash
gh issue create \
  --repo matchmoments-admin/ask-arthur \
  --title "[P3] Audit match_b2b_exposure for cost-telemetry coverage" \
  --label "severity:p3,ready-for-agent,domain:cost-telemetry" \
  --body-file 09-p3-match-b2b-exposure-cost-audit.md
```
