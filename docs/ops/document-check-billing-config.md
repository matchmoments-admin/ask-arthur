# Document Check billing — ops config

Self-serve Stripe plans for the Document Check B2B API (Stage 3, item 3 of
the document-check plan). Code shipped dark; nothing charges until the
operator steps below run.

## Plans

| Plan          | Price (AUD, GST-inc) | Allowance                     | Stripe price env var                           |
| ------------- | -------------------- | ----------------------------- | ---------------------------------------------- |
| `doc_starter` | A$29/mo              | 200 document checks / month   | `NEXT_PUBLIC_STRIPE_DOC_CHECK_STARTER_MONTHLY` |
| `doc_pro`     | A$99/mo              | 1,500 document checks / month | `NEXT_PUBLIC_STRIPE_DOC_CHECK_PRO_MONTHLY`     |

Registry: `apps/web/lib/documentSkus.ts`. Allowance resolution:
`apps/web/lib/document-allowance.ts` — an org's `settings.document_billing`
record (status active/past_due) wins; otherwise the interim
`TIER_LIMITS[api_keys.tier].documentChecksPerMonth` fallback applies.
**Doc plans never touch `api_keys.tier`** (separate SKU axis — the
brandSkus rule; the tier is key-scoped and carries A$449-tier API volume,
the doc meter is org-scoped).

## Flags & env

| Name                                           | Where           | Default | Meaning                                                                                                     |
| ---------------------------------------------- | --------------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| `FF_DOCUMENT_CHECK_BILLING`                    | Vercel (server) | OFF     | Gates `POST /api/document-checks/checkout`. Route also 503s `price_not_configured` until price IDs land.    |
| `NEXT_PUBLIC_STRIPE_DOC_CHECK_STARTER_MONTHLY` | Vercel          | —       | Stripe price ID, doc_starter monthly                                                                        |
| `NEXT_PUBLIC_STRIPE_DOC_CHECK_PRO_MONTHLY`     | Vercel          | —       | Stripe price ID, doc_pro monthly                                                                            |
| `STRIPE_DOC_CHECK_PILOT_COUPON`                | Vercel (server) | —       | Optional Stripe coupon ID — first-month-free pilot offer, applied at checkout (disables the promo-code box) |

## Manual pilot (no Stripe needed — the first-pilot path)

Mirrors `brand_pilot` (`billing_provider='manual'`). Founder runs, in the
Supabase SQL editor against the pilot org's id:

```sql
UPDATE organizations
SET settings = jsonb_set(
      COALESCE(settings, '{}'::jsonb),
      '{document_billing}',
      jsonb_build_object(
        'plan', 'doc_starter',
        'status', 'active',
        'billing_provider', 'manual',
        'updated_at', now()
      )
    ),
    updated_at = now()
WHERE id = '<org-uuid>';
```

The resolver treats this identically to a Stripe subscription. A manual
record can never be cancelled by a Stripe webhook event (guarded in the
deletion branch). To end a manual pilot, set `status` to `'canceled'` the
same way. Pair with `FF_DOCUMENT_CHECK_V1_API=true` and an org-linked API
key scoped to `document-checks` / `document-checks.submit`
(`allowed_endpoints`).

## Stripe product setup (operator, before self-serve)

1. Stripe Dashboard → Products → create "Ask Arthur Document Check" with
   two AUD recurring monthly prices (A$29, A$99), **tax behaviour
   inclusive** (checkout runs `automatic_tax`).
2. Test mode first: paste the test price IDs into the Vercel env vars →
   redeploy (env snapshots at deploy; use a `[build]` commit if pushing) →
   run a test-mode checkout end-to-end: checkout → webhook →
   `organizations.settings.document_billing` populated → `/api/v1/usage`
   shows `documentChecks.source: "document_plan"`.
3. Live mode: repeat with live price IDs. No new webhook endpoint — the
   existing `/api/stripe/webhook` dispatches by price ID
   (`isDocumentPlanPrice`, BEFORE the api_keys tier path).
4. Flip `FF_DOCUMENT_CHECK_BILLING=true`.
5. Optional: create the first-month-free coupon and set
   `STRIPE_DOC_CHECK_PILOT_COUPON`.

## Smoke test

1. Checkout with a non-admin org member → 403 `not_org_billing_admin`.
2. Checkout with price env unset → 503 `price_not_configured`.
3. Completed test checkout → `document_billing` record with
   `billing_provider: "stripe"`, status `active`.
4. `POST /api/v1/document-checks` with the org's key → `monthlyRemaining`
   reflects the plan allowance (200/1,500), not the tier fallback.
5. Cancel in Stripe → record flips to `canceled` → allowance falls back to
   the key's tier mapping.
