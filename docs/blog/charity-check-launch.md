# How to Check an Australian Charity in 30 Seconds — Without Giving Them a Cent First

![A faceless person standing on a city footpath holding up a smartphone showing a small green check-mark badge — a quiet pause before deciding whether to donate.](/illustrations/blog-charity-check-hero-v1.webp)

_A donor's guide to the four registers that matter, the four red flags that should stop you, and a free tool that combines all of them in one screen._

You're walking through the city on a Saturday. A young person with a clipboard and a charity-branded t-shirt steps into your path, smiles, and asks if you have a minute to hear about kids in remote communities. They have a card reader on their phone. They want $30 a month.

The cause sounds real. The badge looks official. But your gut is doing that small thing it does when something doesn't quite fit. So what do you actually do?

Until last week, the honest answer was: take the flyer, go home, open four different government websites on your laptop, and squint at registers that don't talk to each other. Most people just don't.

We built [`/charity-check`](https://askarthur.au/charity-check) to collapse all of that into 30 seconds on a phone, on the footpath, while the conversation is still happening.

---

## Why it's harder than it should be

Australia has four authoritative registers a donor should arguably know about. They're all public, they're all free, and they don't talk to each other.

- **The ACNC Charity Register** — about 64,000 entries since 2012.
- **The Australian Business Register** — ABN status and Deductible Gift Recipient (DGR) endorsement, the thing that lets a charity legitimately claim donations are tax-deductible.
- **State fundraising regulators** — ACNC registration is enough in NSW, Vic, Qld, SA and the ACT, but **WA and Tasmania still require their own Charitable Collections Licence**.
- **The Public Fundraising Regulatory Association (PFRA)** — the self-regulatory body for face-to-face fundraisers. About 50 member charities. The single highest-confidence positive signal for someone with a clipboard.

> [!DANGER]
> Australians lost over **A$10 million to fake-charity scams in 2024** alone, with sharp spikes after every bushfire, flood and Christmas appeal. The donor on the footpath isn't asking one question — they're asking five, against five different registers, and they need an answer in the time it takes the fundraiser to get bored.

Plus Scamwatch, which doesn't run a register but does publish alerts when specific charities are being impersonated. Useful context, tricky to use as a verdict on its own — an alert about _scammers impersonating the Red Cross_ doesn't make the Red Cross any less legitimate.

---

## The four signals our tool checks

Submit a name, ABN or photo of the lanyard. Four checks run in parallel inside a five-second budget.

- **ACNC registration.** We mirror the full register locally, so an ABN lookup is an exact key match and a name lookup uses fuzzy search to find common variations. If your input is one or two letters off a real charity name ("Astralian Red Cros"), the typosquat detector fires and the verdict goes straight to HIGH_RISK.
- **ABN active and DGR endorsed.** Live lookup against the Australian Business Register. Cancelled ABN is the single strongest negative signal. A name mismatch — you typed "Cancer Foundation," the ABR returns "ABC Marketing Pty Ltd" — escalates the verdict.
- **Donation URL scrutiny.** If you supply a URL, we run Google Safe Browsing and a WHOIS check against it. A donation domain registered in the last 30 days, attached to a "bushfire appeal," is the textbook fake-charity pattern.
- **PFRA membership.** Member? The verdict nudges towards SAFE. Not a member? The pillar simply doesn't fire — plenty of legitimate online-only charities never join, so non-membership isn't a penalty.

The verdict screen renders in under a second: a coloured pill (**Looks legitimate**, **Pause**, **Suspicious**, **High risk**), a row of pillar ticks, and one CTA button — _Donate via their official site_ — that deep-links the URL we got from the ACNC register. Never the URL the fundraiser supplied.

---

## The four red flags that should stop you regardless

The tool will tell you what the registers say. There are four signals it _can't_ see — the ones in front of you, not on a flyer — that should override anything we return.

1. **Cash, gift cards, crypto, or a transfer to a personal bank account.** Legitimate Australian charities don't ask for these from a stranger. Card readers and official donation websites — those are the standard.
2. **No ID badge, or a refusal to show one when asked.** PFRA-aligned fundraisers carry numbered ID badges with the agency name visible and are required to show them. A polite "Could I see your ID?" is fair. An awkward redirect is a hard scam signal.
3. **A name that's _almost_ a real charity.** "Cancer Cuncil." "Astralian Red Cross." "Save the Childrn." The tool catches these automatically — but trust your eyes too.
4. **A donation URL that isn't on the ACNC register's listed website.** Every registered charity has an official site on file. If a flyer or QR code points elsewhere, navigate to the registered one instead.

> [!WARNING]
> If the answer to any of these is yes, **stop**. A SAFE verdict on the registers does not override a red flag in the room.

---

## What it costs you to use it

Nothing. The tool is free and stays free.

It's a Progressive Web App, so on iOS or Android you can _Add to Home Screen_ and it sits next to your other apps as a one-tap launcher. The next time you're stopped on the footpath, it's on the second tap.

We don't store anything about your queries. No PII, no IP-to-charity-name associations. The cost-telemetry table records that _a_ check was done — not what was checked.

> [!TIP]
> The fastest way in is the **photo path.** Tap the camera button, point it at the lanyard or flyer, and Claude Vision extracts the charity name and ABN automatically. One hand on your phone, one on your coffee.

---

## What we deliberately don't do

We're a quiet second opinion, not a regulator. A SAFE verdict means the registers line up — not that the charity is guaranteed safe.

We don't yet scrape the state fundraising registers for NSW, Victoria or WA — we link out to them when the charity's registered address makes them relevant. We don't yet pull Annual Information Statement financials, because "X% to programs vs admin" is a noisier signal than registration existence. Both are on the next sprint.

We don't currently have a B2B API — but the same engine is one route handler away from being one. `POST /api/v1/charity/verify` is on the roadmap to ship before the **Scams Prevention Framework Act** obligations start binding banks and telcos on **1 July 2026**. If you're a bank, telco or platform looking at SPF compliance, [say hello](mailto:brendan@askarthur.au).

---

## Three things to do right now

1. **Try it.** [askarthur.au/charity-check](https://askarthur.au/charity-check). Search for a charity you know, search for one you don't, type a name with a deliberate typo and watch the typosquat detection fire.
2. **Add it to your home screen.** On iOS or Android, _Add to Home Screen_ makes it a one-tap launcher. Second tap from anywhere on the footpath.
3. **If you run a charity, check that your ACNC website field is up to date.** That's the URL we use as the official-donation CTA. If it's stale, donors arriving via this tool will be sent somewhere stale.

---

## The bottom line

Donating safely shouldn't require a laptop and seven tabs. The four registers exist; they just don't talk to each other, and most people don't have time to broker the conversation themselves.

So we did it. It's free. It's on your phone. And the next time someone steps into your path with a clipboard and a story, you've got a 30-second second opinion in your pocket.

---

_If the tool catches a fake-charity scam for you, [report it to Scamwatch](https://www.scamwatch.gov.au/report-a-scam). If you've already paid and you're worried about identity recovery, [IDCARE](https://www.idcare.org) is the right call._

_Ask Arthur is Australia's friendly scam-detection companion. The platform is Australian and the data stays Australian. For more guides and real-time alerts, visit [askarthur.au](https://askarthur.au)._
