# Enterprise Readiness Certification Roadmap

Actionable plan for Ask Arthur to achieve the certifications and compliance posture required to sell into Australian banks and government.

---

## Certification Sequence

| Phase | Certification | Timeline | Cost Estimate | What It Unlocks |
|-------|--------------|----------|---------------|-----------------|
| Immediate | Essential Eight ML1 self-assessment | 2-4 weeks | $0 | Government conversations, baseline security posture |
| Immediate | Compliance automation platform (Vanta, Drata, or Sprinto) | 1 week setup | $5-8K/year | Accelerates all certifications, evidence collection |
| Month 1-2 | SOC 2 Type I (point-in-time) | 4-8 weeks | $15-25K | Unlocks pilot conversations with banks |
| Month 3-6 | ISO 27001:2022 | 3-6 months implementation + 1-2 months audit | $10-50K | Functionally mandatory for selling to Australian banks. Must be 2022 version (2013 expired). AFCX requires ISO 27001. |
| Month 6-9 | SOC 2 Type II (12-month observation) | 6-12 months | $20-50K | Enterprise contracts. 83% of enterprise buyers require it. Aligns with CPS 234. |
| When needed | IRAP assessment at PROTECTED level | 3-6 months | $40-100K+ | Government contracts. Not needed for commercial banking. |

> **Note:** ISO 27001 and SOC 2 share 70-80% control overlap — pursue concurrently.

---

## APRA CPS 234 Compliance

CPS 234 does not certify vendors directly but requires banks to assess third-party information security. What banks will ask for:

- **Incident notification support** — banks must notify APRA within 72 hours
- **Audit access rights** — contractual right for the bank (or its auditor) to examine Ask Arthur's controls
- **Testing of security controls** — evidence of regular penetration testing, vulnerability scanning, and control effectiveness reviews
- **ISO 27001 + SOC 2 provide the foundation** — together they satisfy the vast majority of CPS 234 due diligence requirements

---

## CPS 230 (Operational Resilience) — effective 1 July 2025

If Ask Arthur is deemed a **material service provider**:

- APRA must be notified within **20 business days**
- If data is offshored, notification is required **prior** to the arrangement
- **Ask Arthur hosts in Australia — this is a non-issue**

---

## SLA Expectations for Mid-Tier Banks

| Metric | Expected Minimum |
|--------|-----------------|
| Uptime | 99.9% (~8.76 hours downtime/year), 99.95% for critical |
| Latency (P95) | <200ms real-time enrichment, <500ms non-blocking |
| Incident response (P1) | 15-30 minutes |
| Incident response (P2) | 1 hour |
| SLA credits | 5-10% per 0.1% below target, capped at 25-30% monthly |

---

## Data Residency (Non-Negotiable)

- All data must be hosted in Australia
- Current stack: Supabase AP-Southeast, Vercel Sydney edge, Upstash
- APRA does not prohibit offshoring but imposes strict requirements that create major procurement friction
- **Document data residency prominently in all sales collateral** — this removes the single biggest procurement friction point

---

## Interim Measures (Before Full Certification)

While pursuing SOC 2 Type II and ISO 27001, the following measures demonstrate security maturity to prospects:

- **SOC 2 Type I** (point-in-time, faster to obtain)
- **CSA STAR Level 1** self-assessment
- **Documented ISMS policies** (information security management system)
- **Independent penetration test** from a reputable Australian firm
- **Compliance automation platform evidence dashboard** (shareable with prospects)

---

## Procurement Timeline for Mid-Tier Banks

9 stages, typically **6-12 months** (SPF urgency may compress):

1. **Problem identification** (1-2 weeks)
2. **Market scan / RFI** (2-4 weeks)
3. **RFP** (4-8 weeks)
4. **POC / pilot** (4-12 weeks)
5. **Security / compliance review** (4-8 weeks)
6. **Commercial negotiation** (2-4 weeks)
7. **Legal review** (2-4 weeks)
8. **Approval** (2-4 weeks)
9. **Onboarding** (4-12 weeks)

Board Risk Committee approval is required for contracts above **$250K-$500K annually**.

---

## Key Stakeholders in Bank Procurement

| Stakeholder | Role in Procurement |
|-------------|-------------------|
| Head of Financial Crime | Business sponsor — owns the problem and champions the solution |
| CRO (Chief Risk Officer) | Risk oversight — signs off on residual risk |
| CISO | CPS 234 assessment — evaluates information security controls |
| IT / Engineering | Integration feasibility — assesses technical fit and effort |
| Procurement | Commercial terms — negotiates pricing, SLAs, and contract structure |
| Legal / Compliance | Contract review — privacy impact assessment, regulatory alignment |
| Internal Audit | Material outsourcing assessment under CPS 230 |
| Board Risk Committee | Final approval (above threshold) |
