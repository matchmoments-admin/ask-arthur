# Clone-Watch → Brands: activation handoff

**Purpose.** Bridge the intelligence clone-watch now produces (after the
2026-07-17 registrant-intel activation + the RDAP fix, #799) to the commercial
model that already exists, and name the _actual_ missing pieces. This is NOT a
new strategy — the model of record is
[clone-watch-enforcement-and-monetisation.md](./clone-watch-enforcement-and-monetisation.md)
(5 waves, pricing, SPF wedge) and the value features are
[clone-watch-brand-value-features.md](./clone-watch-brand-value-features.md)
(F1–F5, all shipped). Read those for depth. This doc answers three questions the
plans assume but don't foreground: **what a brand is actually buying now, how the
data becomes money, and what a brand can DO.**

---

## 1. The one-line reframe

"How do we make money from this" is not an open design question — it's a
**design that is built but dark and empty.** Everything below the funnel exists
in code; nothing is switched on for a paying brand, and no brand is onboarded.
The gap is **activation + two unbuilt wiring pieces + one design-partner**, not
strategy.

```
  DESIGNED ✓        BUILT ✓            DARK / EMPTY ✗           MISSING ✗
  ─────────         ───────            ─────────────            ─────────
  5-wave plan       org model          FF_BRAND_EXPOSURE off    BRAND_PLANS price const
  pricing tiers     monitored_brands   FF_BRAND_STEWARDSHIP off   + Stripe SKU wiring
  SPF feed ACVs     (0 rows in prod)   FF_CLONE_WEAPONISED off  first onboarded brand
  F1–F5 features    /api/v1 + apiAuth  takedown sends: legal    legal sign-off (email
  Stripe + orgs     Stripe customers   gate                       + managed takedown)
```

## 2. What the brand is actually buying (this session made it real)

A brand pays for **attribution + action**, not detection. Detection ("a fake of
you exists") is the free teaser. The paid value is the dossier that says _who,
how coordinated, how dangerous, and what to do_ — and this session is exactly
what populated that dossier:

| Dossier field                            | Now populated by                         | What it MEANS to a brand (the sales line)                                                                                    |
| ---------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `whois.statuses` (clientHold/serverHold) | RDAP, #799 (was dropped 75% of the time) | "This fake is **already suspended** by its registrar — here's proof for your records" OR "it is **live and unactioned**"     |
| `whois.abuseContact`                     | RDAP, #799                               | "Here is **exactly who to email** to kill it" — the takedown surface                                                         |
| `campaign_key`                           | `FF_CLONE_CAMPAIGNS` (live)              | "These **28 fakes across 18 brands are ONE actor** — you're not being typosquatted, you're being **targeted by a campaign**" |
| `kit_siblings`                           | `FF_CLONE_WATCH_KIT_PIVOTS` (live)       | "The kit attacking you is deployed on **N other sites on the same host** — here's the estate"                                |
| F3 `risk_score`                          | weaponisation scorer (live)              | "Ranked by likelihood of going live-phishing — action **these three first**"                                                 |
| `au_registrant` ABN                      | built, INERT (#772, no .au source)       | (future) "The `.au` fake's ABN is **cancelled** — near-dispositive fraud"                                                    |

Before this session those fields were mostly empty; the dossier said "a fake
exists." Now it says "a coordinated actor runs 28 domains against you, 3 are
weaponised, here's who hosts them and who to email." **That is the difference
between a free alert and a A$1,950/mo product.**

## 3. How the data becomes money — the value ladder (already coded)

```
  AWARENESS (free)          →   MONITOR (paid)           →   ENFORCE (paid+)
  /api/brand-exposure           Brand Stewardship email      managed takedown cases
  masked "N fakes, 1           full dossier + watch-list     (shopfront_takedown_attempts)
  campaign" teaser              + risk rank + monthly         multi-channel, F4 Netcraft
  FF_BRAND_EXPOSURE (off)       report card                   + registrar abuse routing
       │                        FF_BRAND_STEWARDSHIP (off)    legal-gated sends
       │ lead-gen funnel        A$1,950 / A$2,950 mo          A$150–400K enterprise
       ▼                             │                             │
  brand_exposure_checked        monitored_brands row +        Wave 4: /api/v1/feed/*
  funnel event → sales          org + Stripe sub              + SPF Act evidence packs
```

The rungs exist as code (Wave 0–2 complete/dark; Wave 3–4 designed). Money starts
flowing the moment: (a) the free funnel is **on** to generate leads, (b) a brand
can **pay** (BRAND_PLANS→Stripe), (c) legal clears the **outbound** email/takedown.

## 4. Critical path to first revenue (the actual to-do)

In dependency order — this is the missing piece, concretely:

1. **Turn on the free funnel.** Flip `FF_BRAND_EXPOSURE` on (re-run advisors +
   IO check per CLAUDE.md first). It's Wave 2, complete, dark. This is lead-gen:
   a brand checks itself, sees the masked "1 coordinated campaign, 5 fakes"
   teaser, and self-identifies as a prospect (`brand_exposure_checked` event
   already fires). **Zero new code.** Costs nothing. Start here.
2. **Wire `BRAND_PLANS` → Stripe.** The enum values (`brand_monitor` etc.)
   already exist in `packages/types/src/billing.ts`; the _prices_ live only in the
   plan doc. Add the price const + Stripe products + a checkout path (deliberately
   a separate SKU model from `TIER_LIMITS` — see the plan). This is the one real
   build to accept money. ~1 focused PR.
3. **Onboard ONE design-partner brand.** A super fund (report card already has a
   super-fund spotlight) or the NSW Police pilot's adjacent brand. Insert their
   `monitored_brands` row (verified + active) → they enter the dynamic watchlist
   → their dossier populates. One real customer beats any deck.
4. **Legal sign-off** unblocks the two dark outbound surfaces
   (`FF_BRAND_STEWARDSHIP_REPORT`/`_SEND`, `FF_CLONE_WEAPONISED_ALERT`, managed
   takedown sends). Framing review is the blocker, not engineering. Until then,
   Monitor is delivered admin-reviewed (four-eyes) rather than auto-sent.

Steps 1–3 are the revenue path; step 4 unlocks the _managed_ (higher-ACV) tier.

## 5. Helping brands understand risk (the translation layer)

Brands don't buy "EPP status codes" — they buy a sentence they can take to their
board. The dossier → risk translation the outputs should lead with:

- **Coordination, not volume.** "17 lookalikes" is noise. "17 lookalikes, **one
  operator**, targeting you + 4 competitors" is a threat briefing. Lead with
  `campaign_key`.
- **Weaponisation timeline.** The vendor-gap durations (already in the report
  card: decline→weaponise median ~33h) let a brand see "a declined lookalike
  becomes a live phishing site in ~1.5 days" — that's the urgency case for
  paying for monitoring vs. checking manually.
- **Actioned vs. live.** `statuses` + lifecycle KPIs let the brand see what's
  _already dead_ (registrar-suspended) vs. _live and ignored_ — the second list
  is the one that costs them customers.
- **Who to call.** `abuseContact` + the onward-report ledger turn "you have a
  problem" into "here's the takedown request, already drafted."

## 6. What else a brand can DO (the actions we enable)

The product is a verb ladder, not a dashboard:

1. **Verify** their brand → `monitored_brands` (dns_txt / email_domain), which
   turns on per-brand monitoring and gates who receives dossiers.
2. **Monitor** → receive the Stewardship email + monthly report card + F1
   weaponisation alerts (real-time when a lookalike flips to phishing).
3. **Authorize managed takedown** → we run the multi-channel case
   (`shopfront_takedown_attempts`) + F4 Netcraft reporting on their behalf, using
   the `abuseContact` the dossier now captures.
4. **Contribute to the SPF evidence pack** (Wave 4) → their detections feed the
   enterprise threat-intel feed / regulator-facing evidence under the SPF Act
   2025 wedge — the path to A$150–400K ACVs and the regulatory moat.

---

## Honest caveats

- **`.au` registrant intel is blocked** (#772, ADR-0016 amended) — no `.au`
  source exists; the ABN cross-check is the sharpest AU signal but has no input.
  Don't sell it yet.
- **`monitored_brands` has 0 rows** — the dynamic watchlist runs on a static
  ~50-brand list today. Onboarding is a real (small) step, not automatic.
- **Nothing outbound is legally cleared.** Every brand-facing _send_ is behind a
  flag awaiting framing review. Deliver Monitor four-eyes until then.
- **This doc is a bridge, not the plan.** Pricing, wave detail, and the SPF
  strategy live in
  [clone-watch-enforcement-and-monetisation.md](./clone-watch-enforcement-and-monetisation.md).
  Update that doc, not this one, when the model changes.
