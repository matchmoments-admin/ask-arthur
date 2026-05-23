# Shopfront — Verified Directory is the primary moat, Shopify app is one channel

**Status:** accepted (2026-05-23)

The Verified Directory at `askarthur.au/verified` is the **primary
moat** for the Shopfront play. The Shopify app is one distribution
channel for the badge that points into the Directory; the Directory
does NOT depend on the Shopify app to exist or to function.

## Context

The third research input (2026-05-23) quantified Shopify's probability
of shipping a native "Verified Merchant" tier inside the Shop app at
**40–50% within 24 months**. Shopify has direct strategic incentive:
brand reputation, post-incident regulatory pressure (EU DSA, AU SPF
expansion), and Shop Pay's existing trust-rail investment all push
toward a first-party trust signal.

A Shopify-app-centric architecture is existentially vulnerable to that
event. The day Shopify ships native verified-merchant in the Shop app,
the Shopfront app loses its primary product differentiator overnight.
Recovery requires either (a) pivot to a different surface entirely or
(b) being absorbed by Shopify on their terms.

Comparable mitigations from other platform-dependent businesses:

- **Klaviyo** (email-marketing for Shopify) survived the rise of
  Shopify Email by owning the off-Shopify integration story
  (BigCommerce, Magento, custom) and the customer-data layer.
- **Judge.me** (reviews on Shopify, 549K installs) survives despite
  Shopify Reviews existing because Judge.me owns the review-display
  widget across themes and platforms — the embedded review surface,
  not the data collection.
- **Recon Brand & Clone Protection** is structurally identical to
  what Shopfront would be without this decision: lives entirely
  inside Shopify; has no off-platform moat; vulnerable to Shopify
  shipping the same feature natively.

## Decision

**Build the public Verified Directory at `askarthur.au/verified` as a
first-class consumer-facing product, NOT as a back-end for the Shopify
app.** Specifically:

- The Directory exists at Ask Arthur's domain. SEO authority accrues to
  `askarthur.au`, not to a Shopify-app listing page.
- Per-merchant provenance pages (`/verified/{shop-handle}`) render with
  full state history, what-was-checked detail, signed verification
  certificate. These pages are valuable consumer-protection content
  regardless of whether the merchant currently runs Shopfront.
- The consumer Chrome extension auto-verifies badges on every page-load
  against Ask Arthur's API. This makes Ask Arthur the cross-platform
  trust signal — the badge works on the merchant's Shopify storefront,
  on their social media bio link, on third-party marketplaces that
  embed our badge, and via the extension's per-page check.
- The Shopify app embeds a badge that LINKS into the Directory. The
  badge is a delivery mechanism; the Directory is the moat.
- SEO programmatic pages ("Is [store] legit?" topic-cluster pages from
  the corpus) drive organic traffic that compounds independently of
  Shopify-app installs.

If Shopify ships native verified-merchant in the Shop app, the
repositioning is: _"The verified-merchant feature Shopify just shipped
runs on data Ask Arthur already provides globally, on every platform
your shoppers visit."_

## Consequences

- **Build effort is bigger than a Shopify-app-only play.** The
  Directory + SEO pages + provenance UI + consumer-extension
  auto-verification surface add roughly 1–2 eng-weeks to Stage 1
  (issues #375 + parts of #374). Acceptable trade for existential
  platform-risk mitigation.
- **SEO compounding is slow.** Per third research input, the Directory
  flywheel ("badge → directory pageviews → consumer extension installs
  → corpus → better detection") doesn't dominate growth until ~1,000+
  installed merchants AND meaningful SEO authority — both 12–18 months
  out. Patience required; we are not optimising for Shopify-install
  velocity alone.
- **Cross-platform extensibility becomes natural.** A badge that lives
  on `askarthur.au` and is verified by the consumer extension works
  identically on BigCommerce, Magento, WooCommerce, or custom-built
  stores. Stage 3+ expansion to non-Shopify platforms requires no
  Directory rework.
- **The integrity guardrails of ADR 0013 (affiliate revenue policy)
  apply to the Directory, not to the Shopify app.** This is the right
  layering — the Directory is the consumer trust surface, the Shopify
  app is a merchant productivity tool.

## Alternatives considered

1. **Shopify-app-only with badge living inside Shopify CDN.** Rejected
   — 40–50% probability of Shopify shipping the feature natively is
   too high to bet the project on. Even if they don't ship, every
   merchant is one-click away from removing the badge.
2. **Off-Shopify Directory with no Shopify app.** Rejected — loses the
   merchant install funnel that drives initial Directory population.
   The Shopify app is the SEED for Directory listings; without it
   the Directory has no listings to verify.
3. **Multi-platform from day one (Shopify + BigCommerce + Magento +
   WooCommerce).** Rejected as Stage 1 scope — third research input
   advice "don't pursue cross-platform expansion before Shopify is at
   A$50K MRR." The Directory primacy decision SUPPORTS future
   multi-platform expansion without requiring it now.

## Reversal trigger

If Shopify acquires Ask Arthur OR if Ask Arthur receives an offer for
the Shopify app at a price that captures the Directory's lifetime
value, the Directory primacy framing becomes irrelevant. Acquisition
diligence on the Directory's standalone consumer value should be
expected and welcomed.

## Related

- `docs/plans/shopify-shopfront.md` Decision #14 + §6 risk 3
- Issue #375 — Verified Directory implementation (Stage 1)
- Issue #374 — Verified badge with dynamic-on-hover API check (the
  cross-platform enforcement surface)
- ADR 0011 — Continuous re-verification (the state machine the
  Directory surfaces)
- ADR 0013 — Affiliate revenue policy (governs the Directory)
