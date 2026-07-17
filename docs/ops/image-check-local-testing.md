# Image check — local testing runbook

End-to-end local verification of the right-click image check + evidence layer
(image-check v2, PRs #790–#795) and the extension billing loop
(extension-monetisation, #782–#789) **before** any production flag flip.

Related: [extension-image-check-config.md](./extension-image-check-config.md) ·
[extension-billing-config.md](./extension-billing-config.md) ·
[docs/plans/image-check-v2.md](../plans/image-check-v2.md)

---

## 0. What you need

| Thing                         | Needed for                                                                                      | Notes                                                                                                                                                                                                                                                     |
| ----------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Upstash Redis** (free tier) | **Required** for the link-token flow (503s without it); also Hive cache, tier cache, image caps | Signature verification + rate limits degrade gracefully without it; billing does not                                                                                                                                                                      |
| **`HIVE_API_KEY`**            | Real verdicts                                                                                   | Self-serve trial at thehive.ai. **Without it every check returns `checked:false` / `scan_unavailable`** — UX and caps still testable, but nothing FLAGS, so no records/evidence page. Use `seed:image-check` (§4) to test the evidence surface without it |
| `ANTHROPIC_API_KEY`           | Vision context pass                                                                             | Already in use elsewhere                                                                                                                                                                                                                                  |
| Supabase                      | v238 + v239 are already applied to **prod**                                                     | Simplest: point `.env.local` at prod — the new tables are empty and seeded rows are deletable. Cleaner: a Supabase preview branch                                                                                                                         |
| Turnstile                     | Registration                                                                                    | **Nothing to do** — `verifyTurnstileToken` fail-opens in dev when `TURNSTILE_SECRET_KEY` is unset (it hard-fails in prod)                                                                                                                                 |
| Stripe **test mode**          | Billing loop only                                                                               | Test product + 2 prices + `stripe listen`                                                                                                                                                                                                                 |

## 1. `apps/web/.env.local`

```bash
NEXT_PUBLIC_FF_IMAGE_CHECK=true
FF_IMAGE_CHECK_VISION=true       # vision launches ON in this wave
FF_IMAGE_CHECK_RECORDS=true      # evidence records + page + PDF + v1 feed
NEXT_PUBLIC_FF_EXTENSION_BILLING=true

HIVE_API_KEY=...
ANTHROPIC_API_KEY=...
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
SUPABASE_URL=...                 # or NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY=...

# Billing loop only:
NEXT_PUBLIC_STRIPE_EXTENSION_PRO_MONTHLY=price_test_...
NEXT_PUBLIC_STRIPE_EXTENSION_PRO_ANNUAL=price_test_...
STRIPE_WEBHOOK_SECRET=whsec_...  # printed by `stripe listen`
```

## 2. Test suites (30 seconds, no keys needed)

```bash
pnpm --filter @askarthur/web test
pnpm --filter @askarthur/extension test
pnpm --filter @askarthur/scam-engine test
```

## 3. Server path without Chrome ← **start here**

Every `/api/extension/*` route is ECDSA-signed, so plain curl can't reach
them. `ext:dev` mirrors the extension's identity + signing (it is the same
canonical string as `src/lib/sign.ts`) and auto-registers on first run:

```bash
pnpm --filter @askarthur/web dev            # terminal 1

pnpm --filter @askarthur/web ext:dev POST /api/extension/analyze-image \
  '{"imageUrl":"https://upload.wikimedia.org/…/some-image.jpg","pageUrl":"https://example.com"}'
```

Expect `checked:true` plus `aiGenerated` / `deepfake` confidences,
`generatorBreakdown`, `contentCredentials`, `context.summary`, and — when the
check FLAGS — a `checkRef`. The identity persists in
`apps/web/.dev-extension-identity.json` (gitignored); delete it to simulate a
fresh install.

Useful checks:

```bash
# 4th call in a UTC day → 429 image_limit_reached (free tier = 3/day)
# link token (needs Redis + billing flag):
pnpm --filter @askarthur/web ext:dev POST /api/extension/link-token '{}'
# tier + limits:
pnpm --filter @askarthur/web ext:dev GET /api/extension/subscription
```

**Test images:** a fresh DALL·E output is the best **C2PA-present** case
(OpenAI embeds Content Credentials); any r/midjourney image exercises
generator attribution. A normal photo should come back low-confidence — a
good honesty check.

## 4. Evidence page + PDF (works with no Hive key)

```bash
pnpm --filter @askarthur/web seed:image-check
# → prints the ref + both URLs; --clean removes seeded rows
```

Open the printed `/image-check/IC-…` page, download the PDF, and confirm the
ReportCyber / eSafety links.

> **Expected quirk:** an unknown/malformed ref renders the not-found page but
> with HTTP **200**, not 404 — `notFound()` fires after streaming starts, so
> the status is already sent. Pre-existing and app-wide (`/charity-check` and
> `/scam-feed` do the same); the _body_ is identical in every not-found case,
> so nothing leaks. The PDF route does return a real 404. Then the B2B feed (create a key at `/app/keys`):

```bash
curl -H "Authorization: Bearer ak_live_…" localhost:3000/api/v1/image-checks | jq
# must NOT contain install_id_hash or hive_result
```

## 5. Extension in Chrome (the card UI)

The manifest only grants host permission for its configured base, so a build
must be pointed at your dev server — one knob:

```bash
WXT_IMAGE_CHECK=true \
WXT_EXTENSION_BILLING=true \
WXT_WEB_APP_BASE=http://localhost:3000 \
pnpm --filter @askarthur/extension build
```

The build prints a `⚠️ DEV BUILD` banner and names the extension
**"Ask Arthur — Scam Detector (dev)"** so it can't be confused with a store
build. Load `apps/extension/dist/chrome-mv3` via `chrome://extensions` →
Developer mode → Load unpacked.

Then: right-click any image → **Check this image with Ask Arthur** → pending
card → result card with confidences, "Midjourney — 62%" attribution lines,
context sentence, Content Credentials line, Google Lens link, and (when
flagged) `Evidence ref: IC-…` + **View evidence report**.

Also worth exercising:

- **Popup fallback** — right-click an image on a page injection is blocked on
  (e.g. the Chrome Web Store) → falls back to the popup instead of dying.
- **`data:` image** → friendly "can't check this image", no API call.
- **Billing** — More → Link account → link page → log in → plan card →
  checkout with `4242 4242 4242 4242` → `stripe listen --forward-to
localhost:3000/api/stripe/webhook` forwards it → MoreTab flips to **Pro**;
  image cap becomes 30/day within 5 min (tier cache TTL).

## 6. Brakes (prove the spend ceilings)

```sql
-- vision pauses, Hive verdict survives:
insert into feature_brakes (feature, paused_until, reason, set_by)
values ('extension_image_check', now() + interval '1 hour', 'local test', 'manual');
-- → next check: context: null, contentCredentials still populated

-- whole check pauses:
update feature_brakes set feature = 'hive_ai' where feature = 'extension_image_check';
-- → 503 feature_paused

delete from feature_brakes where feature in ('hive_ai','extension_image_check');
```

## 7. Before flipping prod

Local can't cover Chrome Web Store review, real Facebook feed scanning
(separate flag + logged-in session), or Vercel env quirks. Per the
registrant-intel activation lessons (sensitive vars reading back as `""`,
ignored-build-step gotchas), **rehearse on a Vercel preview** with the same
override before prod:

```bash
EXT_DEV_BASE=https://<preview>.vercel.app pnpm --filter @askarthur/web ext:dev POST /api/extension/analyze-image '{"imageUrl":"…"}'
WXT_WEB_APP_BASE=https://<preview>.vercel.app WXT_IMAGE_CHECK=true pnpm --filter @askarthur/extension build
```

Then confirm a `cost_telemetry` row exists (`feature='hive_ai'`,
`metadata->>'surface'='image_check'`) with non-zero cost, and that
`feature_brakes` is empty.

## Cleanup

```bash
pnpm --filter @askarthur/web seed:image-check --clean
rm apps/web/.dev-extension-identity.json
delete from image_check_records where install_id_hash = 'seed-local-dev';
```
