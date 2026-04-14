# Ask Arthur -- Enterprise Sales Materials

Generated April 2026. All claims labelled: [Data] = verifiable from legislation/public docs, [Estimate] = projected timelines/ROI, [Assumption] = prospect status or intent.

---

## 1. Bank Outreach Email -- Bendigo Bank

**To:** Jason Gordon, Head of Customer and Threat Protection, Bendigo Bank
**Subject:** SPF Detect obligation -- cross-sector threat intelligence for mid-tier ADIs

Jason,

Bendigo has 77 days until the Scams Prevention Framework takes effect [Data]. The Detect principle requires "internal detection mechanisms" plus consumption of "Actionable Scam Intelligence" from external sources [Data]. Tier 1 penalties reach A$52.7 million or 30% of adjusted turnover [Data].

The Big Four are building in-house. Mid-tier ADIs face the same obligation without the same budget [Assumption].

Ask Arthur provides a production-ready Threat Intelligence API purpose-built for SPF compliance. Six endpoints deliver trending scam types by region, entity risk scores (phone, URL, email, IP, BSB), batch lookups for transaction screening, and WHOIS/SSL enrichment -- all PII-scrubbed, Australian-hosted, and available today [Data].

We are pre-revenue with a production-ready platform across 11 development phases [Data]. I would like to offer Bendigo a 4-week proof-of-concept pilot at no cost -- scoped to your fraud operations team, integrated via API key in under a day.

Would 20 minutes next week work to walk through the API and discuss scoping?

Brendan Milton
Founder, Ask Arthur
hello@askarthur.au | askarthur.au

---

## 2. Bank Compliance Map -- SPF Obligations

| SPF Principle | Banking Obligation [Data] | Ask Arthur Capability [Data] | API Endpoint | Notes |
|---------------|--------------------------|------------------------------|-------------|-------|
| **Prevent** | Consumer warnings about scam risks; Confirmation of Payee | Consumer scam checker (7 surfaces) provides real-time warnings; entity lookup enables payee verification against known scam accounts | `GET /entities/lookup` (type=bank_account) | Payee check requires bank to pass BSB/account to API for known-scam match |
| **Detect** | Internal scam detection mechanisms; consume external Actionable Scam Intelligence (ASI) | 16 threat feeds + 5 external enrichment APIs; trending threats by region; entity risk scoring (0-100) with risk factors breakdown | `GET /threats/trending`, `GET /threats/stats`, `GET /entities/lookup` | Region filter supports state-level detection (e.g. `?region=VIC`) |
| **Report** | Report ASI to ACCC within 24 hours; share intelligence cross-sector | Government-ready export views (4 views); provider reporting infrastructure; structured data aligned to Scamwatch categories | Export RPCs: `get_threat_intel_export` | Data structured for NASC/Scamwatch ingestion [Data] |
| **Disrupt** | Block scam accounts; freeze mule accounts; payment recall | Entity intelligence with risk scores enables blocking decisions; batch lookup screens multiple entities per request (up to 500 at Enterprise tier) | `POST /entities/batch` | Bank makes blocking decision; Ask Arthur provides intelligence input |
| **Respond** | Internal dispute resolution; 30-day compliance statements; AFCA complaints (from Jan 2027) | Audit trail via scan results, entity intelligence, and timestamped report history | `GET /entities/{id}` | Full entity detail with verdict distribution and cluster membership |
| **Govern** | Governance policies; annual senior officer certification | API usage dashboard with per-endpoint breakdowns; structured evidence for compliance certification | `GET /usage` | Usage stats provide auditable evidence of ASI consumption |

---

## 3. Telco Outreach Email -- Optus

**To:** Matt Williams, MD Customer Solutions, Optus
**Subject:** SMS Sender ID Register + SPF Detect -- scam content intelligence for ScamWise

Matt,

The Australian Sender ID Register is now mandatory and the SPF Detect obligation for telcos commences 1 July 2026 [Data]. Optus must monitor calls and texts for scam indicators and verify sender IDs [Data]. ScamWise already demonstrates Optus's commitment to this space [Assumption].

The gap: Sender ID verification catches impersonation of known brands, but does not detect novel scam content in message bodies. The SPF requires both [Data].

Ask Arthur's Threat Intelligence API fills that gap. Our platform analyses scam content in real time using Claude AI, enriched by 16 threat feeds and 5 external intelligence sources [Data]. Six API endpoints provide trending scam types, URL/phone/domain risk scores, batch entity screening (up to 500 per request), and WHOIS/SSL intelligence -- all Australian-hosted [Data].

We are pre-revenue with a production-ready platform [Data]. I would like to propose a scoped pilot alongside ScamWise -- integrating our batch entity lookup into your SMS filtering pipeline for a 4-week evaluation.

Could we schedule a call to discuss how this maps to your SPF readiness programme?

Brendan Milton
Founder, Ask Arthur
hello@askarthur.au | askarthur.au

---

## 4. Telco Compliance Map -- SPF Obligations

| SPF Principle | Telco Obligation [Data] | Ask Arthur Capability [Data] | API Endpoint | Notes |
|---------------|------------------------|------------------------------|-------------|-------|
| **Prevent** | Verify sender IDs via Australian Sender ID Registry; warn consumers | Consumer scam checker across 7 surfaces; phone intelligence with carrier, line type, VoIP detection via Twilio Lookup | `GET /entities/lookup` (type=phone) | Complements Sender ID Registry with content-level scam detection |
| **Detect** | Monitor calls/texts for scam indicators; detect scam content patterns | Trending scam types by period and region; entity risk scoring (phone, URL, email, IP); 16 threat feeds with automated ingestion | `GET /threats/trending`, `POST /entities/batch` | Batch lookup screens phone numbers and URLs extracted from SMS at scale |
| **Report** | Report ASI to ACCC within 24 hours; share intelligence cross-sector | Government export views (4 views); provider reporting RPCs; Scamwatch-aligned categories | Export RPCs: `get_threat_intel_export`, `submit_provider_report` | Structured for NASC reporting requirements [Data] |
| **Disrupt** | Block confirmed scam numbers; take down scam content | Phone and URL entity intelligence with risk levels (LOW/MEDIUM/HIGH/CRITICAL); cluster detection identifies coordinated campaigns | `GET /entities/{id}`, `GET /clusters`, `GET /clusters/{id}` | Cluster data reveals multi-entity scam campaigns sharing infrastructure |
| **Respond** | Internal dispute resolution; compliance documentation | Timestamped entity history; verdict distribution per entity; usage audit trail | `GET /entities/{id}`, `GET /usage` | Provides evidence trail for dispute resolution |
| **Govern** | Governance policies; annual certification | API usage dashboard; structured compliance evidence | `GET /usage` | Per-endpoint usage tracking for audit purposes |

---

## 5. Government One-Pager -- NASC/ASD Partnership Application

### Ask Arthur: Sovereign Scam Intelligence for Australia

**Problem**

Australians lost $2.18 billion to scams in the past year [Data]. AI-generated scams are escalating faster than existing defences can adapt. The Scams Prevention Framework Act 2025 mandates cross-sector intelligence sharing, but no platform currently connects banks, telcos, and digital platforms into a unified threat picture [Data]. Scamwatch relies on manual reporting with no real-time verdict capability [Data]. The 200+ regulated entities facing SPF obligations from 1 July 2026 need external intelligence sources to meet their Detect and Report obligations [Data].

**Solution**

Ask Arthur is a community-sourced scam intelligence platform. Consumers submit suspicious content (text, URLs, images, QR codes) via 7 surfaces (web, extension, mobile, 4 chat bots) and receive instant AI verdicts [Data]. Every check enriches a PII-scrubbed threat database that powers a B2B Threat Intelligence API for regulated entities [Data]. The platform ingests 16 threat feeds, enriches entities from 5 external intelligence sources, and runs automated deep investigation (nmap, dnsrecon, nikto, whatweb, sslscan) [Data].

**Why Different**

- **Cross-sector by design**: Banks, telcos, and digital platforms consume the same intelligence layer -- enabling the "whole-of-ecosystem" approach the SPF demands [Data]
- **Community-sourced data flywheel**: Every consumer check improves detection for everyone. No competitor has this loop at scale in Australia [Data]
- **Real-time, not manual**: AI-powered verdicts in seconds vs. manual Scamwatch reports [Data]
- **Privacy-first**: Zero-knowledge architecture; PII scrubbed before storage; no user accounts required [Data]

**Compliance Mapping**

| SPF Principle | Ask Arthur Capability |
|---------------|----------------------|
| Detect | 6 API endpoints with trending threats, entity risk scores, batch lookups [Data] |
| Report | 4 government export views; provider reporting RPCs; Scamwatch-aligned categories [Data] |
| Disrupt | Entity intelligence with risk scoring enables blocking decisions; cluster detection identifies coordinated campaigns [Data] |
| Govern | Usage dashboards and audit trails provide certification evidence [Data] |

**Sovereign Capability**

- Australian-built, Australian-hosted (Supabase AP-Southeast, Vercel Sydney edge) [Data]
- No US data dependencies for core intelligence [Data]
- Privacy Act 1988 compliant; zero-knowledge architecture [Data]
- Data structured for NASC/Scamwatch category alignment [Data]
- Government-ready export views built for law enforcement and regulator consumption [Data]
- R&D Tax Incentive eligible (43.5% refundable offset for AI research activities) [Data]

**Next Steps**

1. Register as ASD Cyber Security Business Partner (cyber.gov.au/partnershipprogram) [Estimate: Q3 2026]
2. Submit NASC/Scamwatch partnership enquiry for SPF "third party gateway" candidacy [Estimate: Q3 2026]
3. Explore AFCX Intel Loop membership for mandated intelligence-sharing infrastructure [Estimate: Q3-Q4 2026]
4. Provide sample threat intelligence export for evaluation
5. Scope a pilot data-sharing arrangement with NASC

**Contact:** hello@askarthur.au | askarthur.au

---

## 6. Bank Follow-Up Sequence -- Bendigo Bank (4-Touch Cadence)

### Touch 1 -- Day 1 (Initial Email)

Use the outreach email from Section 1 above.

### Touch 2 -- Day 5 (Value-Add Follow-Up)

**Subject:** RE: SPF Detect obligation -- cross-sector threat intelligence for mid-tier ADIs

Jason,

Following up briefly. I wanted to share one specific data point: the SPF's private right of action allows consumers to sue for damages from 1 July 2026, with AFCA accepting SPF complaints from 1 January 2027 [Data]. This creates class-action risk on top of the A$52.7M regulatory penalties [Data].

Our Threat API's batch entity lookup (`POST /entities/batch`) can screen up to 500 phone numbers, URLs, emails, or BSBs in a single request [Data] -- designed for integration into existing transaction monitoring workflows without replacing your current systems.

Happy to send over the OpenAPI spec and interactive docs so your team can evaluate independently. Would that be useful?

Brendan Milton

### Touch 3 -- Day 12 (Social Proof / Credibility)

**Subject:** How mid-tier ADIs are approaching SPF Detect

Jason,

Three observations from conversations with ADIs approaching SPF readiness [Assumption]:

1. Most are looking for external ASI sources that complement -- not replace -- their existing fraud tools [Assumption]
2. The Detect principle specifically requires "external Actionable Scam Intelligence" -- internal systems alone will not satisfy the obligation [Data]
3. The cost gap between enterprise fraud vendors ($100K+/year) and the actual intelligence layer mid-tier ADIs need is significant [Estimate]

Ask Arthur's Enterprise API tier starts at $5,000/month -- a fraction of incumbent pricing -- with a free pilot to prove value first [Data].

I have availability Tuesday and Thursday next week if a short call would be helpful.

Brendan Milton

### Touch 4 -- Day 20 (Final / Deadline Anchor)

**Subject:** 57 days to SPF commencement

Jason,

The SPF commences in 57 days [Data]. I appreciate you are likely deep in compliance preparations.

One final thought: our government-ready export views are specifically structured for NASC/Scamwatch reporting alignment [Data]. If Bendigo's SPF programme needs to demonstrate ASI consumption for the Detect principle, a completed pilot would provide that evidence.

Our free pilot offer remains open. If the timing is not right now, I am happy to reconnect when it is.

Best,
Brendan Milton
Founder, Ask Arthur
hello@askarthur.au

---

## 7. ROI Summary -- Mid-Tier Banks

### Cost of Non-Compliance

| Risk | Potential Cost | Source |
|------|---------------|--------|
| Tier 1 penalty (Prevent/Detect/Disrupt/Respond breach) | Up to A$52.7M or 30% of adjusted turnover [Data] | SPF Act 2025 |
| Private right of action (consumer lawsuits) | Uncapped; class-action risk from July 2026 [Data] | SPF Act 2025 |
| AFCA complaints | Volume-dependent; operational cost + remediation from Jan 2027 [Data] | SPF Act 2025 |
| Reputational damage | Unquantifiable but material for community-focused ADIs [Assumption] | Industry standard |
| **Total exposure** | **A$10M-$52.7M+ per serious breach** [Estimate] | |

### Cost of Ask Arthur

| Item | Cost | Notes |
|------|------|-------|
| Proof-of-concept pilot (4 weeks) | $0 | Free evaluation period [Data] |
| Pro API tier (100 calls/day) | $2,000/month ($24K/year) [Data] | Suitable for initial integration |
| Enterprise API tier (5,000 calls/day) | $5,000-$15,000/month ($60K-$180K/year) [Data] | Full-scale production use |
| Integration effort | 1-2 days engineering time [Estimate] | Bearer token auth, RESTful JSON, OpenAPI spec provided |
| **Year 1 total (Enterprise)** | **$60K-$180K** [Data/Estimate] | |

### Cost of Alternatives

| Alternative | Estimated Annual Cost | Limitations |
|------------|----------------------|-------------|
| BioCatch Trust network | $100K-$500K+ [Estimate] | Banking-only; no cross-sector intelligence; no consumer interface |
| NICE Actimize | $100K-$1M+ [Estimate] | 6-12 month deployment; no Australian-specific focus; transaction-focused not content-focused |
| Build in-house | $500K-$2M+ [Estimate] | Requires hiring ML engineers, threat analysts; 12-18 month build; no community data flywheel |
| Do nothing | $0 upfront | A$52.7M+ penalty exposure; class-action risk; AFCA complaint volume [Data] |

### ROI Calculation (Mid-Tier ADI)

| Metric | Value |
|--------|-------|
| Ask Arthur Enterprise cost | $60K-$180K/year [Data] |
| Penalty exposure avoided | $10M-$52.7M+ [Data] |
| Cost vs. in-house build | 90-97% savings [Estimate] |
| Cost vs. incumbent vendors | 60-90% savings [Estimate] |
| Integration time | Days, not months [Estimate] |
| Compliance evidence generated | Usage dashboards, audit trails, export views [Data] |
| **Effective ROI** | **55:1 to 877:1 (penalty avoided / annual cost)** [Estimate] |

Note: ROI calculation uses penalty avoidance as the value metric. Actual ROI depends on breach probability, which varies by institution. The calculation illustrates the asymmetry between compliance cost and non-compliance exposure. These are estimates provided for discussion purposes, not guaranteed outcomes.

---

*Ask Arthur -- pre-revenue, production-ready API. Honest about our stage, serious about the problem.*

askarthur.au | hello@askarthur.au
