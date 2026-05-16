---
severity: P2
title: "[P2] Capture Facebook-feed HTML fixtures + regression tests for analyze-ad"
labels: severity:p2, ready-for-agent, domain:extension, testing
action_type: code
estimated_time: ~1 day
---

## Summary

The Facebook Marketplace scam-detection feature in the extension (v1.0.1) relies on DOM selectors against Facebook's feed and marketplace HTML. Facebook restructures these layouts ~monthly, and our selectors break silently — the extension stops finding ads to analyze but never throws.

No regression tests against captured real HTML fixtures exist. We'd discover breakage only via cost-telemetry going to zero and/or user reports.

## Impact

- **Silent feature degradation:** Facebook DOM change → no ads detected → no badge injection → no `/api/extension/analyze-ad` calls → users believe extension is working
- **Blocks confident flip:** can't confidently flip `NEXT_PUBLIC_FF_FACEBOOK_ADS` to ON without a check-the-extension-still-works signal
- **Compounds Hive AI pricing concern** (issue #03)

## Fix

1. **Capture fixtures** (per ad type):
   - Marketplace listing page (logged in + logged out variants)
   - Facebook feed sponsored post
   - Reels sponsored
   - Stories sponsored
   - Save as `apps/extension/test/fixtures/facebook/{type}-2026-05.html` with a date suffix

2. **Add fixture-based unit tests** in `apps/extension/test/` (Vitest):
   - For each fixture, assert: selector finds N ad nodes (N>0), extracts expected fields, doesn't crash on missing optional fields
   - Run as part of `pnpm --filter @askarthur/extension test`

3. **Add CI step** in `.github/workflows/ci.yml` to run extension tests on push and PR

4. **Add a re-capture playbook** to `docs/ops/extension-fixture-refresh.md`:
   - How to capture HTML safely (browser dev tools, scrub login state)
   - Cadence: quarterly + after any Facebook UI announcement
   - Where to commit

5. **Optional follow-up:** Playwright smoke test that loads a stored fixture and runs the actual extension content-script against it.

## Verification

- `pnpm --filter @askarthur/extension test` passes
- CI runs the new tests on next push
- Selectors documented in `apps/extension/src/content/facebook-detectors.ts` reference fixture filenames

## Publish

```bash
gh issue create \
  --repo matchmoments-admin/ask-arthur \
  --title "[P2] Capture Facebook-feed HTML fixtures + regression tests for analyze-ad" \
  --label "severity:p2,ready-for-agent,domain:extension,testing" \
  --body-file 04-p2-extension-fb-regression.md
```
