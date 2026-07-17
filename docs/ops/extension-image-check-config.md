# Extension image check — ops config

Right-click "Check this image" (extension-monetisation W1). Server route:
`apps/web/app/api/extension/analyze-image/route.ts`. Client side ships in the
`WXT_IMAGE_CHECK` build (PR 4). Plan: `docs/plans/extension-monetisation.md`.

## Flags & env

| Name                            | Where                               | Default | Meaning                                                                                                                                                                                                                                              |
| ------------------------------- | ----------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_FF_IMAGE_CHECK`    | Vercel                              | OFF     | Route gate. When off the route 503s even for validly-signed requests (double-gate, same rationale as `NEXT_PUBLIC_FF_FACEBOOK_ADS`).                                                                                                                 |
| `WXT_IMAGE_CHECK`               | extension build                     | OFF     | Bundles the context-menu item + result card and adds the `scripting` permission. Both flags must be on for the feature to exist.                                                                                                                     |
| `FF_IMAGE_CHECK_VISION`         | Vercel (server-only, `readBoolEnv`) | OFF     | Claude Haiku vision context pass per check (what's depicted, impersonated brand → celebrity match → `deepfake_detections`). Adds Claude spend + a server-side image-byte fetch. image-check v2: **launches ON** (see the plan's activation runbook). |
| `HIVE_API_KEY`                  | Vercel                              | —       | Without it `checkHiveAI` returns null and responses are `checked:false, reason:"scan_unavailable"`.                                                                                                                                                  |
| `HIVE_AI_CAP_USD`               | Vercel                              | `5`     | Shared daily vendor brake (`feature_brakes.hive_ai`, set by cost-daily-check). Covers BOTH analyze-ad and image-check Hive calls.                                                                                                                    |
| `FF_IMAGE_CHECK_RECORDS`        | Vercel (server-only, `readBoolEnv`) | OFF     | Persist FLAGGED checks as metadata-only evidence records (ADR-0022) + return `checkRef` + serve `/image-check/[ref]` page & PDF + populate `/api/v1/image-checks`. Independent of the route flag.                                                    |
| `EXTENSION_IMAGE_CHECK_CAP_USD` | Vercel                              | `5`     | Daily cap on the Claude-vision context pass (`feature_brakes.extension_image_check`). Braking pauses ONLY the Claude call — the Hive verdict and the free byte fetch (C2PA/sha256, image-check v2) keep running.                                     |

## Caps & cost

- Per-install daily cap from `EXTENSION_TIER_LIMITS[tier].imageChecksPerDay`
  (`packages/types/src/billing.ts`): **free 3/day, pro 30/day**. Redis key
  `askarthur:ext:imgcheck:{sha256(installId)}:{YYYY-MM-DD}`, 48h TTL
  (`_lib/image-rate-limit.ts`). Tier resolves via `get_extension_tier`,
  fail-open to free.
- Hive spend: `cost_telemetry WHERE feature='hive_ai' AND
metadata->>'surface'='image_check'`, unit cost
  `PRICING.HIVE_AI_USD_PER_IMAGE`. Vision spend (when on):
  `feature='extension_image_check', provider='anthropic'`.
- Brake behaviour: `feature_brakes.hive_ai` engaged → route returns 503
  `feature_paused` **before** calling Hive.

## Security model

- Anybody-URL input, so SSRF defence is `assertSafeURL`
  (private-IP/metadata-host blocklist) + http(s)-scheme check → 422; NOT the
  Facebook-CDN allowlist analyze-ad uses. `data:`/`blob:` URLs are rejected
  with friendly copy (byte-upload is a tracked follow-up).
- Hive fetches the image URL from its own infra. Our servers only fetch image
  bytes when `FF_IMAGE_CHECK_VISION` is on — that fetch uses
  `ssrfSafeDispatcher` (DNS-rebinding defence), `redirect: "error"`, a 5MB
  cap, and magic-byte validation.
- Standard extension auth: per-install ECDSA signature via
  `validateExtensionRequest` (burst + daily limits) before any paid work.

## Honesty guardrails (product rule)

Responses carry confidences (`aiGenerated.confidence`, `deepfake.confidence`)
and a probabilistic disclaimer — never a binary FAKE/REAL verdict. UI copy
must render percentages ("87% likely AI-generated"). `checked:false` means
the scan didn't run, which is different from low confidence.

## Smoke test (preview)

1. Set `NEXT_PUBLIC_FF_IMAGE_CHECK=true` + `HIVE_API_KEY` on the preview env.
2. Signed POST to `/api/extension/analyze-image` with a known public image
   URL (use the extension-signature test harness pattern to sign).
3. Expect 200 with `checked:true`, confidences, `imageChecksRemaining: 2`
   (free tier), and a `cost_telemetry` row tagged
   `hive_ai / surface=image_check` with non-zero cost.
4. Fourth call the same UTC day → 429 `image_limit_reached` with upgrade copy.
5. With `FF_IMAGE_CHECK_VISION=true`: response also carries `context.summary`,
   `generatorBreakdown`, and `contentCredentials` (non-null when bytes fetched).
6. With `FF_IMAGE_CHECK_RECORDS=true` and a FLAGGED image: response carries
   `checkRef`; `image_check_records` has the row (hashed install id, no byte
   columns); `/image-check/{ref}` renders; the PDF downloads; the record
   appears in `/api/v1/image-checks` (API key required).
