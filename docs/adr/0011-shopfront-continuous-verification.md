# Shopfront — Verified badge is continuous, not point-in-time

**Status:** accepted (2026-05-23)

The "Verified by Ask Arthur" badge that the Shopfront app embeds on
merchant storefronts is **continuously re-verified** on a daily cron + on
external triggers (new `scam_reports` match, ABN cancellation, ACNC
deregistration), with **auto-downgrade** to `expired` / `reported` /
`suspended` states on negative signal. It is not a point-in-time stamp,
and it is not a warranty.

## Context

A naive "verified badge" implementation issues a stamp once at install
time and trusts it indefinitely. That model is incompatible with Ask
Arthur's mission and brand:

1. **Merchant state changes.** ABN registrations get cancelled, ACNC
   charities get deregistered, storefronts get hacked or sold, and
   previously-clean merchants get scam-reported.
2. **The "we badged a scammer" failure mode is asymmetric.** A single
   public incident where Ask Arthur vouched for a merchant who then
   defrauded shoppers does brand damage that swamps months of
   well-verified installs. The brand promise of `askarthur.au` is
   consumer protection; a stale badge contradicts the brand.
3. **Trust-badge competitors handle this badly.** TrustedSite, BBB
   Accredited, and similar issue annual verifications with no
   intermediate revocation surface; consumers and merchants both treat
   them as warranties when they are not.

## Decision

**Continuous re-verification with auto-downgrade.** The Verified badge
operates as a state machine refreshed on multiple cadences:

| Trigger                                                     | Cadence             | Outcome                                                                      |
| ----------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------- |
| Daily cron (`shopfront/verify-merchants`) at 02:00 UTC      | Daily               | Re-check ABN Lookup + ACNC + `scam_reports` + sampled APIVoid; refresh state |
| New `scam_reports` row matching merchant domain/SKU         | Real-time           | Immediate downgrade to `reported`; merchant emailed                          |
| Merchant requests manual re-verify from admin dashboard     | On-demand (≤1/hour) | Refresh in <30s                                                              |
| ABN cancelled or ACNC deregistered (detected by daily cron) | Daily               | Downgrade to `expired`                                                       |
| 90 days since last successful verification                  | Safety net          | Force re-verify                                                              |

The badge embed (Order Status thank-you UI extension) reads the live
state from Ask Arthur's API on render — no embedded stale data.

Public provenance page at `askarthur.au/verified/{shop-handle}` shows
the full state history: when first verified, what was checked, current
state, link to download an audit-trail JSON signed with Ask Arthur's
key.

The **"verified as of [date]"** legal language (lawyer-vetted, captured
in issue #371) makes the point-in-time-not-warranty contract explicit
to both merchant and consumer.

## Consequences

- **API cost scales with merchant count × verification cadence.**
  Bounded by `feature_brakes.shopfront_verify` (A$5/day default).
  Hierarchical re-verification (heavy APIVoid monthly, light
  `scam_reports` join daily) keeps cost predictable. Breaks at ~5K
  merchants without dedicated trust-and-safety headcount per Shopfront
  plan §6 risk 6.
- **Badge embed cannot be cached aggressively.** Cache TTL ≤6h on the
  badge JSON balances freshness vs API load. A merchant downgraded
  mid-day is still visible as `verified` for up to 6 hours on cached
  page renders — acceptable, not a warranty regardless.
- **Static-image copy is defeated by dynamic-on-hover API check.** The
  badge JS calls back to Ask Arthur's API with the calling origin; a
  cloned static badge on `fake-bearepark.shop` returns "Not verified on
  this domain." This is Ask Arthur's strongest moat against scammer
  reuse of the badge graphic.
- **The "verified merchant becomes a scammer" failure mode is
  mitigated, not eliminated.** A scam_report has to land in the corpus
  before downgrade fires. There is a window between first-fraud and
  first-report. Continuous verification narrows that window; it does
  not close it.

## Alternatives considered

1. **Annual verification with manual revocation request.** Rejected —
   identical to TrustedSite/BBB and inherits their warranty-perception
   problem.
2. **Verification on every checkout (per-shopper render).** Rejected
   on cost grounds — at scale this is millions of redundant API calls
   per day for state that changes daily at most.
3. **Verification only at install + on merchant-requested re-verify.**
   Rejected — pushes the burden of staying-verified onto the merchant,
   who has zero incentive to flip themselves from verified to
   reported.

## Reversal trigger

If the continuous-verification API cost exceeds A$50/day (10× the
default brake) without proportional merchant growth, drop to
weekly-with-on-trigger refresh and accept the longer staleness window.

## Related

- `docs/plans/shopify-shopfront.md` Decision #3 + §4 continuous-verification pipeline
- Issue #374 — Verified badge implementation
- Issue #371 — Lawyer-vetted disclaimer language
- ADR 0010 — Screenshot retention gated (similar "gated by safety net" pattern)
