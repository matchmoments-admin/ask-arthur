# Ask Arthur — Business Plan

**AI-Powered Scam Detection & Threat Intelligence for Australia**

*April 2026*

askarthur.au | hello@askarthur.au

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem & Opportunity](#2-problem--opportunity)
3. [Solution & Product](#3-solution--product)
4. [Why Now](#4-why-now)
5. [Market Analysis](#5-market-analysis)
6. [Business Model & Go-to-Market](#6-business-model--go-to-market)
7. [Competitive Landscape](#7-competitive-landscape)
8. [Traction & Validation](#8-traction--validation)
9. [Team & Governance](#9-team--governance)
10. [Financial Plan](#10-financial-plan)
11. [Risk & Mitigation](#11-risk--mitigation)
12. [Intellectual Property & Data](#12-intellectual-property--data)
13. [The Ask](#13-the-ask)

---

## 1. Executive Summary

Australians lost $2.18 billion to scams in the past year. The Scams Prevention Framework Act 2025 — commencing 1 July 2026 — mandates that banks, telcos, and digital platforms implement scam detection and intelligence-sharing capabilities or face penalties of up to $52.7 million per breach. Over 200 regulated entities must comply. No incumbent vendor dominates the cross-sector threat intelligence layer this legislation demands.

**Ask Arthur is Australia's first community-sourced scam intelligence platform.** Users submit suspicious content (text, URLs, images, QR codes) via web app, Chrome extension, mobile app, or chat bots (Telegram, WhatsApp, Slack, Messenger). Claude AI analyses submissions in real time and returns a plain-language verdict — SAFE, SUSPICIOUS, or HIGH_RISK — with red flags and next steps. Every check enriches a PII-scrubbed threat database that powers a B2B Threat Intelligence API for regulated entities.

The platform is production-ready across 6 surfaces (web, extension, mobile, 4 chat bots), with 16 threat feed integrations, 6 API endpoints, entity enrichment from 5 external intelligence sources, a unified security scanner (websites, Chrome extensions, MCP servers, AI skills), and automated content generation. All analysis costs less than $0.001 per check.

**Revenue model:** Free consumer tool drives data acquisition. B2B Threat API ($2K-$15K/month per customer) monetises aggregated intelligence. Enterprise compliance subscriptions for SPF-regulated entities.

**Seeking:** A$500K-$1M pre-seed on a post-money SAFE with A$5M-$8M cap.

**Use of funds:** Engineering (60%), go-to-market (20%), operations and compliance (20%).

**Target milestones:** First enterprise pilot within 6 months, $50K MRR within 18 months, seed-ready at 24 months.

---

## 2. Problem & Opportunity

### The crisis is growing

Australian scam losses reached $2.18 billion annually (NASC 2024). The true figure is likely higher — the ACCC estimates only 13% of scam losses are reported. AI-generated scams are making phishing, romance scams, and impersonation attacks indistinguishable from legitimate communications. The people most at risk — older Australians, non-native English speakers, people in financial distress — are the least equipped to identify these threats.

### Current solutions fail ordinary people

| Current Solution | Limitation |
|-----------------|------------|
| Scamwatch (NASC) | Manual reporting; no real-time verdict; data not shared cross-sector |
| Bank fraud teams | See only their own customers' transactions; reactive, not preventive |
| Telco call blocking | Blocks known numbers; cannot detect novel scam content |
| Consumer awareness campaigns | Rely on people recognising scams they haven't seen before |
| Enterprise fraud tools (BioCatch, NICE) | Expensive ($100K+/yr); bank-only; no consumer interface |

There is no free, instant, AI-powered tool that any Australian can use to check a suspicious message — and no platform that converts those checks into cross-sector threat intelligence for regulated entities.

### The regulatory mandate changes everything

The **Scams Prevention Framework Act 2025** (Royal Assent 21 February 2025) creates legally enforceable obligations for three sectors from 1 July 2026:

- **Banks** (ASIC-regulated ADIs): Confirmation of Payee, real-time transaction alerts, suspicious transaction algorithms, payment recall, mule account detection
- **Telcos** (ACMA-regulated): Monitor calls/texts for scam indicators, verify sender IDs via Australian Sender ID Registry, block confirmed scam numbers
- **Digital platforms** (ACCC-regulated): Verify advertiser credentials, verify new accounts, suspend scam accounts

Six overarching principles — Govern, Prevent, Detect, Report, Disrupt, Respond — apply to all regulated entities. Sector designation is expected 1 July 2026 (draft instrument consulted 28 November 2025 – 5 January 2026). Sector codes remain under development — the overarching principles will apply first.

**Actionable Scam Intelligence (ASI).** Section 58AI of the amended CCA defines ASI through an objective "reasonable grounds to suspect" test. Relevant information explicitly includes URLs, email addresses, phone numbers, social media profiles, digital wallets, and bank account information. Critically, the SPF Rules — still being drafted — will formally authorise **third-party data gateways, portals or websites** that give access to ASI. This creates a first-mover window to shape the regulatory landscape before rules are finalised.

**Safe harbour.** Section 58BZA protects entities acting on ASI from liability for disruption actions for up to 28 days, creating strong incentive for regulated entities to maintain robust ASI sources including third-party feeds.

**Penalties create genuine urgency.** Tier 1 penalties (Prevent, Detect, Disrupt, Respond violations) reach the greater of ~A$52.7 million (159,745 penalty units), three times the benefit obtained, or 30% of adjusted turnover. A private right of action allows consumers to sue for damages, creating class-action risk. AFCA EDR scheme authorised from 1 September 2026; AFCA begins formally hearing SPF complaints from 1 January 2027. Current AFCA compensation cap: $631,500 per claim (indexed). AFCA can now name non-compliant businesses and apportion liability across multiple entities.

**Compliance documentation.** Entities must provide a statement of compliance within 30 days of receiving a scam complaint. This statement is admissible in EDR and court proceedings — false/misleading statements may be referred to ACCC. Banks that demonstrate they used external scam intelligence feeds will be better positioned to defend against fines and reimbursement claims.

This regulatory mandate transforms scam detection from a "nice to have" into a "must have" for 200+ regulated entities — creating forced compliance demand that de-risks the investment thesis.

---

## 3. Solution & Product

### How Ask Arthur works

```
User submits suspicious content
        |
        v
  +------------------+
  | Multi-Platform    |  Web app, Chrome extension, mobile app,
  | Intake            |  Telegram, WhatsApp, Slack, Messenger
  +------------------+
        |
        v
  +------------------+
  | Analysis Engine   |  Claude Haiku 4.5 + URL reputation +
  | (scam-engine)     |  phone intel + entity enrichment
  +------------------+
        |
        +---> Instant verdict to user (SAFE / SUSPICIOUS / HIGH_RISK)
        |     with red flags, explanation, and next steps
        |
        +---> HIGH_RISK verdicts flow to:
              |
              +---> verified_scams (PII-scrubbed threat database)
              +---> Entity enrichment pipeline (AbuseIPDB, HIBP, crt.sh, Twilio, URLScan)
              +---> B2B Threat Intelligence API
              +---> Public scam feed
              +---> Automated blog content + email digests
```

### Product surfaces — all production-ready

| Surface | Technology | Status |
|---------|-----------|--------|
| Web app | Next.js 16, React 19, Turbopack | Production |
| Chrome/Firefox extension | WXT framework | Production |
| Mobile app | Expo 54, React Native | Production |
| Telegram bot | Webhook-based | Production |
| WhatsApp bot | Webhook-based | Production |
| Slack bot | Slash commands | Production |
| Messenger bot | Webhook-based | Production |

### B2B Threat Intelligence API

Six endpoints, fully documented with OpenAPI 3.0 spec and Scalar interactive docs:

| Endpoint | Description |
|----------|-------------|
| Threat Trending | Trending scam types by period and region |
| URL Lookup | Full enrichment data for a specific URL (WHOIS, SSL, reputation) |
| Trending URLs | Most-reported domains with aggregation |
| Domain Aggregation | Domain-level threat intelligence with WHOIS |
| Aggregate Statistics | Platform-wide threat statistics |
| Batch Entity Lookup | Bulk lookup for URLs, phones, emails, IPs |

Three tiers: Free (25 calls/day), Pro (100 calls/day, $2K/mo), Enterprise (5,000 calls/day, $5K-$15K/mo).

### Unified Security Scanner

Beyond scam detection, Ask Arthur provides a multi-type security scanner covering:
- **Website audits** — security headers, TLS configuration, letter grade (A+ to F)
- **Chrome extension audits** — manifest analysis, 20+ checks across 8 categories
- **MCP server audits** — npm registry queries, OWASP MCP Top 10, 24+ checks
- **AI skill audits** — prompt injection detection, malware indicators, 16+ checks

Embeddable SVG security badges and dynamic OG images for social sharing.

### Intelligence pipeline

- **16 threat feed integrations** — automated scraping via GitHub Actions
- **5 external enrichment APIs** — AbuseIPDB, HIBP, crt.sh, Twilio Lookup, URLScan.io
- **WHOIS + SSL enrichment** — automated fan-out every 6 hours via Inngest
- **Certificate Transparency monitoring** — Australian brand monitoring every 12 hours
- **Deep investigation pipeline** — nmap, dnsrecon, nikto, whatweb, sslscan (weekly)
- **Government-ready data exports** — 4 export views for law enforcement/regulators

---

## 4. Why Now

Three forces converge to make this the right moment:

### 1. Regulatory mandate with a hard deadline

The Scams Prevention Framework Act 2025 commences 1 July 2026 — less than 3 months away. Over 200 regulated entities must implement scam detection, intelligence-sharing, and consumer protection capabilities. The 80+ smaller ADIs, MVNOs, and digital platforms that lack in-house fraud teams need external solutions. This is rare "regulatory pull" — demand is being created by law, not by marketing.

### 2. AI-generated scams are overwhelming existing defences

Large language models make it trivial to generate grammatically perfect, contextually aware phishing messages at scale. Traditional rule-based filters cannot keep up. Fighting AI-generated scams requires AI-powered detection — and Claude's classification capabilities are now fast and cost-effective enough ($0.001 per check) to deploy at consumer scale.

### 3. Australian VC market is prioritising AI

61% of Australian VC capital is flowing into AI companies. The federal government's National Reconstruction Fund has invested $15M in QuintessenceLabs (cybersecurity) and $200M in Macquarie Technology (sovereign cloud). The R&D Tax Incentive provides 43.5% cash refunds for eligible AI research. The funding environment for an AI cybersecurity startup has never been more favourable.

---

## 5. Market Analysis

### Market sizing (bottom-up)

| Layer | Calculation | Value |
|-------|-------------|-------|
| **TAM** | Australian cybersecurity market | US$5.8B (2024), growing 8%+ annually |
| **SAM** | Scam-specific detection tools: 200-300 regulated entities x $500K-$5M average compliance spend | A$200M-$500M within 3-5 years |
| **SOM** | Year 1-3 target: 10-20 mid-tier ADIs + smaller telcos x $50K-$200K ACV | A$1M-$4M |

### Customer segmentation

| Segment | Count | Opportunity | Timeline |
|---------|-------|-------------|----------|
| Big Four banks (CBA, NAB, ANZ, Westpac) | 4 | Building in-house; partner, don't compete | 12-24 months |
| Mid-tier banks & credit unions | 80+ | Lack in-house capability; need external tools | Immediate |
| Telco carriers | 50+ | SPF-mandated; need scam content detection | 6-12 months |
| Digital platforms | 20-30 | New to scam compliance; need turnkey solutions | 6-18 months |
| Superannuation funds (future designation) | 200+ | Watching SPF closely; proactive buyers | 12-24 months |

### Adjacent opportunities

- **Consumer premium subscriptions** — family protection plans, enhanced scanning, push alerts
- **White-label embed widget** — banks and telcos embed Ask Arthur's scanner in their apps
- **Government contracts** — threat intelligence exports, NASC data-sharing partnership
- **International expansion** — scam detection is a global problem; Australia-first, then APAC

---

## 6. Business Model & Go-to-Market

### Revenue streams

| Stream | Pricing | Target |
|--------|---------|--------|
| **B2B Threat API — Pro** | $2,000/month | Mid-tier banks, fintechs |
| **B2B Threat API — Enterprise** | $5,000-$15,000/month | Banks, telcos, digital platforms |
| **Consumer Premium (Pro)** | $9.99/month | Power users, families |
| **Consumer Premium (Enterprise/Team)** | Custom | Corporate security teams |
| **White-label licensing** | Custom | Banks embedding scam check in their apps |

### Unit economics

| Metric | Value |
|--------|-------|
| Cost per analysis | ~$0.001 (Claude Haiku + URL checks + storage) |
| B2B API value per data point | ~$0.20-$1.50 (depending on tier) |
| Gross margin (B2B API) | 95%+ |
| Target LTV:CAC | 3:1+ |

### Go-to-market strategy

**Phase 1 (Months 0-6): Foundation**
- Target 2-3 mid-tier banks and 1-2 smaller telcos for proof-of-concept pilots (4-12 weeks, free/discounted)
- Apply for AFCX membership to position in the mandated intelligence-sharing infrastructure
- Apply for GASA membership for global anti-scam ecosystem access
- Conference presence: Fraud & Financial Crime Australia 2026, Australian Cyber Conference (AISA)

**Phase 2 (Months 6-12): Conversion**
- Convert pilots to paid Enterprise contracts
- Launch white-label widget for bank/telco app embedding
- Expand consumer user base via Chrome Web Store and App Store launches
- Build SPF compliance documentation mapping API capabilities to specific SPF principles

**Phase 3 (Months 12-24): Scale**
- Expand to 10-20 enterprise customers
- Pursue government contracts (NASC data partnership, ASD Cyber Security Business Partner)
- Begin SOC 2 Type II and ISO 27001 certification
- Explore APAC expansion (NZ, Singapore — similar regulatory environments)

### Key partnerships

| Partner | Type | Value |
|---------|------|-------|
| AFCX (Australian Financial Crimes Exchange) | Intelligence sharing | Mandated infrastructure for all ABA/COBA banks; feed into/consume from intel loop |
| GASA (Global Anti-Scam Alliance) | Industry membership | Thought leadership, regulator access, global intelligence |
| Stone & Chalk | Incubator | Cybersecurity ecosystem, networking (absorbed AustCyber) |
| ASD | Cyber Security Business Partner | Government credibility signal |
| NASC (National Anti-Scam Centre) | Data sharing | SPF "third party gateway" candidacy |

---

## 7. Competitive Landscape

### Positioning matrix

|  | Consumer-facing | Enterprise-only |
|--|----------------|-----------------|
| **Cross-sector intelligence** | **Ask Arthur** | (Gap in market) |
| **Single-sector intelligence** | Scamwatch (manual) | BioCatch (banking), Quantium Telstra (telco-bank) |
| **General fraud/identity** | — | NICE Actimize, LexisNexis/IDVerse, SymphonyAI |

### Competitor analysis

| Competitor | Strength | Limitation | Ask Arthur advantage |
|-----------|----------|------------|---------------------|
| **BioCatch** | All Big Four banks use Trust network; behavioural biometrics | Banking-only; no consumer interface; no cross-sector | Cross-sector intelligence; consumer data flywheel |
| **Quantium Telstra** | Telstra + CBA joint venture; Scam Indicator product | Proprietary to parent companies; not available to competitors | Open platform; available to all regulated entities |
| **NICE Actimize** | Established enterprise vendor; deep banking integration | Expensive ($100K+/yr); slow to deploy; no Australian-specific focus | Australian-focused; 10x cheaper; faster deployment |
| **LexisNexis/IDVerse** | Acquired Australian AI identity firm (Feb 2025); global scale | Identity verification, not scam content detection | Real-time scam content analysis; community-sourced intelligence |
| **Scamwatch (NASC)** | Government authority; trust | Manual reporting; no real-time verdict; data not shared cross-sector | Instant AI verdicts; automated intelligence sharing |

### The critical gap

The SPF's "whole-of-ecosystem" approach demands cross-sector intelligence connecting banks, telcos, and digital platforms simultaneously. BioCatch is banking-only. Quantium Telstra is proprietary. No single vendor dominates this cross-sector intelligence layer. Ask Arthur's Threat API — ingesting 16 feeds with WHOIS/SSL enrichment and Certificate Transparency monitoring — is purpose-built for this gap.

---

## 8. Traction & Validation

### Technical milestones achieved

| Milestone | Status |
|-----------|--------|
| Production web app with full analysis pipeline | Complete |
| Chrome/Firefox extension | Complete |
| Mobile app (iOS + Android via Expo) | Complete |
| 4 chat bots (Telegram, WhatsApp, Slack, Messenger) | Complete |
| 16 threat feed integrations | Complete |
| 6 B2B API endpoints with OpenAPI spec | Complete |
| 5 external intelligence integrations (AbuseIPDB, HIBP, crt.sh, Twilio, URLScan) | Complete |
| Entity enrichment pipeline with automated risk scoring | Complete |
| Deep investigation pipeline (nmap, dnsrecon, nikto, whatweb, sslscan) | Complete |
| Unified security scanner (websites, extensions, MCP servers, AI skills) | Complete |
| Government-ready threat intelligence export views | Complete |
| Provider reporting infrastructure | Complete |
| Billing system (Paddle) with tiered subscriptions | Complete |
| User auth, dashboard, and API key self-service | Complete |
| Public scam feed | Complete |
| Automated blog generation and email digests | Complete |
| Privacy-first analytics (Plausible, no cookies) | Complete |
| Prompt injection defence (14 patterns) | Complete |
| PII scrubbing pipeline (12 patterns) | Complete |

### Platform readiness

- **11 completed development phases** spanning core platform, multi-platform expansion, threat intelligence, content generation, security hardening, media analysis, intelligence pipeline, government data exports, and unified security scanner
- **44 database migrations** reflecting iterative schema evolution
- **OpenAPI 3.0 specification** with Scalar interactive documentation
- **Monorepo architecture** with 7 packages, automated builds via Turborepo

### Validation signals

- Community-sourced data model proven: every consumer check enriches the threat database
- Zero-knowledge privacy architecture: no user accounts required, no PII stored, ephemeral analysis
- Sub-$0.001 cost per analysis demonstrated at current scale
- Cross-platform delivery validated across web, mobile, extension, and 4 chat platforms

---

## 9. Team & Governance

### Founder

Building Ask Arthur from Australia with deep experience in AI/ML, cybersecurity, and consumer product development. Hands-on technical founder who has single-handedly built the full production platform across 11 development phases.

### Capability strategy

Solo-founder risk is mitigated through:
- **Strong technical foundation** — the entire platform is production-ready, reducing engineering dependency
- **Advisory board** (building) — targeting cybersecurity, financial services, and regulatory expertise
- **Hiring plan** — first hires will be: (1) Head of Sales / Business Development (enterprise relationships), (2) Security Engineer (SOC 2 / ISO 27001 readiness), (3) ML Engineer (detection model improvements)
- **Accelerator participation** — CyRise and/or Startmate cohort to add structured support, mentorship, and co-founder matching opportunities

### Company structure

- Australian Pty Ltd
- Sole director/shareholder (pre-investment)
- SAFE notes for pre-seed investment (standard YC SAFE, post-money)

---

## 10. Financial Plan

### Revenue projections

| Timeline | Consumer MAU | API Customers | MRR | ARR |
|----------|-------------|---------------|-----|-----|
| Month 6 | 5,000 | 1 (pilot) | $2K | $24K |
| Month 12 | 20,000 | 3 | $15K | $180K |
| Month 18 | 50,000 | 6 | $50K | $600K |
| Month 24 | 100,000 | 12 | $100K | $1.2M |
| Month 36 | 250,000 | 25 | $250K | $3M |

Assumes average API customer value of $5K/month (blended across Pro and Enterprise tiers), with conservative ramp from pilot to paid conversion.

### Cost structure (Year 1)

| Category | Monthly | Annual | Notes |
|----------|---------|--------|-------|
| AI inference (Claude) | $500-$2,000 | $6K-$24K | Scales with usage; ~$0.001/check |
| Infrastructure (Vercel, Supabase, Upstash, R2) | $500-$1,500 | $6K-$18K | Current stack, scales efficiently |
| External APIs (AbuseIPDB, Twilio, URLScan, etc.) | $200-$800 | $2.4K-$9.6K | Most have generous free tiers |
| Salaries (1-2 hires, Month 6+) | $10K-$25K | $60K-$150K | First hires: sales + security engineer |
| Legal & compliance | $500-$1,000 | $6K-$12K | SOC 2 prep, IP protection |
| Marketing & conferences | $500-$2,000 | $6K-$24K | Conference presence, content marketing |
| **Total Year 1** | | **$86K-$238K** | |

### Key SaaS metrics (targets)

| Metric | Month 12 | Month 24 | Notes |
|--------|----------|----------|-------|
| MRR | $15K | $100K | Conservative; enterprise deals lumpy |
| Gross margin | 90%+ | 92%+ | Near-zero marginal cost per check |
| Net revenue retention | 110%+ | 120%+ | Upsell from Pro to Enterprise |
| Burn rate | $15K/mo | $30K/mo | Lean operations, efficient stack |
| Runway | 24+ months | Seed-funded | At $750K raise |
| CAC payback | 6 months | 4 months | Enterprise sales cycle then recurring |

### Path to seed round

Seed-ready at Month 18-24 with:
- $50K+ MRR ($600K+ ARR run rate)
- 5+ paying enterprise customers
- Proven go-to-market motion
- SOC 2 Type II in progress or complete
- Target: A$2.5M-$5M seed round

### Sensitivity analysis

| Scenario | Assumptions | Month 24 ARR |
|----------|-------------|-------------|
| **Bull** | 15 enterprise customers, $8K avg ACV/mo, strong consumer growth | $2M+ |
| **Base** | 10 enterprise customers, $5K avg ACV/mo, steady consumer growth | $1.2M |
| **Bear** | 5 enterprise customers, $3K avg ACV/mo, slow consumer adoption | $400K |

Even the bear case produces meaningful revenue given the regulatory tailwind. The SPF deadline creates a floor of demand that doesn't depend on discretionary spending.

---

## 11. Risk & Mitigation

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Enterprise sales cycle too long** | High | Start with free/discounted POC pilots; target mid-tier (shorter cycles); leverage SPF deadline urgency |
| **Solo founder** | High | Accelerator participation (CyRise/Startmate); advisory board; early sales hire; co-founder search via ecosystem |
| **Big Four build in-house** | Medium | They already are — but 80+ smaller ADIs can't. Position as complementary cross-sector layer, not competitor to bank-specific tools |
| **Adversarial scam evolution** | Medium | Continuous model updates; 16 threat feeds provide early warning; community-sourced data catches novel scams faster than enterprise-only datasets |
| **Model accuracy / false positives** | Medium | Conservative three-tier verdict system (SAFE/SUSPICIOUS/HIGH_RISK); human-readable explanations build trust even when uncertain; prompt injection defence hardened |
| **SPF implementation delayed** | Low | Act has Royal Assent; delay would still maintain compliance pressure. Consumer product has standalone value regardless |
| **Data privacy incident** | Low | Zero-knowledge architecture; PII scrubbed before storage; no user accounts required; privacy-by-design from day one |
| **Competitor raises large round** | Medium | First-mover advantage in cross-sector intelligence; community data flywheel creates compounding moat; sovereign Australian positioning |

---

## 12. Intellectual Property & Data

### IP strategy

- **Proprietary threat intelligence database** — community-sourced, PII-scrubbed, enriched with 5 external intelligence sources. Grows with every consumer check. Difficult to replicate — a competitor starting today would need 24+ months of community-sourced data to match.
- **Analysis pipeline** — custom prompt engineering, injection defence (14 patterns), PII scrubbing (12 patterns), entity extraction, and multi-signal risk scoring. Not a thin wrapper on an LLM — significant domain-specific engineering.
- **Shared pattern library** — 60+ detection patterns for injection, secrets, exfiltration, typosquatting across security scanner.
- **Trade secrets** — threat feed processing logic, entity enrichment pipeline, risk scoring algorithms.

### Data governance

- **Privacy Act 1988 (Cth) compliant** — privacy-by-design architecture
- **Zero-knowledge model** — no user accounts required for consumer product; no PII stored
- **PII scrubbing** — all data passes through 12-pattern scrubbing pipeline before storage
- **Data sovereignty** — all data hosted in Australia (Supabase AP-Southeast, Vercel Sydney edge)
- **GDPR-ready** — minimal data collection model translates directly to GDPR compliance for international expansion

### AI governance

- Claude AI used for classification, not decision-making — humans interpret verdicts
- Prompt injection defence hardened with sanitisation, nonce delimiters, and 14 detection patterns
- No model fine-tuning on user data — inference only
- Transparent AI disclosure on all bot interactions (Apple/WhatsApp compliance)

---

## 13. The Ask

### Investment sought

**A$500K-$1M pre-seed** on a post-money SAFE with A$5M-$8M valuation cap.

### Use of funds

| Category | Allocation | Specific Use |
|----------|-----------|--------------|
| **Engineering** | 60% | ML engineer (detection model improvements), security engineer (SOC 2/ISO 27001), infrastructure scaling |
| **Go-to-market** | 20% | Head of sales hire, enterprise pilot programme, conference presence, AFCX/GASA membership |
| **Operations & compliance** | 20% | Legal (IP protection, enterprise contracts), SOC 2 Type II certification, hosting/AI costs |

### What this capital unlocks

| Milestone | Timeline |
|-----------|----------|
| First enterprise POC pilot | Month 3 |
| AFCX membership / GASA membership | Month 3-6 |
| First paying enterprise customer | Month 6-9 |
| SOC 2 Type II certification started | Month 6 |
| Chrome Web Store + App Store launches | Month 3 |
| $50K MRR | Month 18 |
| Seed-ready ($2.5M-$5M round) | Month 18-24 |

### Why invest now

1. **Regulatory tailwind** — SPF compliance deadline (1 July 2026) creates forced demand. This is not speculative — the Act has Royal Assent.
2. **Product is built** — 11 development phases complete. This is not a pitch for vaporware — the platform is production-ready.
3. **Capital-efficient** — solo technical founder has built the full stack. Investment goes to sales and scale, not R&D from scratch.
4. **Defensible moat** — community-sourced data flywheel compounds over time. Every check makes the platform more valuable. A competitor starting today is 24+ months behind.
5. **Market timing** — 61% of Australian VC capital is flowing into AI. Cybersecurity is an explicit priority for Main Sequence, Tidal Ventures, Blackbird, and CyRise.

---

## Appendix A: Grant Strategy

### Priority programs

| Program | Amount | Status | Timeline |
|---------|--------|--------|----------|
| **IGP Advisory Service** | Prerequisite for grant | Apply immediately | 2-4 weeks for adviser match |
| **IGP Early-Stage Commercialisation** | $50K-$250K (50% co-contribution) | After Advisory Service | ~90% of funding projected exhausted by June 2026 |
| **R&D Tax Incentive** | 43.5% refundable offset | Ongoing | FY24-25 registration deadline: 30 April 2026 |
| **CyRise Accelerator** | $50K + 14-week program | Apply next cohort | Dedicated cybersecurity accelerator |
| **Startmate Accelerator** | $120K at $1.5M post-money | Apply next cohort | Credibility + ecosystem access |
| **NSW MVP Ventures** | $20K-$75K | Monitor for next round | Program continues until June 2027 |

### NRF priority alignment

Ask Arthur fits under the **Enabling Capabilities** priority area (AI + cybersecurity). Framing: building sovereign Australian AI capability to protect citizens from the $2.18B annual scam crisis, directly enabling compliance with the SPF Act 2025, and creating an exportable cybersecurity product.

### R&D Tax Incentive — eligible activities

- Developing novel ML architectures for scam detection
- Building proprietary NLP pipelines for suspicious communication analysis
- Researching training data curation methods
- Developing algorithms for real-time scam pattern recognition
- Investigating adversarial-resistant detection approaches
- Building custom data pipelines for threat intelligence processing

**Critical requirement:** contemporaneous documentation. Descriptive Git commits, experiment tracking, hypothesis documentation before experiments, and training curve reports.

---

## Appendix B: SPF Compliance Mapping

How Ask Arthur's capabilities map to the six SPF principles:

| SPF Principle | Obligation | Ask Arthur Capability |
|---------------|-----------|----------------------|
| **Prevent** | Consumer warnings, identity verification | Consumer scam checker provides real-time warnings; security scanner verifies website/extension safety |
| **Detect** | Internal detection mechanisms + external Actionable Scam Intelligence | Threat API provides ASI feeds; 16 threat feeds + entity enrichment |
| **Report** | Report ASI to ACCC within 24 hours; share intelligence cross-sector | Government export views; provider reporting infrastructure; structured data aligned to Scamwatch categories |
| **Disrupt** | Block scam numbers/accounts/content | Entity intelligence (phone, URL, email, IP) with risk scores enables blocking decisions |
| **Respond** | Internal dispute resolution; 30-day compliance statements | Audit trail via scan results, entity intelligence, and report history |
| **Govern** | Governance policies; annual senior officer certification | Compliance dashboard (planned); structured evidence for certification |

---

## Appendix C: Investor Target List

### Tier 1 — Apply immediately

| Investor | Cheque Size | Why |
|----------|-------------|-----|
| Tidal Ventures | $250K-$2.5M | Invested in SecurePII (Oct 2025); strongest thesis fit; operator-led (ex-Atlassian); QIC-backed |
| Startmate | $120K | Most active Australian early-stage investor |
| Main Sequence (CSIRO-backed) | $250K-$2M | Led Kasada ($300M+ valuation, US$20M Feb 2026); cybersecurity explicitly named; invests pre-revenue |
| Sydney Angels | $10K-$20K (individual) | Sidecar Fund ($10M) co-invests 50/50; invested in Apollo Secure ($600K cybersecurity) |

### Tier 2 — Build relationships now

| Investor | Cheque Size | Why |
|----------|-------------|-----|
| AirTree Ventures | $250K-$500K pre-seed | Fund V closed Aug 2025 at A$650M; cybersecurity focus; co-invested in Darwinium; targets 15-25% at seed |
| Blackbird Ventures | Seed avg $2.96M | Invested in Darwinium ($18M Series A, digital security) and Bugcrowd (unicorn); 29 investments in 2025 |
| Square Peg Capital | $5M+ | US$3.6B AUM; invested in UpGuard (cybersecurity GRC); 50%+ recent dollars in AI |
| Stone & Chalk Cyber | Residency (non-dilutive) | AustCyber subsidiary; cybersecurity sector support; CyRise closed permanently May 2023 |

### Tier 3 — Seed/Series A relationships

| Investor | Cheque Size | Why |
|----------|-------------|-----|
| Titanium Ventures (ex-Telstra Ventures) | $5M-$20M | Invested in CrowdStrike, Auth0, GitLab |
| Folklore Ventures | Raising up to $350M | 47 investments, early-stage ANZ focus |
| King River Capital | $5M+ | Building AI-specific fund |

---

*Ask Arthur — Protecting Australians from scams, one check at a time.*

askarthur.au | hello@askarthur.au
