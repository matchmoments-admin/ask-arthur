# Shop Signal — dual call-sites at Stage 0

**Status:** accepted (2026-05-20) · **partially reversed** (2026-06-14, #588 / PR #591)

Stage 0 of Shop Signal ships a pure-Module detector
(`packages/scam-engine/src/shop-signal.ts`) called from **two places** —
`packages/scam-engine/src/analyze-core.ts` (the canonical core path) and
`apps/web/app/api/analyze/route.ts` (the web-app route handler).

**Update (#588):** the duplicated _logic_ — the
`featureFlags.shopSignal && detectCommerceSignal(...)` → `buildShopSignal(...)`
branch — is now a single helper, `applyShopSignal(result, text, urls,
referrerSource?)`, exported from `shop-signal.ts`. Both call sites delegate to
it. This is the genuine anti-drift fix (see Consequences); what remains
duplicated is only the _surrounding plumbing_, which still awaits the Phase 5
`buildAnalyze(variant, deps)` factory (see Reversal trigger).

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

Originally (2026-05-20): keep two parallel
`featureFlags.shopSignal && detectCommerceSignal(...)` blocks reading the same
pure Module, each carrying a `DUAL CALL-SITE:` cross-reference comment so drift
is at least loud.

Revised (2026-06-14): extract the shared branch into one `applyShopSignal()`
helper that both call sites invoke. The helper's signature makes both
historically-realised drifts (F1, F2 below) **structurally impossible** rather
than relying on mirror-edit discipline:

- it **mutates `result.shopSignal` in place** (returns `void`), so the value can
  never be left off a persistence/event path again (kills F1);
- it derives commerce flags from `result.redFlags` and **requires** the caller
  to pass the URL list — which must be the post-redirect set
  (`urlsToCheck` / `allUrls`) — so the redirect case is detected on every
  surface (kills F2).

The mirror-edit discipline + cross-reference comments are no longer the
mitigation; the type signature is.

## Consequences

**Drift risk was real and realised once before the helper existed.** PR #329
(commit `1a16db2`) fixed two divergences between the then-duplicated blocks;
`applyShopSignal` now prevents both by construction:

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

Residual duplication after #588: only the _surrounding plumbing_ (the route's
auth / rate-limit / idempotency / charity-intent / phone-enrichment / response
shaping vs the core's background fan-out). That is genuinely surface-specific
and is what the Phase 5 factory will consolidate — not the shop-signal logic,
which is now shared.

## Reversal trigger

Partially met (#588): the shop-signal _logic_ is now a single helper.

Fully met when the Phase 5 `buildAnalyze(variant, deps)` factory ships and the
web route delegates to `runAnalysisCore` outright — at which point the second
`applyShopSignal` call site disappears and this ADR is **superseded** by
whatever ADR captures the factory shape.

## Related

- `packages/scam-engine/src/shop-signal.ts` (`applyShopSignal` — the shared helper)
- `packages/scam-engine/src/analyze-core.ts` (call site)
- `apps/web/app/api/analyze/route.ts` (call site)
- PR #329, commit `1a16db2` (fixed F1 + F2 drift); #588 / PR #591 (extracted the helper)
- Plan: [`docs/plans/shop-guard-v2.md`](../plans/shop-guard-v2.md)
