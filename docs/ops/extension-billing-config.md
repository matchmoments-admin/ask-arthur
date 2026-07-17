# Extension billing — ops config

Install↔account linking + Extension Pro (Stripe, A$4.99/mo, A$49/yr).
Plan: `docs/plans/extension-monetisation.md` (PRs 5–7). This page covers the
link flow (PR 5) and Stripe checkout/webhook (PR 6); tier-aware rate limits
land with PR 7.

## Checkout & provisioning (PR 6)

- `/extension/link` shows the Pro plan card once linked; buttons POST
  `{installId, interval}` to **`/api/extension/checkout`** (session-authed,
  verifies the install is linked to THIS user, 403 otherwise) →
  `stripe.checkout.sessions.create` with `metadata` + subscription metadata
  `{install_id, user_id, plan:"extension_pro"}`.
- The **webhook** (`/api/stripe/webhook`) dispatches on
  `isExtensionProPrice(priceId)` (`apps/web/lib/extensionSkus.ts`) BEFORE the
  B2B api_key path. Double ownership gate before provisioning: the Stripe
  customer's owning user (`user_profiles.stripe_customer_id`) must equal
  `metadata.user_id`, AND that user must be the install's linked user in
  `extension_subscriptions`. Mismatch → refuse + log, 200 (no Stripe retry).
- Lifecycle: subscription created/updated → tier `pro` + mapped status
  (`trialing→active`, `past_due/unpaid/incomplete→past_due`, else
  `canceled`); `invoice.payment_failed` → `past_due` (pro drops off
  immediately — `get_extension_tier` requires `status='active'`);
  subscription deleted → tier `free`, keyed on `stripe_subscription_id`.

## Tier-aware rate limits (PR 7)

- `validateExtensionRequest` resolves the tier once per request (Redis cache
  `askarthur:ext:tier:{sha256(installId)}`, 5-min TTL, fail-open **free**)
  and returns it in `ExtensionAuthResult` for routes to consume.
- Free limiters are byte-for-byte unchanged (10/min `askarthur:ext:burst`,
  50/day `askarthur:ext:daily`) — guarded by a regression test. Pro installs
  use `askarthur:ext:burst:pro` (30/min) + `askarthur:ext:daily:pro`
  (500/day); the fresh prefixes mean a mid-day upgrade gets full pro buckets
  immediately. Email-scan limits stay flat (20/min, 200/day) on any tier.
- Popup: MoreTab shows the real tier (`checkSubscription`, 1h cache); the
  upgrade CTAs (MoreTab row + CheckTab 429 card) mint a link token and open
  `/extension/link` when the billing build flag is on, else fall back to
  `/pricing`. `/api/extension/subscription` now returns the tier's `limits`.
- After a checkout, pro limits apply within ≤5 min (tier cache TTL); the
  popup label updates within ≤1 h (client cache) or on next popup open.

## Stripe product setup (operator)

1. Dashboard → Products → "Ask Arthur Extension Pro": recurring prices
   A$4.99/month + A$49/year (AUD, tax behaviour inclusive — checkout enables
   `automatic_tax`).
2. Paste price IDs into Vercel: `NEXT_PUBLIC_STRIPE_EXTENSION_PRO_MONTHLY`,
   `NEXT_PUBLIC_STRIPE_EXTENSION_PRO_ANNUAL` (also in turbo.json globalEnv).
3. No new webhook endpoint — the existing one already receives the needed
   events; the new branch dispatches by price ID.

## Flags & env

| Name                                                   | Where           | Default | Meaning                                                                                   |
| ------------------------------------------------------ | --------------- | ------- | ----------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_FF_EXTENSION_BILLING`                     | Vercel          | OFF     | Gates `/extension/link` (404), `/api/extension/link-token` + `/api/extension/link` (503). |
| `WXT_EXTENSION_BILLING`                                | extension build | OFF     | Surfaces the "Link account" row in the popup's More tab.                                  |
| `NEXT_PUBLIC_STRIPE_EXTENSION_PRO_MONTHLY` / `_ANNUAL` | Vercel          | unset   | Stripe price ids (PR 6).                                                                  |

## How linking works (and why it's safe)

1. Extension (More → Link account) sends `MINT_LINK_TOKEN` to its background,
   which makes a **signed** POST to `/api/extension/link-token`. Only the
   holder of the install's ECDSA private key can mint a token for that
   `install_id` — an attacker cannot mint one for a victim's install.
2. Token: 32 random bytes hex, Redis `askarthur:ext:link:{token}` →
   installId, **TTL 10 min, single-use** (atomic `GETDEL` on consume).
3. Extension opens `askarthur.au/extension/link?token=…`. The page requires a
   web session (redirects to `/login?next=…`), then POSTs the token to
   `/api/extension/link`.
4. The consume route verifies the install exists and isn't revoked, then
   upserts `extension_subscriptions {install_id, user_id, linked_at}`.
   An install already linked to a **different** user → 409 `already_linked`
   (re-linking would transfer any pro entitlement, so it requires an explicit
   unlink flow, which doesn't exist yet — by design).

## Schema (migration v238)

`extension_subscriptions` gained `user_id` (FK auth.users, SET NULL),
`stripe_subscription_id` (unique partial idx), `stripe_customer_id`,
`stripe_price_id`, `billing_provider` (stripe|paddle|manual, default stripe),
`linked_at` — plus **RLS enabled** (service-role-only policy; closes a v34
gap). Legacy `paddle_*` columns retained, unused. `get_extension_tier` is
unchanged and still decides free/pro from
`tier + status='active' + current_period_end`.

## Smoke test (preview)

1. `NEXT_PUBLIC_FF_EXTENSION_BILLING=true` on preview; build extension with
   `WXT_EXTENSION_BILLING=true`, load unpacked.
2. More → Link account → browser opens `/extension/link?token=…` → log in →
   page shows "Extension linked to <email>, plan Free".
3. Reload the link URL → "link expired" (single-use).
4. `SELECT install_id, user_id, linked_at FROM extension_subscriptions` shows
   the row; `get_extension_tier(install_id)` still returns `free`.
