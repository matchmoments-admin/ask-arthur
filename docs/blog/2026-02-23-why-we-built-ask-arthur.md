If you live in Australia, you've almost certainly received a dodgy text this week. A fake toll notice from "Linkt", a parcel delivery you never ordered, a message from "myGov" threatening to suspend your account. You're not imagining it — it really is getting worse.

Australians lost more than **A$2 billion to scams in 2024**. Behind that headline, the trend is uglier: scam _reports_ have started to plateau, but **average losses per victim are climbing**. Scammers aren't sending more messages — they're getting better at the ones they send.

That's the gap Ask Arthur was built to close. Here's why we did it, what the platform actually does, and how it fits with everything else Australia is now building to push back against scams.

---

## What's actually changed

The shape of the problem in 2026 is different from the shape of the problem in 2022.

**Breach data has commoditised personalisation.** Optus (2022), Medibank (2022), Latitude (2023), MediSecure (2024), Qantas (2025). The personal details criminals used to fake on a guess — your first name, your suburb, your driver's licence number — are now bulk-purchasable. The new generation of scams arrives with your real details baked in.

**AI has industrialised the writing.** The grammatical mistakes that used to flag a scam are gone. Modern phishing emails read like competent professionals wrote them, because, in effect, the LLM did. The "spot the typo" defence is dead.

**Social-platform scams have outpaced bank-channel scams.** Investment scams via Instagram. Marketplace fraud via Messenger. Deepfake celebrity ads via Facebook feed. These don't start where banks can see them; they start where the bank gets the _result_, after the click that led there.

> [!DANGER]
> The 2025 _Targeting Scams_ report from the National Anti-Scam Centre confirms phishing as one of Australia's **highest-loss scam categories**, with social-media-originated scams the fastest-growing channel. Average loss per victim has now passed five figures for several scam types — and the recovery rate, once funds have moved, is a fraction of that.

Australia's response — the Scams Prevention Framework Act 2025, the SMS Sender ID Register, AFCA's new Chief Scams Officer, the Scam-Safe Accord across the major banks — is real, world-leading, and specifically designed for _this_ shape of problem. But the legislation works at the institutional layer. It doesn't help you, sitting at your kitchen table, decide whether the SMS in your hand is real.

---

## The gap nobody was filling

Australia had no consumer-first, Australian-made tool that could look at a message and tell you in seconds whether it was a scam.

Scamwatch is excellent at _aggregating_ reports — but it's a reporting flow, not a real-time check. Your bank's fraud line catches transactions, not the click before them. Norton and Kaspersky build for the US market and don't know about Linkt, myGov, the ATO, or any of the brand-impersonation patterns that target Australians specifically. Generative-AI tools can write _new_ scams faster than they can catch them.

The thing missing was the front-of-screen check. _"I've just received this message. Is it real?"_

So we built one.

---

## What Ask Arthur actually does

The product is dead simple by design. Three surfaces, one job.

- **Web app at askarthur.au.** Paste any suspicious message, URL, screenshot, or QR code. Get a verdict in five seconds — SAFE, SUSPICIOUS, or HIGH_RISK — with a plain-English explanation. No signup. No account. No data stored.
- **Chrome extension.** Sits quietly while you scroll Facebook, Instagram, Marketplace, Messenger. Flags scam ads, scores Marketplace sellers, catches PayID scam patterns in real time, audits your other browser extensions for security risks. Free.
- **Mobile app (Android + iOS).** Screenshot any message and run it through the same engine. Particularly useful for the _"is this real?"_ moment that hits while you're standing in a queue.

> [!WARNING]
> Ask Arthur **never reads your private DMs** and **never stores your messages**. Detection runs locally in your browser or on your device for everything except threat-feed lookups against public domain reputations. We don't sell data, we don't track which sites you visit, and we don't keep your browsing history. The business model is enterprise threat-intel licensing — not your inbox.

Under the hood, Ask Arthur combines Anthropic's Claude AI with sixteen Australian and international threat-intelligence feeds and our own scam-pattern database trained on real Australian impersonation campaigns — Linkt, myGov, the ATO, Australia Post, the major banks, the celebrity-investment-ad style. The product knows what an Australian scam looks like because it was built for that target.

---

## Why the name

We wanted something that felt like a trusted mate — someone you'd actually turn to when something felt off. Not a corporate security product. Not a government acronym. A straight-talking friend who happens to know a lot about scams and will tell you the truth in plain English.

Like any good mate, Arthur doesn't collect what he doesn't need. The privacy posture is built into the architecture, not bolted on as a marketing line. Free for individuals. Forever. Funded by the enterprise side, where banks, telcos, and platforms pay for the same threat intelligence to embed in their own pipelines.

---

## What's coming next

The launch is the floor, not the ceiling.

> [!TIP]
> The fastest way to help right now is to **install the Chrome extension on a parent's or grandparent's computer**. People over 65 lose more to scams than any other age group, and the protection runs silently behind the platforms they already use. Two minutes of your time saves a fortnight of cleanup later.

Three things on the near roadmap:

- **Community reporting.** Flag a scam you've spotted and it joins the threat-intel feed protecting every other Australian using the platform. Your single report becomes everyone else's warning.
- **Weekly Australia-specific scam alerts.** Published right here on the blog. The patterns that are surging this week, the brands being impersonated, the specific phone numbers and domains to look out for.
- **Threat-intel API for banks, telcos, and platforms.** The same engine, embedded into their own decision pipelines so the protection lands at the institutional layer too — at sub-A$0.001 marginal cost per check, fully Australian-hosted, and with the audit-trail evidence the SPF Act's _reasonable steps_ defence will demand.

If you're at a regulated entity that's working through SPF compliance, the conversation is at askarthur.au or brendan@askarthur.au. If you're an individual who'd like to be notified when the mobile app or community reporting goes live, drop your email at askarthur.au — we don't spam.

---

## How you can help

The single most useful thing you can do today: try Arthur with a real suspicious message and share it with someone you care about. Your mum, your nan, your mate who keeps clicking on things. Scam awareness alone hasn't worked — even cybersecurity experts get caught out (Troy Hunt, who built _Have I Been Pwned_, fell for a phishing attack in 2025). Tools work better than awareness because they remove the moment of doubt.

Welcome to Ask Arthur. Let's make scammers' lives harder, together.

---

_If you've already lost money to a scam, contact your bank's fraud line first, then call IDCARE on 1800 595 160 for free identity-recovery support and report to Scamwatch on 1300 795 995. Acting quickly is the single biggest factor in what's recoverable._

_Ask Arthur is Australia's friendly scam-detection companion, built locally with Australian threat intelligence. For more guides and real-time alerts, visit askarthur.au._
