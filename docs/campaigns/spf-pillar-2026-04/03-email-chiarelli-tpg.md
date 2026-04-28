# Email B — Giovanni Chiarelli, Group CTO, TPG Telecom

**To:** Giovanni Chiarelli, Group CTO, TPG Telecom
**Cc:** Enver Singh, Head of Cyber Security, TPG Telecom
**Send method:** LinkedIn InMail to Chiarelli first (he is publicly active on LinkedIn from the Mavenir release). If no response in 7 days, email via TPG's investor-relations channel asking to be routed to Group CTO.

**Subject:** SPF ASI generation: complementary verdict layer above CallShield/SpamShield

---

Hi Giovanni,

Reading the Mavenir CallShield/SpamShield deployment numbers again this week — 19 million calls and 213 million SMS intercepted in H1 2024, 280% increase in fraudulent calls blocked since deployment — and the Apate.ai diversion stats (280,000+ scam calls diverted from TPG, 20,000+ impersonated organisations identified, A$7.6 million in customer losses prevented) — TPG is, by some distance, the most public-record-evidenced _buyer_ of scam intelligence among Australian telcos.

I lead AskArthur, an Australian-built scam-intelligence platform. I am writing because there is a specific gap I think we close, and the timing is short.

**The gap:** CallShield and SpamShield operate at the network layer. Apate.ai operates at the conversation layer. Neither sits at the _content layer_ — the inbound message, link, image, or QR code that arrives in a TPG, Vodafone, iiNet, or Felix customer's hand and is the actual trigger for a scam decision. With the _Scams Prevention Framework Act_ commencing 1 July 2026 and ACMA's mandatory industry standard now in motion (after the 27 March 2026 rejection of the ATA's draft TCP Code), the obligation to generate **Actionable Scam Intelligence** at the content layer — including time-bound _immediately_ obligations under Prevent and Detect — sits unowned in most Australian telco architectures. That is the gap AskArthur fits.

**The fit:** AskArthur returns a three-tier SAFE / SUSPICIOUS / HIGH_RISK verdict on submitted text, URL, image, or QR code in under 200ms p95, at sub-A$0.001 marginal cost per check. Six API endpoints expose URL lookup, batch entity screening (up to 500 per request), trending scam types by region, cluster detection for coordinated campaigns, and government-export views aligned to NASC reporting categories. Sixteen threat feeds are ingested continuously; five external intelligence sources (AbuseIPDB, HIBP, Certificate Transparency, Twilio Lookup, URLScan) enrich every entity. Australian-hosted (Supabase ap-southeast, Vercel Sydney edge). Zero-knowledge architecture, PII scrubbed before storage.

**The complementary positioning, in one sentence:** Mavenir tells you the call is a scam call; Apate ties up the scammer; AskArthur tells your customer-facing surface — the iiNet support agent, the Vodafone IVR, the Felix in-app notice — what the inbound message _means_ and what the customer should do next. Same regulatory framework, three different layers, no overlap.

**The proposal:** A 90-day evaluation pilot scoped to one or two TPG consumer brands (Vodafone or iiNet most natural, given the scam-and-fraud engineering build-out you have advertised — I noticed the Senior Engineer — Scam and Fraud Management role and the Principal Architect requisition focused on scam and fraud across voice and messaging). Pricing for the pilot is A$2,000/month flat, scaled to volume only on conversion. We can run it as a private API integration, an embedded SDK, or a white-labelled verdict module — whichever matches your engineering posture. Three flagged messages from your trust-and-safety team's last fortnight is enough to demonstrate the fit. You bring the messages; we walk through what AskArthur returns; if the verdict layer is useful, we scope; if not, no further conversation.

I am also conscious that TPG was a contributing participant in the NASC Investment Scam Fusion Cell and that the iiNet incident in August 2025 has shaped what your trust-and-safety team is being asked to demonstrate — both internally to the board and externally to ACMA. The _evidence trail_ for ACMA, AFCA (under David Lacey's new Chief Scams Officer role from 31 March 2026), and any subsequent SPF prosecution is, in my view, going to be the single hardest thing to retrofit. AskArthur generates the audit artefact as a side-effect of every check.

Twenty minutes when your diary allows. If the framing is wrong, I would also value the feedback — TPG's view on what content-layer ASI should look like would shape how we build for the rest of the sector.

Best,

Brendan Milton
Founder, AskArthur Pty Ltd
ABN 72 695 772 313
brendan@askarthur.au
askarthur.au

---

## Implementation notes for Brendan

- **Channel choice.** Chiarelli is publicly quoted on LinkedIn from Mavenir releases and engages with telco-tech posts. LinkedIn InMail is more likely to land than a generic TPG inbox. Connect _first_ with a one-line note ("Read your CallShield comments — would value 20 minutes to discuss content-layer SPF readiness"), then send the InMail body if accepted within 7 days.
- **Cc Enver Singh.** Confirmed Head of Cyber Security at TPG. Public LinkedIn. The cc is deliberate — cyber-security and CTO own different parts of the SPF readiness conversation, and putting them on the same thread saves the organisation a meeting.
- **Do NOT mention the iiNet breach in the opening lines.** It is referenced once, late in the email, in the context of _evidence trail_ — which is a forward-looking framing, not a reputational one. Treat the breach as fact, not weapon.
- **The Apate.ai naming is intentional and friendly.** Apate is a peer not a competitor — same venture ecosystem (OIF/Investible), complementary technology (conversation-layer vs content-layer). Naming Apate signals AskArthur understands the existing stack and is not trying to displace it.
- **Pricing.** A$2,000/month flat for the pilot is the published Pro tier. Do not negotiate down in the opening email. If TPG counters at A$0 / free pilot, accept _only_ on a 60-day cap with a written conversion-rate commitment.
- **Follow-up cadence.** If no response in 10 days, send a single LinkedIn message: "Just checking this didn't get lost — happy to wait if timing is bad." Then leave it. CommsDay Summit on 2–3 June 2026 is the natural in-person fallback if Brendan attends.
- **What NOT to say.** Do not claim TPG specifically _needs_ AskArthur. TPG has Mavenir and Apate. The pitch is _complementary_, not _replacement_. Any language that reads as displacing existing vendors will close the conversation.
