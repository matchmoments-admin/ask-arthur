---
severity: P2
title: "[P2] Negotiate Hive AI pricing contract + set PRICING.HIVE_AI_USD_PER_IMAGE"
labels: severity:p2, ready-for-human, domain:deepfake, commercial
action_type: commercial → code
estimated_time: contract dependent · 15 min code after
status: "RESOLVED (code) 2026-07-17 — commercial contract still open"
---

> **RESOLVED (code side) 2026-07-17** — `feat/hive-cost-wiring` (extension-monetisation PR 1).
> `PRICING.HIVE_AI_USD_PER_IMAGE` set to $0.003 (published self-serve rate; update on
> contract signing). Note the live telemetry tag is **`feature='hive_ai'`, `provider='hive'`**
> (already in prod since the original instrumentation), not the `facebook-ads-detection` /
> `hive-ai` names suggested below. The brake is wired into the `cost-daily-check` cron
> (`HIVE_AI_CAP_USD`, default $5/day) — not `scraper-brake-alert` — and `analyze-ad` now gates
> `checkHiveAI` on `isFeatureBraked("hive_ai")`. Remaining action is **commercial only**:
> confirm the contracted per-image rate and adjust the constant if it differs.

## Summary

The Facebook Marketplace ads detection feature uses Hive AI for image deepfake detection. `PRICING.HIVE_AI_USD_PER_IMAGE` is currently hardcoded as `0` because the commercial contract isn't signed. This silently disables the cost brake on the deepfake-detection path.

## Impact

- **Cost-brake bypass:** with `unitCostUsd: 0`, no logged cost → daily threshold alerts and `CHARITY_CHECK_CAP_USD`-style brakes won't fire even if Hive bills us per call.
- **Blocks flip:** `NEXT_PUBLIC_FF_FACEBOOK_ADS` is held at OFF until pricing is real (PR #222 ready-to-flip).
- **Forecast accuracy:** at scale, mis-priced Hive calls would show as $0 cost in the dashboards but real dollars on the invoice.

## Evidence

- `apps/web/lib/cost-telemetry.ts` — `PRICING.HIVE_AI_USD_PER_IMAGE = 0`
- `apps/web/app/api/extension/analyze-ad/route.ts:155` — call site that should log cost
- ROADMAP.md Phase 5 (line 133)

## Fix

1. **Commercial:** confirm contract value from Hive AI (per-image USD)
2. **Code:**
   - Update `PRICING.HIVE_AI_USD_PER_IMAGE` to the contracted value
   - Verify `logCost()` is called in `analyze-ad/route.ts:155` with the right `feature='facebook-ads-detection'`, `provider='hive-ai'`, `units=1`, `cost_usd=PRICING.HIVE_AI_USD_PER_IMAGE`
   - Add a row to `feature_brakes` for `facebook-ads-detection` with daily cap (recommend match REDDIT_INTEL: $10/day initially)
3. **Flip:** PR #222 ready-to-flip `NEXT_PUBLIC_FF_FACEBOOK_ADS` on Vercel preview, smoke-test, then prod

## Verification

- `cost_telemetry` rows appear with `feature='facebook-ads-detection'` after first real call
- `feature_brakes.facebook-ads-detection.daily_cap_usd` is set
- `scraper-brake-alert` cron (\*/15 min) would fire if cap exceeded

## Publish

```bash
gh issue create \
  --repo matchmoments-admin/ask-arthur \
  --title "[P2] Negotiate Hive AI pricing contract + set PRICING.HIVE_AI_USD_PER_IMAGE" \
  --label "severity:p2,ready-for-human,domain:deepfake" \
  --body-file 03-p2-hive-ai-pricing.md
```
