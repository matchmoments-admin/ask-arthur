# Data Processing Agreement

**Ask Arthur — Scam Detection Platform**

Last updated: April 2026

---

## 1. Parties and Scope

This Data Processing Agreement ("DPA") is entered into between:

**Ask Arthur** (ABN 72 695 772 313), operating the askarthur.au platform ("Processor"), and the entity identified in the applicable Order Form or Master Service Agreement ("Controller").

This DPA forms part of the Master Service Agreement ("MSA") and governs the processing of personal information by the Processor on behalf of the Controller in connection with the Ask Arthur scam detection platform ("Services").

---

## 2. Definitions

| Term | Meaning |
|------|---------|
| **APP** | Australian Privacy Principles under the Privacy Act |
| **Eligible Data Breach** | As defined in Part IIIC of the Privacy Act |
| **GDPR** | Regulation (EU) 2016/679, where applicable |
| **OAIC** | Office of the Australian Information Commissioner |
| **Personal Information** | As defined in s 6(1) of the Privacy Act 1988 (Cth), and where applicable, "personal data" as defined in Article 4(1) of the GDPR |
| **Privacy Act** | Privacy Act 1988 (Cth), as amended (including the Privacy and Other Legislation Amendment Act 2024 ("POLA 2024")) |
| **Processing** | Any operation performed on Personal Information, including collection, use, storage, disclosure, transfer, and deletion |
| **SCCs** | Standard Contractual Clauses for international data transfers (EU Commission Decision 2021/914) |
| **Sub-processor** | A third party engaged by the Processor to process Personal Information on behalf of the Controller |

---

## 3. Data Processing Details

### 3.1. Categories of Data Subjects

- Controller's employees and contractors (Authorised Users)
- Controller's customers or end users whose content is submitted for analysis
- Third parties whose information appears in submitted content (e.g., suspected scammers)

### 3.2. Types of Personal Information Processed

| Data Type | Purpose | Retention |
|-----------|---------|-----------|
| Email addresses | Account authentication, notifications | Duration of account + 30 days |
| IP addresses | Rate limiting, abuse prevention, geolocation | 12 months (hashed after 30 days) |
| Phone numbers | Scam analysis (submitted content) | 7 years (hashed/anonymised) |
| URLs | Scam analysis (submitted content) | 7 years |
| Message/text content | Scam analysis (submitted content) | 7 years (PII scrubbed before storage) |
| Image metadata | Scam analysis (submitted content) | 7 years (images not retained after analysis) |
| Browser/device metadata | Extension functionality, analytics | 12 months (aggregated) |
| API usage logs | Billing, support, security monitoring | 12 months |

### 3.3. Purpose of Processing

The Processor processes Personal Information solely to:

- (a) Provide scam detection and risk assessment services;
- (b) Maintain and improve the accuracy of scam detection models;
- (c) Comply with legal obligations;
- (d) Prevent fraud and abuse of the Platform.

### 3.4. Duration of Processing

Processing continues for the term of the MSA plus the Transition Period and any legally required retention periods.

---

## 4. Obligations of the Processor

4.1. The Processor shall:

- (a) Process Personal Information only on the documented instructions of the Controller, unless required by law;
- (b) Ensure persons authorised to process Personal Information are bound by confidentiality obligations;
- (c) Implement appropriate technical and organisational security measures (see Section 7);
- (d) Comply with the conditions for engaging Sub-processors (see Section 6);
- (e) Assist the Controller in responding to data subject requests (see Section 5);
- (f) Assist the Controller with data protection impact assessments where required;
- (g) Delete or return Personal Information upon termination (see Section 10);
- (h) Make available all information necessary to demonstrate compliance and allow audits.

4.2. The Processor shall immediately notify the Controller if, in the Processor's opinion, an instruction from the Controller infringes the Privacy Act, GDPR, or any other applicable data protection law.

---

## 5. Data Subject Rights and POLA 2024 Provisions

### 5.1. Access and Correction

The Processor shall assist the Controller in responding to requests from data subjects exercising their rights under APP 12 (access) and APP 13 (correction) within 30 days of the request.

### 5.2. Erasure

Upon verified request, the Processor shall delete or de-identify Personal Information relating to a data subject within 30 days, except where retention is:

- Required by law;
- Necessary to maintain verified scam intelligence records (in anonymised form).

### 5.3. POLA 2024 -- Statutory Tort for Serious Privacy Invasions

The Processor acknowledges the statutory tort for serious invasions of privacy introduced by the Privacy and Other Legislation Amendment Act 2024. The Processor shall:

- (a) Not engage in processing that would constitute a serious invasion of privacy;
- (b) Maintain records sufficient to demonstrate compliance;
- (c) Cooperate with the Controller in responding to any claims under the statutory tort.

### 5.4. POLA 2024 -- Automated Decision-Making

Where the Platform's AI-generated verdicts (SAFE, SUSPICIOUS, HIGH_RISK) are used as a basis for automated decisions that significantly affect individuals:

- (a) The Processor shall provide meaningful information about the logic involved in automated processing upon Controller's request;
- (b) The Processor's verdicts include confidence scores and reasoning factors to support human review;
- (c) The Controller remains responsible for any ultimate decision made on the basis of Platform outputs and for providing appropriate notice and review mechanisms to affected individuals.

### 5.5. Children's Privacy

The Processor does not knowingly collect Personal Information from children under 16. If the Processor becomes aware that it has processed such information, it shall notify the Controller and delete the information promptly.

---

## 6. Sub-processors

### 6.1. Authorised Sub-processors

The Controller authorises the Processor to engage the following Sub-processors:

| Sub-processor | Location (Entity) | Data Region | Purpose | Certifications |
|---------------|-------------------|-------------|---------|----------------|
| **Supabase Inc.** | USA | ap-southeast-2 (Sydney) | Database hosting, authentication, row-level security | SOC 2 Type II |
| **Vercel Inc.** | USA | syd1 (Sydney) | Application hosting, edge functions, CDN | SOC 2, ISO 27001 |
| **Cloudflare Inc.** | USA | Oceania hint (Sydney) | DNS, DDoS protection, CDN, R2 object storage | SOC 2, ISO 27001 |
| **Resend Inc.** | USA | N/A | Transactional email delivery | SOC 2 |
| **Anthropic PBC** | USA | N/A | AI-powered scam analysis (Claude) | Enterprise DPA |
| **Twilio Inc.** | USA | N/A | Phone number intelligence and validation | SOC 2 Type II |
| **Upstash Inc.** | Singapore | Singapore | Redis caching, rate limiting | N/A |

### 6.2. Sub-processor Changes

The Processor shall notify the Controller at least 30 days before engaging a new Sub-processor or materially changing the processing performed by an existing Sub-processor.

### 6.3. Objection Right

The Controller may object to a new Sub-processor within 14 days of notification. If the objection is not resolved within 30 days, the Controller may terminate the affected Services without penalty.

### 6.4. Sub-processor Obligations

The Processor shall:

- (a) Enter into written agreements with each Sub-processor imposing data protection obligations no less protective than this DPA;
- (b) Remain fully liable for the acts and omissions of its Sub-processors.

---

## 7. Security Measures

7.1. The Processor implements the following technical and organisational measures:

### Encryption

| Layer | Standard |
|-------|----------|
| Data at rest | AES-256 encryption |
| Data in transit | TLS 1.3 |
| API keys | SHA-256 hashed (never stored in plaintext) |

### Access Control

- Row-Level Security (RLS) enforced on all database tables;
- Role-based access control with principle of least privilege;
- Multi-factor authentication for all administrative access;
- HttpOnly, Secure, SameSite=Strict cookies for session management;
- API key authentication with per-key scoping and rate limits.

### Infrastructure Security

- Automated vulnerability scanning;
- Dependency auditing and automated updates;
- Content Security Policy (CSP) headers without `unsafe-eval`;
- Web Application Firewall (WAF) protection;
- DDoS mitigation via Cloudflare.

### PII Handling

- PII is scrubbed from submitted content before permanent storage;
- Personal information is hashed or anonymised in scam intelligence records;
- Minimum data retention periods enforced.

7.2. The Processor shall regularly test, assess, and evaluate the effectiveness of these measures and update them as necessary to address evolving threats.

---

## 8. Cross-Border Transfers (APP 8)

8.1. The Processor acknowledges that Personal Information may be transferred to Sub-processors located outside Australia as set out in Section 6.1.

8.2. In accordance with APP 8, the Processor shall take reasonable steps to ensure that overseas recipients of Personal Information do not breach the APPs. This includes:

- (a) Entering into contractual arrangements with Sub-processors that impose obligations substantially similar to the APPs;
- (b) Selecting Sub-processors with appropriate security certifications (SOC 2, ISO 27001);
- (c) Where the Sub-processor is located in a jurisdiction recognised by the OAIC as providing substantially similar protections, relying on that adequacy;
- (d) Prioritising data regions in Australia (ap-southeast-2 / syd1) where available.

8.3. **GDPR Transfers.** Where the Controller is subject to the GDPR, the Processor shall execute Standard Contractual Clauses (SCCs) for any transfer of Personal Data to jurisdictions without an adequacy decision. The SCCs (Module Two: Controller to Processor) are incorporated by reference and available upon request.

8.4. **Transfer Impact Assessment.** Upon Controller's request, the Processor shall provide information necessary for the Controller to conduct a transfer impact assessment.

---

## 9. Data Breach Notification

### 9.1. Notification to Controller

Upon becoming aware of an Eligible Data Breach or suspected breach involving Controller's Personal Information, the Processor shall:

- (a) Notify the Controller without undue delay and in any event within **72 hours**;
- (b) Provide the following information (to the extent available):
  - Nature of the breach, including categories and approximate number of data subjects affected;
  - Contact details for further information;
  - Likely consequences of the breach;
  - Measures taken or proposed to address the breach and mitigate its effects.

### 9.2. Notification to OAIC

Where the breach constitutes an Eligible Data Breach under Part IIIC of the Privacy Act, the Processor shall assist the Controller in notifying the OAIC within **30 days** as required by the Notifiable Data Breaches scheme.

### 9.3. GDPR Notification

Where the GDPR applies, the Processor shall assist the Controller in notifying the relevant supervisory authority within 72 hours and affected data subjects without undue delay where the breach is likely to result in a high risk to their rights and freedoms.

### 9.4. Cooperation

The Processor shall cooperate with the Controller in investigating and remediating any breach, including preserving evidence and implementing corrective measures.

### 9.5. Records

The Processor shall maintain a register of all breaches, including facts, effects, and remedial action taken, regardless of whether notification was required.

---

## 10. Data Retention and Deletion

### 10.1. Retention Periods

| Data Category | Retention Period | Basis |
|---------------|-----------------|-------|
| Verified scam intelligence | 7 years | Public interest, threat intelligence (anonymised/PII-scrubbed) |
| Account data | Duration of account + 30 days | Contractual necessity |
| API usage and access logs | 12 months | Security monitoring, billing |
| Authentication logs | 12 months | Security monitoring |
| Transactional email records | 90 days | Operational |
| Anonymised analytics | Indefinite | No Personal Information |

### 10.2. Account Deletion

Upon Controller's request or termination of the MSA:

- (a) Account-level Personal Information shall be deleted within **30 days**;
- (b) Client Data shall be made available for export during the Transition Period (up to 90 days);
- (c) Following the Transition Period, all Client Data shall be permanently deleted from active systems within 30 days;
- (d) Backup copies shall be deleted within 90 days of the deletion from active systems.

### 10.3. Exceptions

Retention beyond the stated periods is permitted only where required by law or where data has been fully anonymised and no longer constitutes Personal Information.

### 10.4. Certification

Upon request, the Processor shall provide written certification of deletion within 10 business days of completing the deletion.

---

## 11. Audits

11.1. The Processor shall make available to the Controller all information necessary to demonstrate compliance with this DPA.

11.2. The Controller (or its appointed independent auditor) may conduct an audit of the Processor's data processing activities upon 30 days written notice, no more than once per calendar year, during business hours, and subject to reasonable confidentiality obligations.

11.3. For APRA-regulated Controllers, audit rights are extended as set out in Section 14 of the MSA.

11.4. Where multiple Controllers request audits, the Processor may satisfy this obligation by providing a current SOC 2 Type II report or equivalent independent audit report.

---

## 12. Liability

Liability under this DPA is subject to the limitations set out in the MSA.

---

## 13. Governing Law

This DPA is governed by the laws of New South Wales, Australia. Disputes are resolved in accordance with Section 17 of the MSA.

---

## 14. Contact

For data protection enquiries:

- **Privacy:** privacy@askarthur.au
- **Security incidents:** security@askarthur.au
- **Enterprise support:** enterprise@askarthur.au

---

*Ask Arthur (ABN 72 695 772 313) -- askarthur.au -- privacy@askarthur.au*
