# Image-Check v2 — Evidence & Explainability

**Status:** in progress. Follows the extension-monetisation wave (#782–#789); everything
rides the existing `NEXT_PUBLIC_FF_IMAGE_CHECK` / `WXT_IMAGE_CHECK` double gate and stays
dark until Phase B activation.

## Why

A bare "likely AI" score is weak product feedback — anyone's eyes produce a guess. The
value is the **why** (vision context), the **who** (generator attribution), and the
**so-what** (evidence a user, government agency, or law-enforcement officer can act on).
This wave makes the right-click image check explainable and evidence-grade, aligned with
the NSW-police-pilot direction (ReportCyber/eSafety routing constants already live in
`apps/web/lib/onward/destinations.ts`).

## Decisions (user-confirmed)

- **Vision context pass launches ON** (`FF_IMAGE_CHECK_VISION` flips with Phase B) — the
  card explains what the image appears to show, not just a score.
- **Evidence records: metadata only, flagged checks only, never image bytes**
  (ADR-0022; the ADR-0010 "images discarded" promise holds for bytes — we keep a
  SHA-256 so a third party holding the image can corroborate it).
- **C2PA presence detection only** (dependency-free byte sniff); full cryptographic
  validation via c2pa-node is a BACKLOG follow-up.
- Check refs are `IC-` + 12 Crockford-base32 chars (~60 bits) — LE-grade unguessability.

## PR sequence

| PR  | Branch                                 | Scope                                                                                                         | Status    |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | `feat/image-check-generator-breakdown` | Hive raw class retention (cache prefix → v2), top-3 `generatorBreakdown` in response + card, Google Lens link | in review |
| 2   | `feat/image-check-vision-cost-brake`   | `EXTENSION_IMAGE_CHECK_CAP_USD` ($5) 13th brake; vision Claude call gated on `isFeatureBraked`                | pending   |
| 3   | `feat/image-check-c2pa-detect`         | Dependency-free `detectC2PA` (JPEG APP11/JUMBF, PNG caBX, WebP C2PA); `fetchImageBytes` w/ sha256             | pending   |
| 4   | `feat/image-check-evidence-records`    | ADR-0022 + migration v239 `image_check_records` (+archive); `FF_IMAGE_CHECK_RECORDS`; `checkRef` in response  | pending   |
| 5   | `feat/image-check-evidence-report`     | Public `/image-check/[ref]` page + one-page evidence PDF (react-pdf, sync-in-route)                           | pending   |
| 6   | `feat/v1-image-checks-api`             | `GET /api/v1/image-checks` (guardV1) B2B/LE feed + openapi + docs sweep                                       | pending   |

## Flags & env introduced

| Name                            | Kind                           | Default | PR  |
| ------------------------------- | ------------------------------ | ------- | --- |
| `EXTENSION_IMAGE_CHECK_CAP_USD` | server env (cost cap)          | `5`     | 2   |
| `FF_IMAGE_CHECK_RECORDS`        | server-only flag (persistence) | OFF     | 4   |

## Activation-runbook delta (replaces extension-monetisation "Phase B")

1. Pre-flight: PR 2 merged; no stale `extension_image_check` row in `feature_brakes`.
2. Flip `NEXT_PUBLIC_FF_IMAGE_CHECK=true` **and** `FF_IMAGE_CHECK_VISION=true` together
   (worst-case vendor spend $10/day = $5 Hive + $5 Claude, both braked).
3. Ship/refresh the `WXT_IMAGE_CHECK=true` extension build (card: breakdown + context +
   C2PA + Lens).
4. `FF_IMAGE_CHECK_RECORDS=true` separately, only after v239 applied + advisors clean —
   activates persistence, `checkRef`, the evidence page/PDF, and `/api/v1/image-checks`.
   Can lag vision by days with no user-visible breakage.
5. Rollback levers, most-specific first: records flag → vision flag → route flag.

## Explicitly out of scope

Full C2PA cryptographic validation (BACKLOG); storing image bytes/screenshots
(`image_sha256` only, per ADR-0022); LE portal / authed search over records; video
checks; byte upload for `data:` images; reverse-image beyond the Lens link-out.
