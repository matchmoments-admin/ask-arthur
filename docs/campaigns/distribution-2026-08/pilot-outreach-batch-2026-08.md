# Brand-pilot outreach batch — August 2026

_#933 item 6. Worklist pulled from prod `get_brand_outreach_worklist()` (v241) on 2026-08-07: 47 ranked brands, **zero contacted to date** (`last_contacted_at` NULL across the board — this is batch one)._
_Drafts below use the exact `buildComposerBody()` template (`apps/web/lib/email/brand-outreach-worklist.ts`) so they match what /admin/brand-outreach composes. Offer: A$300/mo, 3-month term, first month free, named case study — locked per the brand-activation decisions._
_Signal: replies → pilot conversions (the #902 Shape-1 evidence gate)._

## Selection rationale

Top-5 **eligible** AU-fit picks. Excluded from this batch, deliberately:

- **Enterprise bucket** (Apple, Amazon, PayPal, Westpac, NAB, ANZ, CBA, Woolworths, ubank) — the worklist flags these `likely_enterprise`; an A$300 pilot pitch is the wrong instrument. Their live clones still go out via the evidence/abuse channels, not this batch.
- **Government** (myGov, Medicare, NDIS) — not pilot prospects; route via `public.disclosure@servicesaustralia.gov.au` / agency disclosure as evidence reports.
- **Global non-AU** (Microsoft, Coinbase, Kraken, Wise, Spotify, Booking.com) — off the AU-first pilot thesis.

**Contact-routing caveat for every draft:** the resolved recipients are abuse/security/privacy inboxes — right for evidence hand-off, wrong for a commercial pilot pitch. Recommended play per brand: send the evidence to the listed inbox (goodwill + provenance), and pitch the pilot to a named human (fraud/security lead via LinkedIn) — the `{{hook}}` token in each draft is that person's name.

---

## 1. Stake (hellostake.com) — the headline story

**Signal:** 137 live · part of a 56-domain campaign · 138 lookalikes total
**Resolved contact:** abuse@hellostake.com (stewardship channel)
**Founder note:** strongest narrative asset we have — the published post "hellostake.com has 53 clone sites — more than any brand we watch" (June edition; it's now 138 total). Attach or link the public evidence. This is the flagship pitch of the batch.

```
Hi {{hook}},

I'm Brendan, the founder of Ask Arthur — an Australian scam-detection service that runs a clone-watch system spotting lookalike and phishing domains impersonating Australian brands, often within hours of registration.

I'm reaching out because we're tracking a coordinated campaign of 56 lookalike domains — several of them registered to impersonate stake, which is why I wanted to get this in front of your team quickly.

I'd like to offer you a straightforward pilot:

- **A$300/month**, on a 3-month term
- **First month free**
- In return, a short named case study we can publish together if the results are useful to you

If that's worth a conversation, I'm happy to send through a recent real example of what we've already caught for stake.

Best,
Brendan
```

## 2. Target Australia (target.com.au)

**Signal:** 3 weaponised · 82 live · part of a 56-domain campaign · 90 lookalikes total
**Resolved contact:** abuse@target.com.au (stewardship channel)
**Founder note:** highest weaponised count in the eligible bucket; latest weaponisation 2026-08-04 (this week). Wesfarmers-owned, so expect procurement friction — the case-study angle may matter more than the price.

```
Hi {{hook}},

I'm Brendan, the founder of Ask Arthur — an Australian scam-detection service that runs a clone-watch system spotting lookalike and phishing domains impersonating Australian brands, often within hours of registration.

I'm reaching out because we're tracking a coordinated campaign of 56 lookalike domains — several of them registered to impersonate target, which is why I wanted to get this in front of your team quickly.

I'd like to offer you a straightforward pilot:

- **A$300/month**, on a 3-month term
- **First month free**
- In return, a short named case study we can publish together if the results are useful to you

If that's worth a conversation, I'm happy to send through a recent real example of what we've already caught for target.

Best,
Brendan
```

## 3. Reece (reece.com.au)

**Signal:** 1 weaponised · 29 live · part of a 44-domain campaign · 30 lookalikes total
**Resolved contact:** privacy.officer@reece.com.au (fraud-inbox channel)
**Founder note:** trade audience (plumbers get invoice-fraud-adjacent scams) — the "your customers are the target" framing lands well here.

```
Hi {{hook}},

I'm Brendan, the founder of Ask Arthur — an Australian scam-detection service that runs a clone-watch system spotting lookalike and phishing domains impersonating Australian brands, often within hours of registration.

I'm reaching out because we're tracking a coordinated campaign of 44 lookalike domains — several of them registered to impersonate reece, which is why I wanted to get this in front of your team quickly.

I'd like to offer you a straightforward pilot:

- **A$300/month**, on a 3-month term
- **First month free**
- In return, a short named case study we can publish together if the results are useful to you

If that's worth a conversation, I'm happy to send through a recent real example of what we've already caught for reece.

Best,
Brendan
```

## 4. Airwallex (airwallex.com)

**Signal:** 2 weaponised · 3 live · part of a 5-domain campaign · 5 lookalikes total
**Resolved contact:** bugbounty@airwallex.com (known-brands channel)
**Founder note:** AU-founded fintech with a real security budget and a bug-bounty culture — most likely of the batch to _reply_ to a cold security-adjacent email. Small clone count, but 2 weaponised means live phishing.

```
Hi {{hook}},

I'm Brendan, the founder of Ask Arthur — an Australian scam-detection service that runs a clone-watch system spotting lookalike and phishing domains impersonating Australian brands, often within hours of registration.

I'm reaching out because we're tracking a coordinated campaign of 5 lookalike domains — several of them registered to impersonate airwallex, which is why I wanted to get this in front of your team quickly.

I'd like to offer you a straightforward pilot:

- **A$300/month**, on a 3-month term
- **First month free**
- In return, a short named case study we can publish together if the results are useful to you

If that's worth a conversation, I'm happy to send through a recent real example of what we've already caught for airwallex.

Best,
Brendan
```

## 5. iiNet (iinet.net.au)

**Signal:** 26 live · part of a 56-domain campaign · 26 lookalikes total
**Resolved contact:** abuse@iinet.net.au (known-brands channel)
**Founder note:** telco = SPF-regulated entity from 1 July 2026 — the pilot doubles as SPF-readiness evidence gathering for them. Worth mentioning the SPF angle in the follow-up, not the opener.

```
Hi {{hook}},

I'm Brendan, the founder of Ask Arthur — an Australian scam-detection service that runs a clone-watch system spotting lookalike and phishing domains impersonating Australian brands, often within hours of registration.

I'm reaching out because we're tracking a coordinated campaign of 56 lookalike domains — several of them registered to impersonate iinet, which is why I wanted to get this in front of your team quickly.

I'd like to offer you a straightforward pilot:

- **A$300/month**, on a 3-month term
- **First month free**
- In return, a short named case study we can publish together if the results are useful to you

If that's worth a conversation, I'm happy to send through a recent real example of what we've already caught for iinet.

Best,
Brendan
```

---

## Send workflow

1. Open `/admin/brand-outreach` — the same worklist renders there with the composer pre-filled; sending from there logs the contact (so `contacted_recently` starts gating re-sends).
2. Per brand: find the named human (fraud/security lead), replace `{{hook}}`, personalise one sentence, send. Evidence to the listed abuse inbox in parallel where it differs.
3. Record outcomes weekly in the [weekly signal review](../../ops/weekly-signal-review.md) — the signal is **replies → pilot conversions** (#902 Shape-1 evidence gate).
4. Next batch: re-run `get_brand_outreach_worklist()` — contacted brands drop into the "contacted" bucket automatically.
