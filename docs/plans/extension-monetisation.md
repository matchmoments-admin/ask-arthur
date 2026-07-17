# Extension Monetisation & Image-Check — Plan

**Status:** in progress — PR 1 (Hive cost wiring) shipping first. All new surfaces default-OFF.
**Owner docs:** ops config pages land per-PR (`docs/ops/extension-image-check-config.md`, `docs/ops/extension-billing-config.md`).

## Why

The Chrome extension is live on the Chrome Web Store but **unlisted** (testing). Its
Facebook celebrity-deepfake pipeline is fully built but dark (Hive pricing contract),
its subscription plumbing (`get_extension_tier` RPC, `isPro()`) is dead code in the UI,
and it has no test infrastructure. This plan turns it into a monetised product that
complements the platform:

1. **Right-click "Check this image"** — user-driven AI-generated/deepfake detection on
   any image, reusing the existing Hive detector (`packages/scam-engine/src/hive-ai.ts`).
   Every check feeds `deepfake_detections` → the existing B2B `/api/v1/deepfakes`
   surface and LinkedIn data-drop content (consumer checks generate sellable intel —
   same flywheel shape as clone-watch).
2. **Extension Pro** — A$4.99/mo, A$49/yr, Stripe. Free: 50 checks/day + 3 image
   checks/day. Pro: 500/day, 30 image checks/day, URL Guard, email scanning (the
   already-built dark features become the Pro bundle).
3. **Cost safety** — Hive brake (`hive_ai` / `HIVE_AI_CAP_USD`) closing audit issue
   03-p2; per-install tiered caps.
4. **Regression safety** — vitest+jsdom in `apps/extension` with sanitised Facebook
   HTML fixtures closing audit issue 04-p2.

## Honesty guardrails (product rule)

Image-check results always present **confidence** ("87% likely AI-generated"), never a
binary FAKE/REAL verdict. "Distorted/photoshopped real photo" detection (manipulation
localisation) is out of scope — no vendor does it reliably; v1 is AI-generation +
deepfake classification only. `data:`/`blob:` URLs get a friendly "can't check this
image" (byte-upload is a follow-up).

## PR sequence

| PR  | Branch                              | Scope                                                                                                                                                              | Status    |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| 1   | `feat/hive-cost-wiring`             | `PRICING.HIVE_AI_USD_PER_IMAGE` ($0.003 working rate), real unit cost in analyze-ad, `isFeatureBraked("hive_ai")` gate, `HIVE_AI_CAP_USD` ($5) in cost-daily-check | in review |
| 2   | `feat/extension-test-infra`         | vitest+jsdom in apps/extension, Facebook HTML fixtures, ad-detector + marketplace tests                                                                            | pending   |
| 3   | `feat/extension-analyze-image-api`  | `/api/extension/analyze-image` (flag `NEXT_PUBLIC_FF_IMAGE_CHECK`, sub-flag `FF_IMAGE_CHECK_VISION`), SSRF-guarded, tiered caps via `imageChecksPerDay`            | pending   |
| 4   | `feat/extension-image-check-ui`     | context menu (`contexts:["image"]`), in-page shadow-DOM result card, popup fallback, `WXT_IMAGE_CHECK`, manifest 1.1.0                                             | pending   |
| 5   | `feat/extension-account-link`       | migration v238 (stripe cols + user_id + RLS on extension_subscriptions), signed link-token flow, `/extension/link` page, `NEXT_PUBLIC_FF_EXTENSION_BILLING`        | pending   |
| 6   | `feat/extension-stripe-checkout`    | `extensionSkus.ts`, `/api/extension/checkout`, webhook `extension_pro` branch with ownership gates, plan card                                                      | pending   |
| 7   | `feat/extension-tier-limits`        | tier-aware rate limits in `_lib/auth.ts`, MoreTab real tier, 429 CTA → `/extension/link`                                                                           | pending   |
| 8   | `chore/extension-monetisation-docs` | system-map sweep, ROADMAP/BACKLOG, runbook into pending-manual-setup                                                                                               | pending   |

Full design detail (routes, schemas, attack analysis for the link flow, test matrices)
was reviewed at planning time; per-PR specifics live in each PR description.

## Flags & env introduced

| Name                                                   | Kind                                              | Default | Introduced |
| ------------------------------------------------------ | ------------------------------------------------- | ------- | ---------- |
| `HIVE_AI_CAP_USD`                                      | server env (cost cap)                             | `5`     | PR 1       |
| `NEXT_PUBLIC_FF_IMAGE_CHECK`                           | server flag (route gate)                          | OFF     | PR 3       |
| `FF_IMAGE_CHECK_VISION`                                | server-only sub-flag (Claude vision context pass) | OFF     | PR 3       |
| `WXT_IMAGE_CHECK`                                      | extension build flag                              | OFF     | PR 4       |
| `NEXT_PUBLIC_FF_EXTENSION_BILLING`                     | server flag                                       | OFF     | PR 5       |
| `WXT_EXTENSION_BILLING`                                | extension build flag                              | OFF     | PR 5       |
| `NEXT_PUBLIC_STRIPE_EXTENSION_PRO_MONTHLY` / `_ANNUAL` | Stripe price ids                                  | unset   | PR 6       |

## Activation runbook (operator)

**Phase A — Hive + Facebook ads (after PRs 1–2):** close Hive pricing contract (adjust
`HIVE_AI_USD_PER_IMAGE` if ≠ $0.003); confirm `HIVE_API_KEY` in Vercel; flip
`NEXT_PUBLIC_FF_FACEBOOK_ADS=true` preview → prod; watch `/admin/costs` for non-zero
`hive_ai` rows.

**Phase B — Image check (after PRs 3–4):** `NEXT_PUBLIC_FF_IMAGE_CHECK=true`; build
with `WXT_IMAGE_CHECK=true` as v1.1.0 (`pnpm --filter @askarthur/extension zip`);
upload to the existing unlisted CWS listing (`scripting` permission may trigger
re-review); update listing copy. Leave `FF_IMAGE_CHECK_VISION` off for Hive-only v1.

**Phase C — Billing (after PRs 5–7, v238 applied + advisors clean):** create Stripe
product "Ask Arthur Extension Pro" (A$4.99/mo, A$49/yr AUD); price IDs → Vercel; flip
`NEXT_PUBLIC_FF_EXTENSION_BILLING=true` preview → test-mode e2e (link → checkout →
webhook → MoreTab Pro → 500/day) → prod; rebuild with `WXT_EXTENSION_BILLING=true`.
Monitor week 1: cost-daily-check Telegram, `feature_brakes` empty,
`extension_subscriptions` rows sane.
