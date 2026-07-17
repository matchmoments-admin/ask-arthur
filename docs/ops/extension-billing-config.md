# Extension billing — ops config

Install↔account linking + Extension Pro (Stripe, A$4.99/mo, A$49/yr).
Plan: `docs/plans/extension-monetisation.md` (PRs 5–7). This page covers the
link flow (PR 5); the checkout/webhook rows land with PR 6 and tier-aware
rate limits with PR 7.

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
