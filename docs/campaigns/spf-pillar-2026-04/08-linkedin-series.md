# LinkedIn Post Series — six posts over 30 days

**Author:** Brendan Milton (personal account, not the AskArthur company page — personal accounts get 5–10× the organic reach for B2B founder-led content).

**Cadence:** One post every 4–5 days. Tuesday or Wednesday morning AEST is the optimal slot for telco/banking executive feeds.

**House style:**

- ≤1,300 characters in the visible block (LinkedIn cuts at 1,300 with a "see more")
- One specific data point in the first line (the hook)
- Opinion in the body (not just facts)
- One direct CTA at the end (link to a specific blog post, never the homepage)
- No emoji. No hashtag soup. Three hashtags maximum: `#SPFAct #Telco #ScamPrevention`
- Tag organisations only when complimentary or factually attributing a quote

---

## Post 1 — The "all telcos are on notice" hook

**Publish:** Day 0 (publication day of the pillar article)

> "All telcos are on notice that their ID verification systems must not have vulnerabilities that scammers can target."
>
> That's ACMA Chair Nerida O'Loughlin, in February 2026, announcing the fifth telco penalty in twelve months.
>
> Lycamobile A$376,200. Optus Mobile A$826,320. Southern Phone A$2.5M. Telstra A$1.5M (plus A$626K under the Spam Act). Exetel A$694K. Circles.Life A$413K.
>
> Six different telcos. One audit finding repeated six times — a missing or bypassed identity-verification step at a customer-account-modification trigger point, exploited by a scammer.
>
> Then on 27 March 2026, ACMA rejected the Australian Telecommunications Alliance's draft consumer code for the second time. Industry self-regulation has been formally exhausted. ACMA is now drafting a mandatory standard.
>
> The Scams Prevention Framework Act commences 1 July 2026. Sixty-four days.
>
> I wrote a 3,000-word piece on what this means for every Australian telco except Telstra — which is the only one of them that builds, rather than buys, scam intelligence.
>
> Link in comments.
>
> #SPFAct #Telco #ScamPrevention

**Comment 1 (own thread):** https://askarthur.au/blog/spf-telco-readiness-1-july-2026

---

## Post 2 — The 7 April joint alert

**Publish:** Day 4

> Two regulators co-signed a single press release on 7 April 2026.
>
> The ACMA and the National Anti-Scam Centre — agencies that almost never share a byline — both put their names to a joint mobile fraud alert. The subject was SIM-swap and unauthorised account-change fraud. The instruction to consumers was to call IDCARE on 1800 595 160.
>
> Joint alerts are a small thing. Joint alerts after twelve months of identical-pattern enforcement are a much larger thing.
>
> What's actually happening: the regulator architecture for the Scams Prevention Framework is being completed in plain sight. ACMA at the telco layer. NASC at the consumer layer. ACCC as SPF General Regulator. AFCA — with its new Chief Scams Officer David Lacey, formerly of IDCARE, started 31 March — as the EDR scheme.
>
> Every Australian telco is now operating inside a four-regulator framework that did not exist twelve months ago. Three of those regulators have started speaking publicly with one voice.
>
> If you are a telco compliance lead and you have not yet read the 7 April alert with the eye of "this is the regulators rehearsing the SPF era" — read it again.
>
> #SPFAct #Telco #ScamPrevention

---

## Post 3 — The 1 July cliff edge

**Publish:** Day 8

> 1 July 2026. Three things happen simultaneously:
>
> 1. The Scams Prevention Framework Act commences. Maximum Tier 1 civil penalty is the greater of A$52.7M, three times benefit derived, or 30% of adjusted turnover.
> 2. The SMS Sender ID Register becomes mandatory. Unregistered alphanumeric sender IDs display as "Unverified" to recipients.
> 3. The Commonwealth penalty unit indexation under section 4AA of the Crimes Act takes effect. Every Commonwealth penalty including the SPF Tier 1 maximum changes value.
>
> If your compliance roadmap treats these as three separate workstreams, you are double-counting your engineering capacity. If your compliance roadmap treats them as one, you are probably wrong about which date matters most.
>
> The honest answer is that they are the same date because they were drafted to be the same date. Treasury, ACMA, and the Attorney-General's department co-ordinated the timeline. 1 July 2026 is when the regulatory cage closes.
>
> The cheapest version of compliance is the version that arrives early.
>
> #SPFAct #Telco #ScamPrevention

---

## Post 4 — Buyer not builder

**Publish:** Day 13

> Telstra is the only Australian telco that has built scam-intelligence intellectual property.
>
> Cleaner Pipes blocks ~10 million scam calls a month. Quantium Telstra (the JV with Quantium) sells Scam Indicator and Fraud Indicator to all four major banks — joint identity-fraud detection that lifts CommBank's detection rate by 25% for joint customers.
>
> Every other Australian telco is, structurally, a buyer.
>
> TPG buys Mavenir CallShield + SpamShield (19M calls / 213M SMS intercepted in H1 2024). TPG also deploys Apate.ai (280,000+ scam calls diverted, A$7.6M in customer losses prevented). Vocus has been Tollring's foundation customer since 2021. Optus is mid-leadership-rebuild and just paid the maximum ACMA penalty for an identity-verification gap.
>
> The smaller MVNOs and second-tier telcos — Aussie Broadband, Pivotel, Felix, the iiNet brand under TPG — do not have the budget to build. They will buy or they will be penalised.
>
> If you are anywhere in Australian telco except Telstra HQ, the question between today and 1 July 2026 is which vendor, for which SPF principle, with what evidence trail.
>
> The most expensive vendor decision in 2026 is the one that doesn't get made.
>
> #SPFAct #Telco #ScamPrevention

---

## Post 5 — Why a solo Australian founder is building this

**Publish:** Day 18

> A solo Australian technical founder built the SPF readiness stack the regulator is asking for.
>
> Not a bank. Not a defence prime. One person with a laptop, an Anthropic API key, sixteen threat feeds, and the conviction that Australian-hosted, zero-knowledge scam intelligence is going to be a regulatory floor by 1 July 2026.
>
> Seven consumer surfaces — web app, Chrome and Firefox extensions, iOS and Android, Telegram, WhatsApp, Slack, Messenger. Six B2B API endpoints. Sub-200ms p95 latency. Sub-A$0.001 marginal cost per check. Three-tier verdict: SAFE, SUSPICIOUS, HIGH_RISK.
>
> The architectural choice that matters most: zero-knowledge. No user accounts on the consumer side. PII scrubbed before storage. Every check re-derivable from the threat database without identifying who submitted it.
>
> That choice was made deliberately. A scam-detection product that holds Australian consumer data in cleartext is a regulatory asset and a national security liability simultaneously. The regulator does not yet require zero-knowledge, but it will.
>
> If you are at an Australian telco or bank thinking about your SPF Detect / Disrupt evidence trail, that's the architecture you want underneath your reasonable-steps defence.
>
> Twenty-minute demo at askarthur.au, or reply here.
>
> #SPFAct #Telco #ScamPrevention

---

## Post 6 — The IDCARE pivot

**Publish:** Day 25

> 4,000 organisations refer people to IDCARE in Australia. Less than a few hundred actually fund the service.
>
> That's not me — that's Professor David Lacey, IDCARE's founder, in his parting LinkedIn note in early 2026 before joining AFCA as inaugural Chief Scams Officer (started 31 March).
>
> Charlotte Davidson, IDCARE's new Group CEO, walked into a service that has carried the entire identity-fraud restoration burden for Australia and New Zealand for over a decade with a long tail of free riders.
>
> AskArthur was one of them. We reference IDCARE 1800 595 160 in every consumer surface. We have never paid IDCARE a cent.
>
> So we are setting that right. AskArthur is becoming a paid IDCARE subscriber, contributing anonymised threat data to IDCARE's Intelligence Profiling and Alerting team, and co-branding our HIGH_RISK referral pattern: "Detected by AskArthur, supported by IDCARE."
>
> The architecture of Australian scam response is becoming continuous. AskArthur at the verdict layer. IDCARE at the restoration layer. AFCA at the EDR layer under David Lacey from January 2027.
>
> If your organisation is a referrer and not a funder, set things right.
>
> #SPFAct #Telco #ScamPrevention

---

## Engagement strategy

- **Reply to every comment within 4 hours** in the first 24 hours of each post. LinkedIn's algorithm rewards reply density in the first day window.
- **Do NOT cross-post to Twitter/X.** Different audience, different cadence. If Twitter coverage is desired, write a separate threaded version with shorter sentence units.
- **Tag specific people only when factually attributing a quote.** Tagging O'Loughlin, Yorke, Lacey, or Davidson personally invites unwanted scrutiny if a fact is wrong; tagging organisations (ACMA, IDCARE, AFCA) is safer.
- **Do not respond to flame-bait.** If a Telstra or Optus employee comments defensively on Post 4, reply once with a factual correction (if any) and move on.
- **Aim for 3 of 6 posts to land in someone's TPG / Vocus / Optus / smaller-telco compliance lead's feed.** The point is not virality. The point is being recognisable to a buyer when the cold email arrives the following week.
