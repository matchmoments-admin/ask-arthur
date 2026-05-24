# Disclaimer-pack SOW + outreach (#371)

**Status:** ready to send. Action: brendan picks a firm, customises the email below, sends.

**Budget envelope:** A$3-5K fixed-fee (per Shopfront plan §5 Stage 0 step 6).

**Target firms (AU, scam/defamation/ACL experience):**

- **Maddocks** — privacy + consumer-law specialists; existing relationship lane via the #369 privacy-counsel ask. Ask for the same partner-team to bundle both engagements for a discount.
- **Gilbert + Tobin** — broader tech-law shop; competitive quote.
- **Backup:** Holding Redlich, Lander & Rogers — both have AU consumer-protection desks.

---

## What we need (the 5 deliverables)

The pack covers every outbound consumer-facing surface that makes a factual claim about a third party (merchant or suspected scammer):

1. **Verified badge copy** — "Verified by Ask Arthur" rendered on merchant storefronts via Order Status thank-you UI extension. Must read as **point-in-time, not a warranty, may be revoked daily**. The badge promise is _"as of right now, no negative signal"_ — not _"safe to transact"_.
2. **Clone-detection alert copy** — emails + dashboard surfaces describing factual signals ("we detected an SSL cert for `fake-yourstore.shop` matching your brand at edit-distance 2") rather than legal characterisation ("this is a clone"). Distinguish _signal-confirmed_ (Brand Match + Visual Match fired) from _signal-suspected_ (Brand Match only; page not fetched). Defamation surface — even-handed factual language is the defence.
3. **Verified Directory listing copy** (`askarthur.au/verified/{shop-handle}`) — s 18 Australian Consumer Law (misleading-or-deceptive-conduct) compliance + uniform defamation compliance. Includes "verified-as-of-date" provenance display + revocation history transparency.
4. **DMCA / registrar abuse / Cloudflare host abuse template copy** — the merchant-self-serve templates (free tier) and the Ask Arthur-ops-sent templates (Shield Pro 5-BD takedown). Templates are factual signal disclosures aimed at abuse contacts; they MUST NOT make legal characterisations the merchant doesn't have evidence for.
5. **Cold-outreach email copy** for #385 — third-party-to-third-party communication ("we detected this site impersonating your brand"). Highest defamation exposure in the pack because we're emailing an inferred target merchant about a suspected clone operator we have no direct relationship with. Factual-signal-only language: "we detected an SSL cert issued at 14:23 AEST today; matches your brand at edit-distance Z; page-content embedding cosine W vs your homepage" — NOT "this is a clone" / "this is a scammer".

## What we want from the engagement

- **Versioned copy snippets**, plain English, ingestable into code as constants. We'll commit them with a `template_version TEXT` column on the audit table (already in `shopfront_takedown_attempts` per #376 schema spec).
- **A short rationale doc** explaining the language choices so future engineers don't soften the copy into a liability.
- **Turnaround:** 4 weeks from engagement letter to signed-off pack.
- **Revision rights:** the pack will need light updates over Stage 1 as we learn the design-partner cohort's edge cases. Include 2 revision rounds in the fixed fee.

---

## Email draft

Subject: **Disclaimer-pack engagement for Ask Arthur Shield (scam-detection / merchant trust app)**

> Hi [partner name],
>
> I'm Brendan Milton, founder of [Ask Arthur](https://askarthur.au) — an Australian scam-detection platform with consumer extension, mobile app, and a forthcoming Shopify merchant app ("Ask Arthur Shield"). We need an AU law firm to scope a disclaimer-pack engagement covering five outbound consumer-facing surfaces that make factual claims about third-party merchants and suspected scam operators.
>
> The full SOW is at: [docs/policy/371-disclaimer-pack-sow.md in our repo — share access on request]. In brief, the pack covers:
>
> 1. The "Verified by Ask Arthur" merchant badge (point-in-time, not a warranty)
> 2. Clone-detection alert copy sent to merchants (factual signals, not legal characterisations)
> 3. The Verified Directory listing (s 18 ACL + uniform defamation compliance)
> 4. DMCA / registrar abuse / Cloudflare host abuse template copy
> 5. Cold-outreach email copy to non-customer AU merchants about suspected clones (the highest-exposure surface in the pack)
>
> Budget envelope: A$3-5K fixed fee. Turnaround request: 4 weeks. Two revision rounds included.
>
> Could you let me know:
>
> - Is this work in your team's wheelhouse? (looking for AU consumer-law + defamation + ACL experience)
> - Could you quote against the envelope above, or scope a counter?
> - Could the engagement bundle with a separate privacy-counsel opinion we're also commissioning (cross-merchant federated clone-clustering under APP 6.2(c) and APP 8)? Volume discount welcome.
>
> Happy to jump on a 15-minute call to walk through the surfaces and our timeline.
>
> Brendan
> brendan.milton1211@gmail.com | askarthur.au

---

## Dependencies this unblocks

- **#376 flag flip** (`FF_SHOPFRONT_CLONE_SCAN` from OFF to ON for the design-partner cohort) — without the disclaimer pack, merchant emails can't ship live; the code can merge dark.
- **#385 cold-outreach** — copy is the gating artefact; nothing else in the pipeline ships without it.
- **#374 Verified badge surface** — badge wording IS in the pack.
- **#375 Verified Directory** — listing copy IS in the pack.
