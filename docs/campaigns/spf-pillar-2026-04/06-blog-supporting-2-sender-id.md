# The SMS Sender ID Register goes live in sixty-four days. Here's what most CIOs still get wrong

If you are a CIO at an Australian telco, bank, government agency, or any business that sends SMS using an alphanumeric sender ID, the _Telecommunications Amendment (SMS Sender ID Register) Act 2024_ has been in force since 6 March 2025, and the operational deadline is 1 July 2026. From that date, alphanumeric sender IDs sent to Australian mobile numbers must be registered with ACMA's SMS Sender ID Register, or they will be displayed to recipients with an _Unverified_ tag. Non-participating telcos cannot send, transit, or terminate sender ID messages at all.

Sixty-four days from today, this changes how every Australian sees brand-name SMS. And there are still several misconceptions in the market that will produce avoidable Day-1 outages and customer-service crises. Here are the ones I see most often.

> **Key takeaways**
>
> - The SMS Sender ID Register becomes mandatory 1 July 2026. Unregistered alphanumeric sender IDs will display as "Unverified" on every customer's phone.
> - The hard deadline is 1 July 2026, not December 2025 (which was the standard's commencement, not the operational deadline).
> - The Register operates at the _carriage_ level — register every alphanumeric sender ID on every aggregator route, not just the brand name.
> - The Register reduces alphanumeric impersonation, but does not stop SMS scams from numeric sender IDs.
> - 1 July 2026 is the convergence date for three regulatory regimes — SPF Act commencement, Sender ID Register enforcement, and penalty unit indexation.

## Misconception 1: "It is voluntary"

This is the most expensive misconception. The Register itself is administratively voluntary, in the sense that there is no direct fine for an unregistered business. But the _enforcement mechanism_ is built into the carrier compliance chain. Telcos that participate are required to display _Unverified_ on unregistered messages and, in time, to block or down-rank unregistered traffic entirely. Telcos that do not participate are excluded from sender ID messaging.

What this means in practice: from 1 July 2026, your customer's phone will display your transactional SMS — the password reset, the appointment reminder, the 2FA code — with the word _Unverified_ attached, unless you have registered. Your churn risk and your inbound support volume will both move on day one.

## Misconception 2: "We have until December 2025"

This was the original timeline. The standard onboarding window opened in mid-October 2025 for telcos and late November 2025 for businesses. The 15 December 2025 milestone was the date the standard commenced _in full_ — not the date by which businesses had to be registered. The operational hard deadline is 1 July 2026.

If your team's compliance document still says "December 2025" in the active timeline, it is reading from the standard's commencement schedule rather than the operational schedule. Update it.

## Misconception 3: "We just need to register the brand name"

The Register operates at the _carriage_ level. You register your sender ID strings — the actual alphanumeric tokens that appear on a recipient's phone — and you register the relationship between those strings and the carrier or aggregator that sends them on your behalf. If you use multiple aggregators (and most enterprise SMS senders do), each pathway needs to be registered. If you use a marketing-automation tool that routes through a different aggregator than your transactional traffic, that is two pathways.

The audit point is not "is _Westpac_ registered." The audit point is "is _every alphanumeric sender ID Westpac uses, on every aggregator route Westpac uses_ registered."

## Misconception 4: "It's an ACMA problem"

The Register is run by ACMA. The penalty is loss of telecommunications-carriage privileges. But the _consumer-facing_ impact lands on your support team, your communications team, and your CIO. From 1 July 2026, the same support agent who handles a "did you really send me this?" call will be answering "why does my Westpac SMS say _Unverified_?" The script for that call needs to be written before 1 July, not after.

## Misconception 5: "It will stop SMS scams"

It will reduce them, materially. It will not stop them. The Register addresses _alphanumeric sender ID spoofing_ — the technique scammers use to make an SMS appear to come from a legitimate brand name. It does not address scams sent from numeric mobile numbers, which is the larger volume category. It does not address links in legitimate-looking SMS that lead to scam landing pages. It does not address the _content_ of any message at all.

The _Targeting Scams Report 2025_ from the National Anti-Scam Centre records A$2.18 billion in reported losses in 2025 — up 7.8% from 2024. SMS scams make up a significant portion of that figure. The Sender ID Register is one tool. It will move the needle on alphanumeric impersonation. It will not eliminate the category.

## What the Register interacts with

This is the part that most compliance roadmaps under-weight. From 1 July 2026, three regulatory regimes converge:

- **The Sender ID Register** comes into mandatory enforcement.
- **The _Scams Prevention Framework Act 2025_** commences, with Tier 1 civil penalties of up to A$52.7 million per contravention (or 30% of adjusted turnover, whichever is greater).
- **The penalty unit indexation** under section 4AA of the _Crimes Act 1914_ takes effect, lifting the dollar value of every Commonwealth penalty unit.

The same week these all land, ACMA will be drafting the binding industry standard that replaces the rejected ATA TCP Code (rejected 27 March 2026). AFCA's new Chief Scams Officer, David Lacey, is in place from 31 March 2026 and is building the world's first multi-party EDR scheme for scams.

If your SMS architecture is not registered on 1 July, it is the easiest possible compliance failure for a regulator to find. It is also the most visible to customers. There is no upside to being late.

## What to do this quarter

Two things, in order.

**Run a complete inventory of your alphanumeric sender ID usage.** For every brand string your business sends from, identify the carrier, the aggregator, the system of origin (CRM, marketing automation, transactional API), and the registration status. The likely surprise is that you use more strings than you think — historic legacy strings, regional variations, A/B test strings, and brand acquisitions are all common gaps.

**Decide on the customer-communication script for the _Unverified_ edge case.** Even if your registration is perfect, some legitimate messages will display as _Unverified_ in the first weeks of operation, particularly for less common sender IDs. Your customer-service team needs a one-paragraph script that explains the change, reassures the customer, and routes them to the correct channel. Write it now, not in July.

If your scam-detection layer needs upgrading at the same time as your Sender ID registration — as it does for most Australian businesses with consumer-facing SMS — AskArthur's Threat API integrates as a content-layer verdict module that returns SAFE / SUSPICIOUS / HIGH_RISK on URL, text, image, or QR code in under 200ms. Six API endpoints, sixteen threat feeds, sub-A$0.001 marginal cost per check, Australian-hosted.

You can reach me at brendan@askarthur.au or book twenty minutes via askarthur.au.

## FAQ

**Is the Register mandatory?**
Administratively voluntary, operationally mandatory. The Register itself has no direct fine for non-registration, but the _enforcement mechanism_ is built into the carrier compliance chain. Telcos that participate display "Unverified" on unregistered messages and, in time, can block or down-rank unregistered traffic. Telcos that don't participate are excluded from sender ID messaging entirely.

**What about messages from numeric mobile numbers?**
Out of scope. The Register addresses alphanumeric sender ID spoofing only. Scams from numeric mobile numbers remain a separate problem (and a larger volume category) — they're addressed by ACMA's existing anti-scam standard and the SPF Act's Detect principle, not by the Register.

**We use multiple aggregators. Do we register every route?**
Yes. The audit point is "every alphanumeric sender ID on every aggregator route" — not just the brand name. Marketing-automation traffic on a different aggregator from transactional traffic counts as two separate pathways.

**What happens to legitimate messages that display as "Unverified"?**
Even with perfect registration, some edge-case sender IDs may display "Unverified" in the first weeks of operation, particularly for less common strings. Customer-service script for the inbound calls should be drafted before 1 July, not after — see the body of this post for the exact language.

**Does this affect international SMS to Australian numbers?**
Yes. Any alphanumeric sender ID _to_ an Australian mobile number must be registered, regardless of where the message originates. Non-participating overseas carriers cannot transit or terminate sender ID messages to Australian recipients.

---

_Brendan Milton is the founder of AskArthur. AskArthur Pty Ltd, ABN 72 695 772 313._

_Sources: ACMA SMS Sender ID Register consultation paper (acma.gov.au/sites/default/files/2025-03/ACMA SMS sender ID register_consultation paper.pdf); Telecommunications Amendment (SMS Sender ID Register) Act 2024 (aph.gov.au); Twilio compliance guide (twilio.com/en-us/blog/insights/australia-sender-id-register); NASC Targeting Scams Report 2025 (nasc.gov.au/system/files/targeting-scams-report-2025.pdf); ACMA TCP Code rejection (acma.gov.au/articles/2026-03/acma-replace-telco-consumer-code-stronger-protections); AFCA Chief Scams Officer announcement (afca.org.au)._
