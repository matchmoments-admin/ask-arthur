# Australia's Economic Accelerator (AEA) — Seed Grant Application Narrative

**Important context (from verification):** Apate.ai was previously cited as an AEA grant precedent. **This is incorrect.** Apate.ai's A$2.5M raise was VC seed funding from OIF Ventures and Investible (August 2025), not an AEA grant. Apate is a Macquarie University spin-out, which means it is a _founder-spinout precedent_, not an _AEA precedent_. The AskArthur AEA narrative should rely on the academic-partnership criterion plus regulatory tailwind, not on Apate as comparator.

**Strategic posture:** AEA Seed is for university-research-to-commercialisation projects with a named university partner. AskArthur is currently a sole-director Pty Ltd with no formal academic partnership. The AEA application requires AskArthur to _first_ secure a partnership with a named Australian university research group, then apply jointly. The natural partner is **A/Prof Jerry Parwada at UNSW Business School** — finance / financial regulation focus, an existing IDCARE research collaborator, and now an IDCARE board director.

The application narrative below assumes that university partnership is in place. If the partnership is not yet secured, do NOT submit — secure the partnership first, then return to this narrative.

---

## Application narrative skeleton

### 1. The problem (~250 words)

Australians lost A$2.18 billion to scams in 2025 — a 7.8% increase on 2024 — according to the National Anti-Scam Centre's _Targeting Scams Report 2025_. Investment scams alone accounted for A$837.7 million. The median individual loss was A$400, but the long tail of losses runs into hundreds of thousands per victim.

The _Scams Prevention Framework Act 2025_ commences on 1 July 2026, with civil penalties of up to A$52.7 million per contravention or 30% of adjusted turnover, whichever is greater. Three sectors — banks, telecommunications providers, and digital platforms — face legally enforceable obligations across six principles, including a continuous obligation to generate Actionable Scam Intelligence (ASI) that supports a _reasonable belief_ that activity is or may be a scam.

The technical challenge is novel. ASI must be generated in real time, at population scale, across multiple input modalities (text, URL, image, QR code, voice), with multi-source enrichment, with PII scrubbing for privacy compliance, and with auditable evidence trails for the SPF reasonable-steps defence. No existing Australian-built platform meets all of these requirements simultaneously.

The Australian-research opportunity is to build the first sovereign, zero-knowledge, machine-learning-powered scam-intelligence pipeline that satisfies SPF compliance requirements while protecting individual Australian privacy. The commercial opportunity is to monetise this pipeline as a B2B Threat Intelligence API to the 200+ regulated entities entering the SPF designation cohort.

### 2. The university partnership (~200 words)

[University partner — assumed UNSW Business School, A/Prof Jerry Parwada]

A/Prof Parwada's research includes published scam-compliance modelling work using IDCARE case data (Australian Research Council Linkage Grant scheme). He is a member of the IDCARE Board and has direct visibility into Australia's victim-side data. The partnership combines AskArthur's production engineering capability with UNSW's academic rigour in scam-compliance modelling, victim psychology, and financial-regulation research.

The proposed research-to-commercialisation pathway addresses three open research questions:

1. _How can scam intelligence be generated and monetised at scale without creating a national-security or privacy liability?_ (Architectural research — zero-knowledge, PII-scrubbed pipelines.)
2. _What is the appropriate evidence-trail format for the SPF "reasonable steps" defence under multi-party EDR (AFCA from January 2027)?_ (Regulatory research — co-authored academic paper proposed.)
3. _How can community-sourced scam reports be cross-validated against threat-intelligence feeds with sufficient confidence to drive automated regulatory actions?_ (Machine learning research — multi-signal verdict model.)

The research outputs are commercially defensible IP for AskArthur and academically publishable contributions for UNSW.

### 3. The technology and milestones (~300 words)

AskArthur has shipped a production platform across eleven development phases, including seven consumer surfaces (Next.js web app, Chrome/Firefox extensions, iOS and Android apps, Telegram/WhatsApp/Slack/Messenger bots), six B2B API endpoints (OpenAPI 3.0), sixteen continuous threat-feed integrations, five external intelligence APIs (AbuseIPDB, HIBP, Certificate Transparency, Twilio Lookup, URLScan), and forty-four database migrations. Hosting is Australian (Supabase ap-southeast, Vercel Sydney edge). Architecture is zero-knowledge with PII scrubbing pre-storage. Marginal cost per check is sub-A$0.001.

The AEA-funded research extends this base in three milestones:

**Milestone 1 (Months 1–4): Reasonable-steps evidence-trail formalisation.** Co-authored academic paper with [UNSW partner] specifying a machine-readable evidence-trail format compatible with SPF reasonable-steps defence under AFCA EDR. Output: peer-reviewed publication submitted; AskArthur API endpoint extension exposing evidence-trail format to B2B customers.

**Milestone 2 (Months 5–8): Multi-signal verdict model with academic validation.** Statistical validation of AskArthur's three-tier verdict against IDCARE case data (under data-share agreement to be negotiated). Co-authored academic paper on cross-source confidence calibration. Output: Validated verdict accuracy figures publishable in peer-review and citable in B2B customer pitches.

**Milestone 3 (Months 9–12): Privacy-compliant population-scale pipeline.** Architectural research into provable zero-knowledge guarantees at scale, with cryptographic attestation of PII scrubbing. Output: Whitepaper plus open-source reference implementation for Australian regulated-entity adoption.

Each milestone produces (a) a peer-reviewed academic output, (b) a deployed AskArthur platform feature, and (c) a publicly verifiable artefact useful for SPF customer pitches.

### 4. The commercial path (~200 words)

AskArthur's revenue model is a tiered B2B Threat Intelligence API — Pro at A$2,000/month, Enterprise at A$5,000–A$15,000/month — sold to the 200+ regulated entities under SPF designation. Target customers in priority order: mid-tier ADIs and credit unions (where Big Four banks have built in-house tools but smaller institutions cannot), Australian telcos other than Telstra (TPG, Vocus, Optus, smaller MVNOs), and SPF-designated digital platforms.

The 1 July 2026 SPF commencement creates a structural floor of demand that does not depend on convincing customers that scams are a problem. The customer's question is not _whether_ to buy scam intelligence; it is _which vendor, for which SPF principle, with what evidence trail_.

AskArthur's competitive moat is fourfold: Australian-hosted with sovereign data residency; zero-knowledge architecture providing the privacy-by-design defence regulators will require; community-sourced threat data accumulating with every consumer check; and the academic-validated verdict accuracy this AEA grant will produce.

### 5. Use of grant funds (~150 words)

| Category                                       | Amount        | Purpose                                             |
| ---------------------------------------------- | ------------- | --------------------------------------------------- |
| Research engineer (12 months, 1.0 FTE)         | A$130,000     | Implementation of academic research milestones      |
| Academic partner top-up (UNSW, 0.2 FTE A/Prof) | A$40,000      | Co-authoring, peer review, conference presentations |
| Compute and infrastructure scale-up            | A$15,000      | AI inference, database scale, threat-feed expansion |
| Publication and conference fees                | A$5,000       | Peer-review submission costs, AISA/AusCERT/CommsDay |
| Independent academic review                    | A$10,000      | Privacy-architecture audit by external academic     |
| **Total**                                      | **A$200,000** |                                                     |

Co-contribution from AskArthur: in-kind founder time (sole director, technical lead) and existing infrastructure costs not allocated to this project.

### 6. Why now and why us (~150 words)

Three time-locked windows converge in 2026: the SPF Act commencement (1 July), the SMS Sender ID Register enforcement (1 July), and the AFCA EDR scheme commencement (1 January 2027). The first SPF prosecutions will occur within twelve months of commencement. The vendors that arrive at those prosecutions with academically validated, regulator-aligned evidence trails will define the market.

AskArthur is uniquely positioned: production platform shipped, sovereign architecture, founder-led, capital-efficient, and now seeking a structured academic partnership to formalise the research substrate of the SPF compliance market. Without AEA support, AskArthur will pursue this work without academic validation — slower, less rigorous, and less defensible to enterprise procurement panels. With AEA support, the research arrives in market alongside the regulation.

---

## Pre-submission checklist for Brendan

- [ ] **Confirm UNSW partnership in writing.** Email Jerry Parwada at jerry.parwada@unsw.edu.au with a one-page proposal. Wait for written confirmation before drafting the full application. Do not submit without a named, willing partner.
- [ ] **Verify current AEA round dates.** Check education.gov.au directly for current AEA Seed grant round timing as of late April 2026. The application skeleton above assumes a 12-month project window and a A$200K total budget — adjust to actual round terms.
- [ ] **Remove all references to Apate.ai as AEA precedent.** Apate is a VC-funded comparator, not an AEA precedent.
- [ ] **Get the academic-partnership IP and revenue-sharing terms right before signing.** AEA grants typically require IP ownership clarity. AskArthur's existing IP is wholly owned by the Pty Ltd. Any new research IP from the grant should be jointly owned per AEA conditions, with a commercialisation licence to AskArthur.
- [ ] **Co-ordinate with the Davidson IDCARE conversation.** Parwada is on the IDCARE board. Davidson should know about the AskArthur–UNSW partnership before it lands publicly. Mention it explicitly in the second IDCARE meeting.
