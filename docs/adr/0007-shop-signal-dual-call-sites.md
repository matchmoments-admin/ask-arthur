# Shop Signal — dual call-sites at Stage 0

**Status:** accepted (2026-05-20)

Stage 0 of Shop Signal ships a pure-Module detector
(`packages/scam-engine/src/shop-signal.ts`) but the `detectCommerceSignal`
call site lives in **two places** — `packages/scam-engine/src/analyze-core.ts:235`
(the canonical core path) and `apps/web/app/api/analyze/route.ts:321`
(the web-app route handler). We accept the duplication for Stage 0 and
will collapse it in Phase 5.

## Context

The web `/api/analyze` route and the engine's `runAnalysisCore` have
structurally different surrounding plumbing — charity-intent detection,
phone intelligence, redirect resolution, image-OCR pre-scan,
cost-telemetry tagging, idempotency-key wiring — and the route handler
predates `runAnalysisCore`'s extraction by a long time. Consolidating
the two call paths into a single delegation requires the Phase 5
`buildAnalyze(variant, deps)` factory which is meaningfully larger work
than Stage 0's "ship-fast and measure" target allows.

## Decision

Keep two parallel `featureFlags.shopSignal && detectCommerceSignal(...)`
blocks. Both branches read the same pure Module (`shop-signal.ts`) — only
the surrounding plumbing differs. Each block carries a `DUAL CALL-SITE:`
cross-reference comment naming its sibling so future drift is at least
loud.

## Consequences

**Drift risk is real and has already realised once.** PR #329 (commit
`1a16db2`) fixed two divergences between the call sites:

- F1 — the route handler built `shopSignal` as a **local variable** and
  attached it only to the JSON response body, never mutating `aiResult`.
  `storeScamReport({ analysis: aiResult, ... })` and the
  `analyze.completed.v1` Inngest event therefore both persisted
  `analysis_result` without the `shopSignal` field, while the
  `runAnalysisCore` path correctly mutated `result.shopSignal`. The
  measurement queries would have returned zero rows. Fix mirrors the
  core: mutate `aiResult.shopSignal` so the value threads through both
  persistence paths.
- F2 — the URL-list input passed into `detectCommerceSignal` differed.
  `runAnalysisCore` used `urlsToCheck` (post-redirect resolution +
  dedup); the route handler used `urls` (pre-redirect only). Real
  divergence: a `bit.ly → .shop` redirect chain triggered commerce
  detection on bot/extension but not on web. Fix: route handler now
  uses `allUrls` (post-redirect equivalent).

Mitigation: mandatory mirror-edit discipline + the cross-reference
comments above. Future drift is likely; the ADR exists so the next
diff that touches either branch sees the explicit warning.

## Reversal trigger

When the Phase 5 `buildAnalyze(variant, deps)` factory ships, both
call-sites become a single delegation to the factory output and this
ADR is **superseded** by whatever ADR captures the factory shape.

## Related

- `packages/scam-engine/src/analyze-core.ts:235`
- `apps/web/app/api/analyze/route.ts:321`
- PR #329, commit `1a16db2` (fixed F1 + F2 drift)
- Plan: [`docs/plans/shop-guard-v2.md`](../plans/shop-guard-v2.md)
