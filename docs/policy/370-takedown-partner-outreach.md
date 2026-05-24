# Takedown-partner outreach — Bustem + alternatives (#370)

**Status:** ready to send. Action: brendan customises the email per vendor and sends to 2–3 in batch.

**Decision (per Shopfront plan §5 Stage 0 step 5 + Decision #4):** in-house human-triage for v1 is the default. This outreach validates whether a partner makes sense for v2 (Stage 3 efficiency) OR for sovereign-hosted clones the in-house workflow struggles with.

**Critical:** don't sign anything before #371 (lawyer-vetted disclaimer pack) lands — outreach is information-gathering only at this stage.

---

## Target vendors (3, prioritised)

### 1. Bustem (`bustem.com`) — primary target

The category-leader in ecommerce-focused takedown-as-a-service. Pay-per-takedown model, faster than DIY, claims international coverage. Likely the best fit for the Stage 1 5-BD SLA commitment.

**Hypothesised pricing**: US$50–200 per takedown.

### 2. RedPoints (`redpoints.com`) — enterprise alternative

Bigger, more expensive, more counterfeit-focused. Probably overkill for Stage 1 volume (5–20 clones/month across the design-partner cohort) but worth getting a quote for comparison.

**Hypothesised pricing**: subscription, US$2K+/mo minimum.

### 3. Marqvision or similar ML-based takedown — sleeper

Newer entrant; uses ML to detect + auto-file. Interesting alignment with our clone-detection signal stack but risk of feature overlap (they detect; we detect; do they want our signal or compete with it?). Worth a single conversation to scope.

**Hypothesised pricing**: unknown; volume-based.

---

## Email skeleton (customise per vendor)

Subject: **AU Shopify app — scoping a takedown partnership for confirmed clones**

> Hi [Bustem / RedPoints / vendor team],
>
> I'm Brendan Milton, founder of [Ask Arthur](https://askarthur.au) — we're launching an Australian Shopify app (Ask Arthur Shield) Q4 2026 that detects clones of merchant storefronts via a multi-signal pipeline (CT firehose, dnstwist permutations, perceptual logo hashes, Voyage semantic embeddings). Our paid tier (Shield Pro, A$29/mo) commits to a 5-business-day human-triage takedown for every confirmed clone.
>
> We're scoping whether to keep takedowns in-house (default plan, ops-staff triage + auto-generated DMCA / registrar abuse / Cloudflare host abuse templates) OR partner with a takedown-as-a-service vendor for higher-volume / harder cases.
>
> Three questions for a 20-minute conversation:
>
> 1. **Pricing model** at our expected Stage 1 volume — 5–20 takedowns/month, growing to 50–100/month by mid-Stage 2 (Q1 2027). Pay-per-takedown vs subscription?
> 2. **Coverage breadth** — what fraction of the takedowns you handle hit sovereign-hosted registrars (e.g., Russia-based registrars, .ru / .top TLDs, Cloudflare-cloaked hosts) where in-house DMCA notices regularly bounce? This is the gap we'd most want a partner to fill.
> 3. **Data-sharing model** — would you accept our pre-built evidence packs (signal-by-signal confidence scores, page screenshots, certificate-issuance timestamps) as the takedown notice input, or do you re-run detection on your side? Lower-handoff-friction matters more than ML-detection feature overlap.
>
> Open API integration would be ideal long-term; one-click web submission is fine for an MVP.
>
> Available for a call any time over the next 3 weeks. Happy to share the Shopfront clone-detection signal stack documentation for context.
>
> Brendan
> brendan.milton1211@gmail.com | askarthur.au

---

## Per-conversation capture template

Save outcomes into `docs/policy/370-takedown-partner-tracking.md` (create when first reply lands):

```
## [Vendor name] — [date]

- Contact: [name + email]
- Pricing model: [pay-per-takedown / subscription / hybrid]
- Stage 1 cost estimate (5–20/mo): A$[range]
- Sovereign-hosted coverage: [strong / weak / none]
- Evidence-pack acceptance: [yes / no / partial]
- API or web submission: [API / web / both / planned]
- Verdict: [partner Stage 1 / partner Stage 3 / never / re-engage when]
- Notes:
```

---

## Decision rule

- **Bustem quotes <A$100/takedown AND accepts our evidence packs AND has decent sovereign-hosted coverage** → partner from Stage 1 onward (saves in-house ops time, scales better)
- **Bustem expensive OR doesn't accept evidence packs** → in-house for Stage 1, revisit at Stage 3 (when Q4 2027 volume justifies)
- **No good partner exists** → in-house permanently; build our own takedown automation later

---

## Dependencies this unblocks

- **Shield Pro tier (#377)** — the 5-BD takedown SLA commitment is the paid-tier value prop. Partner decision affects implementation but NOT scope; Stage 1 ships either way.
- **Stage 3 chargeback features** are independent of this — no dependency.

NOT a Stage 1 build blocker. Worst case: in-house ops handles takedowns indefinitely.
