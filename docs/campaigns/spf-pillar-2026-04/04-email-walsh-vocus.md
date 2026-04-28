# Email C — Matt Walsh, Chief Customer Officer, Vocus

**To:** Matt Walsh, Chief Customer Officer, Vocus
**Routing:** Two-step. First request: ask Charlotte Davidson at IDCARE for a warm introduction to Matt Walsh, on the basis of Vocus's existing IDCARE referral relationship from the October 2025 Dodo breach. If the IDCARE intro is not viable within 30 days, send directly via LinkedIn InMail (Walsh is on LinkedIn at au.linkedin.com/in/mattjwalsh).
**Subject (warm intro version):** Introduction from Charlotte Davidson — content-layer scam intelligence for Dodo / iPrimus / Commander
**Subject (direct version):** Building on the IDCARE relationship: content-layer scam intelligence for Vocus retail brands

---

Hi Matt,

Charlotte Davidson at IDCARE suggested I reach out — Vocus's existing IDCARE engagement from the October 2025 Dodo / iPrimus incident is the natural starting point for what I want to propose.

I lead AskArthur, an Australian-built scam-intelligence platform. The 17 October 2025 Dodo breach — 1,600 email accounts compromised, 34 unauthorised SIM swaps reversed, IDCARE engaged for customer restoration — sits exactly at the harm pattern that the 7 April 2026 joint ACMA + NASC alert is now warning consumers about, with the _Scams Prevention Framework Act_ commencing 1 July 2026 and ACMA's mandatory industry standard now in motion (after the 27 March rejection of the ATA's draft TCP Code).

Vocus has been forward-leaning on scam protection at the network layer. The Tollring Scam Protect deployment from 2021 made Vocus Tollring's foundation customer in Australia. The October 2025 incident response — particularly the speed of the SIM-swap reversal and the IDCARE referral path — was, in my reading of the public record, considerably better than what we have seen from larger telcos in similar incidents.

What I would like to propose is the missing layer: **content-layer scam intelligence for Vocus's retail brands** — Dodo, iPrimus, Commander.

**The gap:** Tollring filters at the network. CallShield-style services (which competitors deploy) filter at the call layer. Neither catches the inbound _message_ — the SMS or email that lands in a Dodo customer's inbox, looks like a Vocus account notice, and triggers the credential entry that enables the next breach. From 1 July 2026, Vocus's SPF obligations include content-layer Detect — forming a _reasonable belief_ that a message is or may be a scam, in time to act.

**What AskArthur is:** A three-tier verdict (SAFE / SUSPICIOUS / HIGH_RISK) on text, URL, image, or QR code, returned in under 200ms p95, at sub-A$0.001 marginal cost per check. Six API endpoints, sixteen threat feeds, five external intelligence integrations (AbuseIPDB, HIBP, Certificate Transparency, Twilio Lookup, URLScan). Australian-hosted, zero-knowledge architecture, PII scrubbed before storage. Designed to integrate as a private API, an embedded SDK, or a white-labelled verdict module inside Vocus's existing customer-facing channels.

**The proposal:** A 90-day evaluation pilot at A$2,000/month flat, scoped to one Vocus retail brand. Dodo is the most natural — given the breach context — but iPrimus or Commander are also options. We integrate as an API call from your existing customer-service tooling or as an embedded check in the Dodo app. Three real flagged messages from the last fortnight is enough to demonstrate fit.

The integration with IDCARE matters for two reasons. First, AskArthur already references IDCARE 1800 595 160 in our consumer surfaces and is currently formalising a paid subscriber arrangement and a co-branded referral pattern with Charlotte's team. Second, David Lacey moved to AFCA on 31 March 2026 as inaugural Chief Scams Officer, which means the IDCARE → AFCA → SPF EDR pathway is now one continuous chain. A Vocus pilot that produces verdict-layer evidence inside that chain is significantly stronger evidence for ACMA and AFCA than any single-vendor stack alone.

Twenty minutes when your diary allows. I am Sydney-based and happy to travel to Perth or Melbourne for an in-person if it helps.

Best,

Brendan Milton
Founder, AskArthur Pty Ltd
ABN 72 695 772 313
brendan@askarthur.au
askarthur.au

---

## Implementation notes for Brendan

- **The IDCARE warm intro is contingent on the Davidson email landing first.** Sequence: send Davidson email; receive acknowledgement; in the second meeting with IDCARE, request the Walsh intro explicitly. Do NOT send this email cold to Walsh until either (a) Davidson has agreed to make the intro, or (b) 30 days have passed with no IDCARE traction and the direct LinkedIn route is justified.
- **Date precision matters.** The Dodo breach was 17 October 2025 (not 2024 — that was an earlier draft error). 1,600 emails and 34 SIM swaps are the verbatim Vocus spokesperson numbers. Do not round.
- **Tollring 2021 is a credibility marker, not a sales attack.** The opening paragraph praises Vocus's existing posture — that is deliberate. Walsh is a long-tenured Vocus operator (Perth-based, listed as CCO with WHS responsibility). He will respond to genuine recognition of Vocus's network-layer history before he responds to any pitch.
- **Brand naming.** Dodo first because of the breach context. Then iPrimus (consumer broadband), then Commander (small business). Do NOT propose Vocus enterprise / wholesale fibre — that is a different procurement path and not the right entry point.
- **Pricing.** A$2,000/month is the published Pro tier. If Walsh proposes free in exchange for a case study, accept on a 60-day cap with a contractual commitment to convert at A$2,000/month if pilot KPIs are met.
- **What NOT to say.** Do not propose displacing Tollring. The pitch is content-layer, complementary to network-layer. Any language that reads as displacing Tollring will trigger an internal procurement review and slow the conversation by months.
- **Follow-up cadence.** If no response in 14 days from the warm intro, send one chase line through the same channel ("Hi Matt — wanted to make sure this didn't get lost"). Then leave it for 60 days. The October 2025 breach anniversary (October 2026) is the natural re-engagement window if the first attempt does not convert.
