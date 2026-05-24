# Shopify Trust & Safety / Shop Pay outreach (#367)

**Status:** ready to send. Action: brendan picks the highest-likelihood channel, sends once, doesn't follow up. Asymmetric upside (875M shopper distribution via Shop app if they engage), zero downside if silent.

**Per Shopfront plan Decision #7:** decoupled from build. Don't gate any Shopfront work on the response.

---

## Channel selection (in priority order)

1. **Shopify Partner Dashboard contact form** — public ingress; reaches partnerships team. Lowest reply rate but most-correct routing.
2. **Direct email to known Shop Pay / Shop app product folks** if you have warm intros. LinkedIn search: "Shop Pay product manager" or "Shop app trust safety". A warm intro from an existing Shopify Partner is worth 10× a cold email here.
3. **Shopify Editions** (community channel) — slow but high-visibility.

If brendan has any AU-based Shopify Plus account-rep relationship, use that as the warm-intro lane. Shopify-AU has stronger appetite for AU-specific fraud-prevention partnerships than Shopify-global.

---

## Email draft

Subject: **AU scam-corpus integration — Ask Arthur ↔ Shop Pay / Shop app fraud rails**

> Hi [Shopify Trust & Safety / Shop Pay team],
>
> I'm Brendan Milton, founder of [Ask Arthur](https://askarthur.au) — an Australian scam-detection platform. I'm reaching out because we have an AU-specific scam-intelligence corpus that I think could materially improve scam reporting + fraud rails on the Shop app and Shop Pay surfaces serving AU shoppers.
>
> **What we have:**
>
> - ~28K+ user-reported scams (URLs, phone numbers, emails, brand impersonations) — consumer extension + mobile app + 4 messaging bots feeding the corpus daily
> - 840 narrative-classified Reddit posts (modus operandi tags, impersonated brands)
> - Australian regulator threat-feed integrations (ACCC Scamwatch, ACSC, ASIC, AUSTRAC)
> - ABN / ACNC verification (63,637 charities + every active AU business)
> - Brand-impersonation alerts on the AU govt + finance + telco sectors
>
> **What we're building:**
>
> An Ask Arthur Shield Shopify app (Shopfront) shipping to AU merchants Q4 2026. The merchant-side product. Two surfaces on top:
>
> 1. **Verified Directory** at `askarthur.au/verified` — a public per-merchant trust page that AU shoppers cross-reference at checkout
> 2. **Cross-merchant clone-detection** — surfaces clone storefronts targeting AU brands before they hit consumer wallets
>
> **What I'd like to explore:**
>
> Two integration paths, either or both:
>
> 1. **Feed Ask Arthur's scam-signal into Shop Pay's fraud rails** for AU buyers. Open API, no commercial relationship needed initially — public-good integration. Shop Pay gets AU-specific fraud intel that the broader fraud-engine doesn't have.
> 2. **Surface the Ask Arthur "Verified Merchant" signal in the Shop app's merchant directory / shopper-trust UI** for AU merchants who install our app. The signal is point-in-time and revocable; we run continuous re-verification (ABN + ACNC + scam-corpus + clone-detection daily).
>
> If either lane is interesting, I'd love a 30-minute conversation with the relevant product owner. I'm not pushing for a commercial deal — this is asymmetric upside for both sides: you get AU-specific scam intel; we get distribution reach to AU shoppers we'd otherwise hit one extension install at a time.
>
> Happy to share the full Shopfront plan + the consumer-side product surface details. Reach me at brendan.milton1211@gmail.com.
>
> Brendan
> brendan.milton1211@gmail.com | askarthur.au

---

## What we want from a reply (any reply at all)

- **Yes, interesting** → 30-min conversation; convert to product-team relationship; track via separate `docs/policy/shopify-partnership-tracker.md` (create when first reply lands).
- **Not now** → log the date; check in once a year as the Shopfront corpus grows.
- **Silence** → don't follow up; the asymmetric-upside framing demands no chasing.

---

## Dependencies this unblocks

- **Optionally accelerates Verified Directory traffic** if Shop app surfaces the Ask Arthur trust signal — this is the consumer-acquisition wedge.
- **Defensive against Shopify's 40-50% probability of shipping a native Verified Merchant feature within 24 months** (Shopfront plan §6 risk 3) — engaging early positions us as the data source, not the displaced product.
- **NOT a build blocker for anything.** Per Decision #7, build proceeds regardless of reply.
