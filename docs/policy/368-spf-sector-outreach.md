# SPF-sector enterprise outreach — Threat Feed License WTP validation (#368)

**Status:** ready to send. Action: brendan picks 5–10 contacts, customises per-org, sends in batches of 2–3 per week.

**Evidence freshness (2026-05-24):** Layer 0 of clone-detection is now LIVE in prod. The `/clone-watch` page surfaces newly-registered-domain (NRD) candidate clones against an AU-brand watchlist. v2 matcher (PR #408) shipped 2026-05-24; Day 1 ledger after deploy: **5 alerts across 4 brands, ~20% FP rate** (within the <30% acceptance gate). Live hits:

- **Westpac** — `westpachomesb.info` (TP-class; plausible homepage clone)
- **Target** — `target-ads.pro` (TP-class; clean ads-suffix impersonation pattern) + `targetspheresolutions.shop` (marginal — Phase A DNS check needed)
- **Kmart** — `qkmart.com` (TP-class; single-char-prefix typosquat caught via Levenshtein)
- **Coles** — `autoecolesoultbycfconduite.fr` (FP; French driving school; known v3 follow-up #409)

**Use the live `/clone-watch` page as evidence in every conversation** — outreach now references shipped behaviour and a real Day-1 evidence cohort, not a roadmap promise.

**Goal:** validate willingness-to-pay A$1,500–2,500/mo (≈ A$18K–30K/yr) for the Ask Arthur Network — Threat Feed License product (ADR-0012, plan §2 Layer 4). Without ~$15-20K MRR from this tier (10–15 enterprise customers), the free Shopfront tier + ops + takedown triage bleed money. This is **the funding-engine validation gate** — its outcome determines whether Shopfront Stage 1 ships and whether Phase C clone-detection (#384) is worth building.

---

## Target list (5–10 first-wave conversations)

Prioritised by SPF-designated sector. Each org gets a customised email — common skeleton below.

### Banks (3) — looking to detect inbound scam payments

- **Commonwealth Bank** — fraud-ops team (LinkedIn intro via mutual; or `fraud-team@cba.com.au` as the public ingress). Reference CBA's NameCheck product as proof they're investing here.
- **NAB** — try via Innovation Hub / scam-intelligence team. NAB's "Acquaintance Scam" reports may be a hook.
- **Westpac** — fraud-ops. Public scam-awareness campaign suggests appetite. **Live evidence for Westpac specifically:** `westpachomesb.info` is currently in `/clone-watch` (TP-class signal, plausible homepage-clone domain). Open with this in the email.

### Telcos (2) — looking to detect scam-SMS sender IDs

- **Telstra** — Trust & Safety team. Reference Telstra's existing Scam Indicator app + the partnership we're already exploring for the SIM-swap CAMARA check (see project memory).
- **Optus / TPG** — secondary; lower scam-detection investment historically.

### Digital platforms (2) — looking to detect scam ads / landing pages

- **Meta AU** — scam-ad reduction is an active regulatory pressure point (ACCC, eSafety).
- **Google AU** — Safe Browsing already runs at scale; pitch is "AU-specific corpus you don't have, federated with yours."

### Government / consumer protection (3) — looking to enrich intelligence

- **IDCARE** — likely warmest reception; existing consumer-protection mission alignment. Lowest-paying tier — might be a customer success story, not a customer.
- **ACCC** — Scamwatch program lead; pitch as "we're already ingesting your published feed; here's what we can give back."
- **NASC (National Anti-Scam Centre)** — established 2023; explicitly mandated to coordinate scam-intelligence across sectors.

### Optional / nice-to-have

- **AusPayNet** — payments-industry body; might intro to multiple banks at once.
- **CommBank-funded Scamslayer initiative** — adjacent.

---

## What we're selling (the SKU)

API access to the Ask Arthur threat-feed corpus (figures as of 2026-05-24):

- Scam corpus (56 user-submitted reports + 2,699 feed_items + 18 brand_impersonation_alerts — grows daily as the consumer extension / mobile app uptake)
- Reddit Intel narrative classifier (~840 rows; 13 brief narrative categories) — surfaces emergent scam techniques
- RaaS Telegram cross-reference — phone numbers / URLs scraped from active scammer channels
- ABN / ACNC verification engine (63,637 ACNC charities indexed)
- **Clone-detection feeds, staged build (ADR-0015/0016):**
  - **Layer 0 (LIVE 2026-05-24)** — deterministic NRD lexical sweep, ~50 AU brands, daily; current footprint: 17 alerts in 24h including 1 plausible Westpac clone. View at `/clone-watch`.
  - **Phase A (next)** — DNS + content active-scanner against Layer 0 candidates; resolves the FP/FN trade-off.
  - **Phase B** — Certificate Transparency firehose; catches clones at issuance.
  - **Phase C** — Voyage embeddings + optional Hetzner compute for visual + semantic matching; **explicitly gated on this WTP validation landing positive.**

Delivery: API access + SLA + named support + custom integrations + (where Phase C clones a partner's domain corpus) co-investigation.

Price: **A$1,500/mo (small enterprise) to A$2,500/mo (large enterprise)**. Custom pricing above A$2,500 for multi-team / multi-sector orgs.

---

## Email skeleton

Subject: **Ask Arthur Network — AU threat-feed for [bank fraud-ops / telco trust&safety / etc.]**

> Hi [name],
>
> I'm Brendan Milton, founder of [Ask Arthur](https://askarthur.au) — an AU scam-detection platform with consumer extension (Chrome/Firefox), mobile apps (iOS/Android), and bots (Telegram/WhatsApp/Slack/Messenger). We're scoping the Ask Arthur Network — Threat Feed License product and want a 30-minute conversation with your [fraud-ops / Trust & Safety / scam-intelligence] team to validate whether the data we have would be useful to you, and what you'd pay for it.
>
> What we'd provide:
>
> - **AU scam corpus** (consumer-reported scams, URL/phone/email indicators, narrative classification)
> - **Reddit Intel** narrative classifier (emergent scam techniques surfaced before they hit mainstream channels)
> - **Clone-detection feeds** — Layer 0 (live today at [askarthur.au/clone-watch](https://askarthur.au/clone-watch); 17 candidate-clones in the last 24h across the AU-brand watchlist), Phase A/B/C planned per ADR-0015/0016 (DNS-active scanner → Certificate-Transparency firehose → semantic-match via Voyage embeddings). Phase C explicitly gated on this WTP conversation landing positive.
> - **ABN / ACNC verification adapter** (the registered-business + registered-charity validators we've built)
>
> Delivery: API + SLA + named support + custom integrations.
>
> Pricing band we're testing: **A$1,500–2,500/mo per customer**. Custom for multi-team orgs.
>
> Two specific questions for the 30-minute conversation:
>
> 1. **Fit**: would the data above replace or augment something you're currently paying for?
> 2. **Procurement reality**: what's the procurement path to A$1,500–2,500/mo enterprise spend at [org]? Sole-source-able, or does it need RFP?
>
> This is an early-stage WTP-validation conversation — we're not selling yet; we're validating whether the product is worth building at scale. Output is a yes/no/maybe + ballpark from your team, and we share back the synthesis across the cohort so everyone sees how their use-case compares.
>
> 30 minutes any time over the next 3 weeks. Calendly: [link if you have one] or reply with 2-3 windows.
>
> Brendan
> brendan.milton1211@gmail.com | askarthur.au

---

## What we want from each conversation

A short structured output, NOT a pitch + close. Capture:

- **Fit yes/no/maybe** — would this data displace/augment a current spend, OR plug a real gap?
- **Ballpark WTP** — A$1,500? A$2,500? A$5,000+? Below A$1,500?
- **Procurement path** — sole-source-able, or RFP-only? How long?
- **Decision-maker identity** — is this person the decider, or do we need to be re-introduced to their head-of-X?
- **What would block them from saying yes** — data-sovereignty / on-prem requirement / SOC2 / regulator approval / data-sharing agreement template?
- **Reverse-pitch openings** — would they share data WITH us, in exchange for paying less or being a design partner?

Capture each in a per-org line in `docs/policy/368-spf-sector-wtp-tracking.md` (separate doc; create when first conversation returns).

---

## Decision rule (when do we stop?)

- **3+ orgs across ≥2 sectors signal ≥A$1,500/mo WTP with a sole-source-able procurement path** → green-light Phase C build (#384) + Stage 1 free-tier scope as planned.
- **<3 orgs OR procurement path requires RFP-only** → defer Phase C indefinitely + shrink Stage 1 free-tier scope; revisit grant-funding angle (the AEA Seed narrative in `docs/grants/aea-seed-narrative.md`).
- **Active negative signal (multiple orgs say "interesting but no budget")** → re-plan the Layer 4 product entirely; the free-tier funding-engine doesn't work as designed.

This decision drives Stage 1 commit + Phase C gate. Don't ship Stage 1 against unknown WTP signal.

---

## Dependencies this unblocks

- **#384 Phase C clone-detection** (Voyage embeddings + NRD + optional Hetzner) — explicitly gated on this validation landing positive per ADR-0012 + plan §6 risk 6.
- **Shopfront Stage 1 free-tier scope** — if WTP is weak, the free-tier features have to shrink (we can't afford to give away what we can't fund). Don't ship Stage 1 against unknown signal.
- **The entire Shopfront roadmap funding model** — without Layer 4 customers, the free Shopify tier + ops + takedown triage operationally bleed the company. This is the most-important issue in the chain.
