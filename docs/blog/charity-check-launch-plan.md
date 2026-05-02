# Charity Legitimacy Check — Launch Blog Plan

**Status:** Plan only. The actual draft will be produced via the
`/blog` skill (see `~/.claude/skills/blog`) once the post is approved
to write. This file captures the anchor decisions so the draft stays
on-brief.

**Target launch date:** When `NEXT_PUBLIC_FF_CHARITY_CHECK=true` flips in
production. Coordinate with v0.2 PRs (c, d, e, b) — ideal post would land
day-of so visitors arriving from the post can use every feature it
mentions.

---

## 1. Audience & intent

**Primary audience.** Australian donors aged 35-70 who give in person or
online to charity appeals — the demographic Scamwatch reports
disproportionately loses money to fake-charity scams during disasters
(bushfire, flood, EOFY). Includes:

- People stopped on the street by clipboard fundraisers
- People donating in response to TV/SMS/social-media disaster appeals
- People supporting personal causes (someone's GoFundMe, school chocolate
  drive) where verification matters less but legitimacy still does

**Secondary audience.** Sector partners — ACNC, Scamwatch / National
Anti-Scam Centre, ACCC, IDCARE, PFRA — who may share the post with their
constituencies; charity-sector trade press; consumer journalists writing
seasonal stories about donation safety.

**User intent the post answers.** _"How do I check if a charity is real
before I donate?"_ (search query family). The post is the funnel from
SEO/organic share to the `/charity-check` tool itself.

## 2. Headline + hook options

Pick one for the published draft; brief the blog skill with all three so
the writer can choose:

1. **"How to check an Australian charity in 30 seconds — without giving them a cent first"** — most action-oriented, donor-anchored
2. **"The fake bushfire appeal that wasn't: how to spot a charity scam"** — story-led, hooks on disaster coverage
3. **"Cancer Council, Cancer Cuncil, Cancer Foundation: which is the real one?"** — typosquat-led, demonstrates the tool's typosquat detection in the hook

The Bourke St footpath user-anchor from the strategy memo is the strongest
narrative thread; lean on it heavily in the hook regardless of headline.

## 3. Promise (what reader gets in 5 minutes)

- The four registers/sources every donor should know exist (ACNC, ABR/DGR,
  PFRA, Scamwatch) and what each one tells you
- The four red flags that should make you stop (cash request, gift
  cards/crypto, brand-new domain on a disaster appeal, name that's _almost_
  a real charity)
- A free, fast, Australian-specific tool that combines all four checks
  (`/charity-check` — but the post EARNS that link, doesn't lead with it)

## 4. Voice + persona

Per the `/blog` skill memory, this repo uses 5 named bloggers + house
template. **Recommended persona for this post: the founder voice
("Brendan")** — Australian, plain-language, gentle authority. The
"quiet second opinion" phrasing from the verdict-screen brand voice should
echo through the post.

Avoid:

- Alarm/fearmongering ("scammers are stealing your money RIGHT NOW")
- AI-sounding language ("In today's digital landscape...", "harness the
  power of...", "leverage")
- Implying every street fundraiser is a scammer (the legitimate ones are
  PFRA-aligned and need donations)
- Implying Ask Arthur is a regulator (it's a quiet second opinion)

## 5. Outline (8 sections)

### §1 — Hook (300 words)

The Bourke St footpath scenario. A specific, plausible moment a real donor
faces. Don't reveal the tool yet — establish the friction.

### §2 — Why this is hard (250 words)

- Australia has FOUR distinct registers that matter (ACNC, ATO/DGR, state
  fundraising regulators, PFRA) and they don't talk to each other
- Each one alone is regulator-grade UX, not donor-grade
- Real-time decisions require info that exists but is scattered
- Fake-charity scam stats from Scamwatch (verify the numbers at draft time
  — current memory: 689 reports in 2018, 603 reports + $336k+ losses in
  early 2022, sharp seasonal spikes)

### §3 — The four signals (650 words)

One subsection each — each ~150 words, each with a real-world example
and the donor-action takeaway:

1. **Is it ACNC-registered?** What ACNC registration means, what it
   doesn't mean, why withheld details aren't always suspicious. Link
   acnc.gov.au/charity for the official register.
2. **Is the ABN active and does it match?** What an ABN is, why ABR
   matters even when ACNC is fine, the "tax-deductible donations" claim
   without DGR endorsement as a red flag.
3. **Is the donation URL legit?** Domain age check (the bushfire-appeal-
   registered-three-weeks-ago pattern), Google Safe Browsing, why you
   should always navigate to the official site rather than a flyer URL.
4. **Are they PFRA-aligned (street/door fundraisers)?** What PFRA does,
   the lanyard ID badge, the agency disclosure, the legal limit on
   commercial-fundraiser cuts (NSW: up to 50% retainable).

### §4 — The four red flags (350 words)

Quick-scan list with one-sentence explanations:

1. **Cash, gift cards, crypto, or bank transfer to a personal account**
   — legitimate Australian charities don't ask for these on the street
2. **No ID badge or refusal to show one**
3. **A name that's almost a real charity** (Cancer Cuncil vs. Cancer
   Council Australia)
4. **A donation URL that looks like the charity but isn't on the ACNC
   register's listed website**

### §5 — Real-world example walk-through (400 words)

Step-by-step screenshots (or styled mockups if not yet flag-flipped) of
typing "Cancer Council" → autocomplete → submit → SAFE verdict screen →
the official donation URL CTA. Then a contrast: "Astralian Red Cross"
(typosquat) → HIGH_RISK with the nearest-match callout.

This section is where the tool gets named for the first time.

### §6 — What we built and why (300 words)

R&D credibility section. Brief mention of:

- 63,637 charities in the local mirror (so the tool is fast)
- Multi-source verification (ACNC + ABR/DGR + Safe Browsing + WHOIS)
- Open-data foundations (CC BY 3.0 AU ACNC dataset, free public ABR)
- Australian-specific (NOT just a US tool retrofitted)
- Privacy-first (no PII stored from queries)

### §7 — What we DON'T do (200 words)

Honest limitations section — builds trust:

- We're not a regulator; we're a quiet second opinion
- We can't verify ≠ this is a scam
- State-by-state fundraising-licence checks are link-out today (WA + TAS
  notably still need separate licences)
- The image-OCR / "photograph the lanyard" feature is coming soon (v0.2b)

### §8 — Three things to do right now (200 words)

CTA stack:

1. Try the tool: `https://askarthur.au/charity-check`
2. Bookmark / add to home screen for the next time you're stopped on the
   street
3. (Optional, for sector readers) If you run a charity, check that your
   ACNC website field is up-to-date — that's the URL the verdict-screen
   CTA deep-links to

Total target word count: **~2,650 words.** Long-form for SEO + thoroughness;
breakable at §5 if the writer prefers a tighter version.

## 6. SEO / keyword strategy

Primary keywords (in priority order):

1. _check charity ACNC_ (high intent, low competition)
2. _is this charity legitimate Australia_ (informational + transactional)
3. _fake charity scam Australia_ (top-of-funnel, scam-aware)
4. _ABN charity lookup_ (specific transactional)
5. _PFRA street fundraiser check_ (long-tail, exact-match)

Secondary keywords:

- _donate safely Australia_, _bushfire appeal scam_, _EOFY giving safely_,
  _Cancer Council scam_ (timely seasonal hooks — refresh the post in June +
  during disaster periods with a small editorial update)

Meta:

- Title: 55-60 chars
- Meta description: 150-155 chars; include "free" and "30 seconds"
- OG image: square card with the verdict-screen mockup
- Schema.org `Article` JSON-LD with author, dateModified, dateCreated

## 7. Internal linking targets

Linking out from this post:

- `/charity-check` (the tool — primary CTA, link 4-5 times)
- `/scam-feed` (related; lateral funnel)
- `/persona-check` (related sibling tool)
- The "How Ask Arthur works" post (deeper credibility)

Linking IN to this post:

- Add to the homepage "Tools" section once flag is flipped
- Add to the `/scam-feed` sidebar
- Pin from the `/about` page during the launch fortnight

## 8. Distribution

Per the `/blog` skill's "distribution playbooks" feature — generate the
following from the post:

- **LinkedIn long-form** — 1500 words, founder-voice, hook on the Bourke
  St scenario, ends with the tool link
- **Twitter/X thread** — 9 tweets, one per signal/flag plus opening hook
  - closing CTA + tool screenshot
- **Newsletter blast** — sent via Resend to the existing askarthur.au
  newsletter list (if FF_NEWSLETTER is on at launch time)
- **Sector-partner email** — short personal note to ACNC, Scamwatch,
  PFRA, IDCARE inviting them to share

## 9. Editorial / compliance review

Pre-publish checklist:

- [ ] Numbers verified (Scamwatch report counts, dataset row counts)
- [ ] Brand voice scrub (no AI clichés, "quiet second opinion" framing
      preserved)
- [ ] Legal review of any "this is a scam" language (we never make that
      claim about a specific charity)
- [ ] Founder approval on every screenshot/mockup
- [ ] All external links checked for 200 (PFRA, ACNC, Scamwatch URLs
      change)

## 10. Post-publish measurement

Two-week soak after publish:

- Plausible analytics: pageviews, scroll depth, outbound clicks to
  `/charity-check`
- `/charity-check` traffic uplift (compare 14d before/after)
- Top-50 SEO target keywords ranking shifts
- Sector-partner inbound (Slack mentions, replies to the partner email)

If clickthrough to the tool is below 8% after 14 days, revise §5 (the
walk-through section is the conversion lever) and re-publish.

---

## Notes for the blog skill invocation

When the writer is ready, invoke `/blog` with:

- `--persona Brendan` (founder voice)
- `--template longform` or `--template how-to` depending on which fits
  better after seeing the §3-§5 draft
- `--length 2650`
- `--audience donors_au_35_70`
- Pass this file as the brief

After draft: run the `/blog`'s built-in AI-phrase scrubber + E-E-A-T
scorer before publishing.
