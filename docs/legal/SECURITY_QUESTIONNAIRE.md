# Security Questionnaire — Pre-Filled Responses

**Ask Arthur — Scam Detection Platform**

Last updated: April 2026

---

This document provides pre-filled responses to common security questionnaire topics for enterprise procurement and due diligence. For additional questions, contact brendan@askarthur.au.

**Company:** Ask Arthur
**ABN:** 72 695 772 313
**Domain:** askarthur.au

---

## 1. Data Security

| Question | Response |
|----------|----------|
| How is data encrypted at rest? | AES-256 encryption via Supabase (PostgreSQL) managed encryption. All database volumes and backups are encrypted at rest. Cloudflare R2 object storage uses AES-256 server-side encryption. |
| How is data encrypted in transit? | TLS 1.3 enforced on all connections. HSTS enabled with a minimum max-age of 1 year. All API endpoints and web traffic are served exclusively over HTTPS. |
| How are API keys stored? | API keys are hashed using SHA-256 before storage. Plaintext keys are never persisted. Keys are displayed to the user only once at creation time. |
| How is PII handled? | PII is scrubbed from submitted content before permanent storage in scam intelligence records. Email addresses and phone numbers in submitted content are hashed or redacted. Raw user content is not stored beyond the analysis processing window unless required for verified scam intelligence (anonymised). |
| What is the data retention policy? | Verified scam intelligence: 7 years (anonymised). Account data: duration of account + 30 days. API and access logs: 12 months. Authentication logs: 12 months. Account deletion completed within 30 days of request. Full details in our Data Processing Agreement. |
| Is data classified by sensitivity? | Yes. Data is classified into tiers: Public (marketing content), Internal (aggregated analytics), Confidential (account data, API keys), Restricted (raw submitted content during processing). Access controls are applied per classification level. |

---

## 2. Access Control

| Question | Response |
|----------|----------|
| How is authentication managed? | Supabase Auth with email/password and magic link authentication. Session tokens use HttpOnly, Secure, SameSite=Strict cookies. Optional multi-factor authentication available for all accounts. |
| How are sessions managed? | Sessions use HttpOnly cookies with Secure and SameSite=Strict flags. JWTs are short-lived with server-side refresh token rotation. Sessions are invalidated on password change or explicit logout. |
| Is role-based access control (RBAC) implemented? | Yes. Row-Level Security (RLS) is enforced on all Supabase database tables. Application-level roles include: User, Org Admin, and Platform Admin. API keys are scoped per organisation with configurable permissions. |
| How is administrative access controlled? | Platform administrative functions require a separate ADMIN_SECRET with timing-safe comparison. Admin operations are logged and auditable. No shared admin accounts are used. |
| Is the principle of least privilege applied? | Yes. Database access uses RLS policies that restrict queries to the authenticated user's own data and organisation. API keys have per-key scoping. Sub-processor access is limited to the minimum data required for their function. |
| Is MFA supported? | Yes. MFA is available for all user accounts and is mandatory for platform administrative access. |

---

## 3. Logging and Monitoring

| Question | Response |
|----------|----------|
| What events are logged? | Authentication events (login, logout, failed attempts), API requests (endpoint, response code, latency), data access events, administrative actions, security events (rate limit triggers, suspicious patterns), and error events. |
| How long are logs retained? | API and access logs: 12 months. Authentication logs: 12 months. Security event logs: 12 months. Anonymised analytics: indefinite. |
| Is real-time monitoring in place? | Yes. External uptime monitoring runs 24/7 from multiple geographic locations. Automated alerting for availability, latency degradation, elevated error rates, and security anomalies. Status page at status.askarthur.au. |
| Are logs tamper-proof? | Logs are stored in append-only managed services (Vercel, Supabase). Infrastructure logs are managed by the hosting providers with their own integrity controls. Log exports to long-term storage are write-once. |
| Is there a SIEM or centralised logging? | Structured logging is centralised via the platform's logging infrastructure. Logs from application, API, authentication, and security layers are aggregated for analysis and alerting. |

---

## 4. Vulnerability Management

| Question | Response |
|----------|----------|
| How are dependencies managed? | Automated dependency auditing via GitHub Dependabot and pnpm audit. Critical and high-severity vulnerabilities are patched within 48 hours. All dependencies are locked via pnpm lockfiles. |
| Is there a vulnerability disclosure policy? | Yes. Security issues can be reported to brendan@askarthur.au. We acknowledge receipt within 24 hours and aim to provide an initial assessment within 72 hours. |
| Are penetration tests conducted? | Application security testing is conducted regularly. Results and remediation timelines are available to Enterprise clients under NDA upon request. |
| How are security patches applied? | Critical patches: within 24 hours. High-severity: within 48 hours. Medium: within 7 days. Low: next scheduled release. Emergency patches may be deployed outside the standard maintenance window with best-effort notice. |
| Is static code analysis used? | Yes. TypeScript strict mode is enforced across the codebase. ESLint with security-focused rulesets. All code changes require review before merge. |

---

## 5. Incident Response

| Question | Response |
|----------|----------|
| Is there a documented incident response plan? | Yes. The incident response plan covers detection, triage, containment, eradication, recovery, and post-incident review. The plan is reviewed and tested at least annually. |
| What is the breach notification timeline? | Affected clients are notified within 72 hours of confirmed breach. OAIC notification within 30 days for Eligible Data Breaches under Part IIIC of the Privacy Act 1988. GDPR supervisory authority notification within 72 hours where applicable. |
| What post-incident deliverables are provided? | P1 incidents receive a written Post-Incident Report (PIR) within 5 business days, including: root cause analysis, incident timeline, impact assessment, remediation actions taken, and preventive measures. |
| How are incidents classified? | P1 (Critical): Platform unavailable or core function non-operational. P2 (High): Significant degradation affecting a subset of users. P3 (Medium): Minor issue or non-critical feature impacted. |

---

## 6. Infrastructure

| Question | Response |
|----------|----------|
| Where is data hosted? | Primary database: Supabase, ap-southeast-2 region (Sydney, Australia). Application hosting: Vercel, syd1 region (Sydney, Australia). CDN and edge: Cloudflare with Oceania hint (Sydney). Rate limiting: Upstash Redis (Singapore). |
| Is infrastructure multi-tenant or single-tenant? | Multi-tenant with logical isolation. Row-Level Security (RLS) on all database tables enforces strict tenant separation at the database level. Enterprise clients may request dedicated infrastructure under custom agreements. |
| What CDN/DDoS protection is used? | Cloudflare provides CDN, WAF, and DDoS mitigation globally. Traffic is routed through Cloudflare's network before reaching origin servers. |
| What is the disaster recovery strategy? | Continuous database backups with point-in-time recovery. Recovery Time Objective (RTO): 4 hours. Recovery Point Objective (RPO): 1 hour. DR plans tested at least annually. Backups stored in a geographically separate region. |
| Is the infrastructure defined as code? | Application deployment is managed via Vercel with Git-based deployments. Database migrations are version-controlled (v2 through v56+). Infrastructure configuration is declarative and reproducible. |
| What is the uptime target? | 99.9% monthly uptime as defined in the Service Level Agreement. Maintenance window: Sunday 02:00-04:00 UTC. |

---

## 7. Compliance

| Question | Response |
|----------|----------|
| What privacy legislation is complied with? | Australian Privacy Act 1988 (Cth), including the Australian Privacy Principles (APPs) and the Privacy and Other Legislation Amendment Act 2024 (POLA 2024). GDPR compliance where applicable for EU/EEA data subjects. |
| Is a Data Processing Agreement available? | Yes. A comprehensive DPA is available covering data types, processing purposes, sub-processor list, retention periods, breach notification, cross-border transfers (APP 8), GDPR SCCs, and POLA 2024 provisions. |
| Are CPS 230/CPS 234 provisions supported? | Yes. The MSA includes specific provisions for APRA-regulated clients, including audit rights, business continuity commitments, information security controls, sub-contractor notification, and APRA access rights. |
| What certifications do sub-processors hold? | Supabase: SOC 2 Type II. Vercel: SOC 2, ISO 27001. Cloudflare: SOC 2, ISO 27001. Resend: SOC 2. Twilio: SOC 2 Type II. Anthropic: Enterprise DPA. |
| Is there a privacy policy? | Yes, published at askarthur.au/privacy. Updated to reflect POLA 2024 requirements. |
| How are cross-border transfers handled? | APP 8 compliance: contractual protections with overseas sub-processors, selection of certified providers, Australian data regions prioritised (Sydney). GDPR SCCs (Module 2) available for EU/EEA data transfers. |

---

## 8. Third-Party Risk Management

| Question | Response |
|----------|----------|
| How are third-party vendors assessed? | Vendors are assessed based on: security certifications (SOC 2, ISO 27001), data processing agreements, data residency options, incident response capabilities, and business continuity provisions. Assessments are reviewed annually. |
| What third-party services are used for core functionality? | See sub-processor table below. |
| Are sub-processor changes communicated? | Yes. Clients are notified at least 30 days before any new sub-processor is engaged or material changes are made to existing sub-processor arrangements. Clients may object within 14 days. |

### Sub-processor Summary

| Provider | Service | Data Region | Certifications |
|----------|---------|-------------|----------------|
| Supabase Inc. | Database, authentication, RLS | ap-southeast-2 (Sydney) | SOC 2 Type II |
| Vercel Inc. | Application hosting, edge functions | syd1 (Sydney) | SOC 2, ISO 27001 |
| Cloudflare Inc. | CDN, WAF, DDoS, R2 storage | Oceania (Sydney) | SOC 2, ISO 27001 |
| Resend Inc. | Transactional email | USA | SOC 2 |
| Anthropic PBC | AI scam analysis (Claude) | USA | Enterprise DPA |
| Twilio Inc. | Phone number intelligence | USA | SOC 2 Type II |
| Upstash Inc. | Redis rate limiting, caching | Singapore | N/A |

---

## 9. Application Security

| Question | Response |
|----------|----------|
| What web security headers are implemented? | Content Security Policy (CSP) without unsafe-eval, Strict-Transport-Security (HSTS), X-Content-Type-Options: nosniff, X-Frame-Options: DENY, Referrer-Policy: strict-origin-when-cross-origin, Permissions-Policy restricting sensitive APIs. |
| How is input validated? | All external input is validated using Zod schemas with strict typing. API endpoints reject malformed input with structured JSON error responses. URL, email, and phone inputs are validated against format-specific schemas. |
| How are rate limits enforced? | Upstash Redis-based rate limiting with per-IP and per-API-key sliding windows. Rate limiters are configured to fail-closed in production (requests are rejected if the rate limiter is unavailable). x-real-ip is used as the primary IP source (Vercel-provided). |
| Is there CSRF protection? | Yes. SameSite=Strict cookie policy prevents cross-site request forgery. API endpoints use API key authentication (not cookie-based) for programmatic access. |
| How are secrets managed? | Environment variables managed through Vercel's encrypted environment variable system. Secrets are never committed to source control. .env files are gitignored. API keys are hashed (SHA-256) before database storage. Timing-safe comparisons used for all secret verification. |
| Are webhook endpoints secured? | Yes. All bot webhook endpoints (Telegram, WhatsApp, Slack, Messenger) require signature verification. Webhook secrets are stored as environment variables and verified using timing-safe comparison. |

---

## Contact

For security enquiries, audit requests, or additional questionnaire responses:

- **Security:** brendan@askarthur.au
- **Enterprise sales:** brendan@askarthur.au
- **Privacy:** brendan@askarthur.au

---

*Ask Arthur (ABN 72 695 772 313) -- askarthur.au -- brendan@askarthur.au*
