# Shopfront — Ask Arthur Network Threat Feed License is the funding engine

**Status:** accepted (2026-05-23) — see dated status update below for corrected SPF timing

## Status update 2026-07-18 — SPF timing corrected (T8 research)

The SPF staging assumed below ("sold direct to SPF-designated sectors …
from 1 July 2026") was written before the designation instrument and the
Stage 1 rules/codes package existed. The actual staging (verified
2026-07-17, sources in the T8 SPF-alignment research note):

- **Sector designation** (banks, telcos, digital platforms) is law —
  made 22 May 2026, **effective 23 May 2026**.
- **SPF Rules commence 1 September 2026** (Parts 2 & 7 — compliance
  statements and record-keeping — delayed to 31 March 2027). AFCA
  membership is mandatory for designated entities from 1 September 2026.
- **Sector codes commence no earlier than 31 March 2027** — this, plus
  record-keeping and the opening of AFCA's SPF complaint jurisdiction
  (authorised as SPF EDR from 1 July 2026; complaints for matters
  occurring on or after 31 March 2027), is the first hard compliance
  wall.
- **ASI-reporting (Report principle) rules** were carved out of the
  Stage 1 drafts — separate consultation 2026–27, compliance by
  end-2027.

Consequence for this ADR: there was never a "regulated from 1 July
2026" forcing function. The buying window is **H2 2026 → Q1 2027**
(compliance programs funded post-designation, vendor selection ahead of
the 31 March 2027 code commencement), and the SKU's regulatory hook is
the draft Common Code's "monitor for brand impersonation" (Prevent) and
ASI-handling (Detect) obligations — exposure-draft stage as of 28 May
2026, consultation closed 25 June 2026, final instruments expected
H2 2026. The decision itself (enterprise feed SKU funds the free tier)
stands; only the dates and the urgency model are corrected.

The Shopfront free tier (Verified badge + clone-detection alerts +
Verified Directory) is funded by a separate enterprise SKU — **"Ask
Arthur Network — Threat Feed License"** at A$1,500–2,500/mo — sold
direct to SPF-designated sectors (banks, telcos, digital platforms)
from 1 July 2026, NOT by upgrade revenue from Shopify merchants.

## Context

The Shopfront free tier has real marginal cost: continuous-verification
API calls, daily clone-detection scans, human-triage takedown attempts.
At the current B2B tier prices ($99 Pro / $449 Business), a freemium
SaaS model would need roughly $15–20K MRR (~30 Business or ~150 Pro
customers) to fund the free-tier infrastructure + support + takedown
labour without bleeding the company. Per the third research input
(2026-05-23):

> Cloudflare made it work because (a) the free-tier infrastructure
> cost is near-zero marginal per user once built, (b) free users
> compound into Pro/Business upgrades, and (c) the enterprise tier
> subsidises the rest. HIBP made it work because Troy Hunt kept it
> deliberately small and opened the codebase. Let's Encrypt required
> corporate sponsorship.

Ask Arthur has none of those structural funding advantages. The free
tier needs a dedicated funding source that does not rely on Shopify
merchants paying for it.

Simultaneously, the Scams Prevention Framework Act 2025 designates
banks, telcos, and digital platforms (social media / search / IM) from
1 July 2026 as the first regulated sectors. Those organisations have
compliance budgets and active demand for scam-detection signal feeds.
Ask Arthur already has the data assets (Scamwatch, ACSC, NASC,
Reddit Intel, RaaS Telegram scrapers) those sectors need.

## Decision

**Add a Layer 4 enterprise SKU — "Ask Arthur Network — Threat Feed
License"** sold direct (Stripe billing, not Shopify Billing) at
A$1,500–2,500/mo banded by sector + data volume + SLA, targeting:

- Banks (2–3 of NAB / CBA / Westpac / ANZ / Macquarie)
- Telcos (2–3 of Telstra / Optus / TPG / Vodafone)
- Digital platforms (2–3 of Meta-AU / Google-AU / Microsoft / X)
- Consumer protection + government (IDCARE, ACCC, NASC)

Customers receive API access to Ask Arthur's full threat-feed corpus

- Reddit Intel narrative classifier + RaaS Telegram cross-reference +
  ABN/ACNC verification engine, with 99.9% SLA, named support, custom
  integrations.

This is **Stage 0** work, not a side project — the Shopfront free-tier
scope is explicitly conditional on this SKU validating willingness-to-pay
(GitHub issue #368, severity:p1, the **funding-engine validation gate**).
If WTP doesn't land positive, Shopfront free-tier scope must shrink
before Stage 1 build commits resources.

## Consequences

- **Mission alignment is preserved.** Free tier remains genuinely free;
  no upgrade-pressure UX forced on Shopify merchants. The funding
  comes from the sector that has both the compliance need AND the
  budget.
- **Sales motion is enterprise, not self-serve.** Requires founder
  time for outreach + contract negotiation + onboarding. This is a
  10–30 customer business at this price band, not a 10,000-customer
  one.
- **Build cost is small** — the API surface is the existing B2B
  endpoint (#322) with stricter SLA + named support + Stripe billing.
  No new product to build; productisation of existing data assets.
- **Regulatory tailwind is real where SPF designation has landed.**
  Banks/telcos/digital platforms from 1 July 2026 are regulated; they
  have to do something about scams. Ecommerce merchants are NOT in
  the first-wave designation and have no equivalent forcing function.
  This is the only segment where SPF actually monetises.
- **Existential dependency on the WTP gate.** If 5+ enterprise
  conversations don't produce ≥1 verbal "yes at this price" signal,
  the entire Shopfront free-tier plan needs scope reduction. The
  funding math doesn't work at $99/$449 alone.

## Alternatives considered

1. **Fund the free tier from existing $99/$449 B2B tiers.** Rejected
   — math doesn't work; needs ~30 Business or 150 Pro customers
   (currently far short) AND those customers don't pay for free-tier
   features they don't use.
2. **Grants + sponsorship (Let's Encrypt model).** Rejected as primary
   — grants are episodic, slow, and create their own reporting
   overhead. May supplement once mission is proven; not a foundation.
3. **Higher Shopify-merchant pricing (≥$199/mo across all paid
   tiers).** Rejected — third research input found WTP floor at
   100–500 orders/mo merchants is $0–9/mo. Pricing above this just
   suppresses installs without funding the gap.
4. **Open-source the verification primitive (HIBP model).** Rejected
   — Troy Hunt's model works because the IP is the data corpus, not
   the application. Ask Arthur's IP is the analysis pipeline +
   scam-detection workflow, not just the data; open-sourcing the
   primitive doesn't reduce our marginal cost.

## Reversal trigger

If after 90 days of post-launch operation, the Ask Arthur Network
generates <A$5K MRR (~3 customers at lowest tier), revisit the funding
model. Most likely fallback: grant funding pursuit + free-tier scope
reduction to detection-only (no human-triage takedown).

## Related

- `docs/plans/shopify-shopfront.md` Decision #11 + §2 Layer 4
- Issue #368 — SPF-sector WTP validation gate (severity:p1)
- Issue #372 — Threat Feed License product setup (blocked by #368)
- ADR 0009 — ABR Lookup (free; the data asset this SKU surfaces is the
  same one referenced there)
