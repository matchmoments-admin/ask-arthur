# Shopfront — Verified Directory affiliate revenue with strict guardrails

**Status:** accepted (2026-05-23)

The Verified Directory at `askarthur.au/verified` may carry affiliate
links to verified-passing merchants, **but only under strict guardrails
codified as policy**: prominent per-listing disclosure, refusal within
12 months of any `scam_reports` match, ranking algorithmically
independent of affiliate status, no sponsored placements, no paid-for
higher visibility.

## Context

The Verified Directory has three load-bearing roles in the Shopfront
plan: (1) cross-pollination funnel for the consumer extension, (2)
trust-signal infrastructure that exists OFF-Shopify (the platform-risk
mitigation per ADR 0014), (3) potential revenue surface.

Two extreme positions on revenue both have problems:

1. **Flat ban on all affiliate revenue.** Forces all funding through
   paid B2B tiers + the Ask Arthur Network enterprise SKU (ADR 0012).
   Closes off a legitimate revenue stream that comparable consumer-
   protection directories use successfully (Choice, Productreview.com.au
   pre-2023, Trustpilot at lower tiers).
2. **Unrestricted affiliate revenue.** Creates the "we ranked X higher
   because they paid" failure mode that destroyed Productreview.com.au's
   credibility post-2023 (per the third research input: "consumers
   complain that ProductReview is 'essentially a fake consumer review
   site'"). Brand-existential risk for a scam-detection org.

A middle position — codified guardrails — captures the revenue without
the integrity risk, IF the guardrails are non-negotiable.

## Decision

Affiliate links allowed in the Verified Directory under the following
codified policy:

| Rule                         | Detail                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Eligibility**              | Affiliate link allowed only for merchants in `verified` state. Suspended / expired / reported merchants have all affiliate links removed within 24 hours of state change.                                                                                                                                                                                                          |
| **Disclosure**               | Every directory listing carrying an affiliate link must render the disclosure prominently (above-the-fold on the per-merchant page, inline next to the link itself, not buried in a privacy-policy footnote). Specific wording: _"Ask Arthur receives a commission on purchases through this link. This does not affect the merchant's verification status or directory ranking."_ |
| **Refusal window**           | Refuse affiliate enrolment from any merchant with a `scam_reports` match within trailing 12 months — even if the merchant has subsequently been cleared. The 12-month clock resets on each new match.                                                                                                                                                                              |
| **Ranking independence**     | Directory search results and category rankings are produced by an algorithm that does NOT receive affiliate-status or commission-rate as input. Confirmed by code review on every change to the ranking function.                                                                                                                                                                  |
| **No sponsored placements**  | No "Sponsored" / "Featured" / "Top pick" tiers paid for by merchants. The only way a merchant appears at the top of a search result is the algorithmic ranking.                                                                                                                                                                                                                    |
| **No paid-for verification** | Verification cost is the same for affiliate-enrolled and non-enrolled merchants (currently zero on the free tier).                                                                                                                                                                                                                                                                 |
| **Annual independent audit** | Once Directory listings exceed 100 affiliate-enrolled merchants, commission an annual independent audit of the policy + ranking algorithm. Publish the audit summary.                                                                                                                                                                                                              |
| **Per-merchant opt-out**     | Merchants can request their listing carry no affiliate link without losing verified state.                                                                                                                                                                                                                                                                                         |

## Consequences

- **Revenue is real but rate-limited.** AU affiliate CPMs for trust
  directories aren't publicly benchmarked; a reasonable floor of $5–15
  CPM (third research input estimate) means a Directory at ~10K monthly
  pageviews generates roughly $50–150/month. Not a primary funding
  source; complementary to the Ask Arthur Network SKU (ADR 0012).
- **Operational overhead per merchant scales.** Verification of
  affiliate enrolment, disclosure rendering, refusal-window enforcement,
  per-merchant opt-out — all require admin tooling. Build cost is
  modest (≤1 eng-week) but ongoing review effort scales with listings.
- **Audit overhead annual.** Independent audits cost A$5–10K per
  iteration and require enough listings to be worth it (≥100
  affiliate-enrolled merchants); first audit not until late 2027 at
  earliest.
- **Integrity story is defensible.** "We accept affiliate revenue from
  verified merchants, prominently disclose it, refuse from any merchant
  with scam history, and algorithmic ranking ignores commission" is a
  story that survives external scrutiny. The Productreview.com.au
  failure mode (algorithm influenced by paid relationships) is closed
  by codification, not just policy.

## Alternatives considered

1. **Flat ban (previous plan version).** Simplest integrity story.
   Forgoes revenue. Inflexible if grant funding doesn't materialise.
   Rejected per third research input's nuanced policy proposal.
2. **Affiliate revenue routed to nonprofit (e.g. IDCARE).** Hardest
   integrity story to challenge. Lowest financial benefit to Ask
   Arthur (zero). Considered as a future modification if external
   pressure ever questions the standard guardrails; not first-tier.
3. **Paid "Sponsored" placements with disclosure.** Rejected — the
   disclosure doesn't actually mitigate the perceived-trust damage.
   Productreview.com.au has the disclosure too.

## Reversal trigger

If a single high-profile incident occurs where Ask Arthur's affiliate
revenue is publicly criticised as influencing verification or ranking
decisions (regardless of whether the criticism is fair), revert to flat
ban immediately. The brand damage from one incident swamps lifetime
affiliate revenue.

## Related

- `docs/plans/shopify-shopfront.md` Decision #13 + §6 risk 7
- Issue #375 — Verified Directory implementation (includes affiliate
  policy enforcement as acceptance criterion)
- ADR 0014 — Directory off-Shopify as primary moat (the Directory this
  policy governs)
