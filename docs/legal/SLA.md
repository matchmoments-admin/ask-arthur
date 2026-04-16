# Service Level Agreement

**Ask Arthur — Scam Detection Platform**

Last updated: April 2026

---

## 1. Overview

This Service Level Agreement ("SLA") is incorporated into and forms part of the Master Service Agreement ("MSA") between Ask Arthur (ABN 72 695 772 313) ("Provider") and the Client identified in the applicable Order Form.

This SLA defines the availability, performance, support, and remediation commitments for the Ask Arthur Platform.

---

## 2. Definitions

| Term | Meaning |
|------|---------|
| **Downtime** | Any period where the Platform API returns HTTP 5xx errors for more than 50% of requests over a 5-minute rolling window, as measured by Provider's external monitoring |
| **Monthly Uptime Percentage** | (Total minutes in month - Downtime minutes) / Total minutes in month x 100 |
| **Maintenance Window** | Sunday 02:00 - 04:00 UTC, reserved for scheduled maintenance |
| **Excluded Downtime** | Downtime not counted toward Monthly Uptime Percentage (see Section 4) |
| **Service Credit** | A credit against future Subscription Fees, calculated as set out in Section 5 |

---

## 3. Availability Target

3.1. **Uptime Commitment.** Provider targets a Monthly Uptime Percentage of **99.9%** for the Platform API and web application.

3.2. This equates to a maximum of approximately 43.8 minutes of Downtime per calendar month.

3.3. Uptime is measured continuously using independent external monitoring from multiple geographic locations including Australia.

---

## 4. Exclusions

The following are excluded from Downtime calculations:

- (a) Scheduled maintenance performed during the Maintenance Window (Sunday 02:00 - 04:00 UTC), provided at least 48 hours notice is given for non-routine maintenance;
- (b) Emergency maintenance required to address critical security vulnerabilities, with notice given as soon as practicable;
- (c) Force majeure events as defined in the MSA;
- (d) Client-caused issues, including misconfigured API integrations, exceeding rate limits, or invalid authentication;
- (e) Failures of third-party services outside Provider's reasonable control (e.g., upstream internet connectivity);
- (f) Features or services explicitly designated as "beta" or "preview".

---

## 5. Service Credits

5.1. If Provider fails to meet the Monthly Uptime Percentage, Client is entitled to Service Credits as follows:

| Monthly Uptime Percentage | Service Credit (% of monthly fee) |
|---------------------------|-----------------------------------|
| 99.0% to < 99.9% | 10% |
| 95.0% to < 99.0% | 20% |
| Below 95.0% | 30% |

5.2. **Maximum Credit.** Total Service Credits for any calendar month shall not exceed **30%** of the monthly Subscription Fee for that month.

5.3. **Claim Process.** Client must submit a Service Credit request within 30 days of the end of the affected month by emailing enterprise@askarthur.au with the dates and times of observed Downtime. Provider shall respond within 10 business days.

5.4. **Application.** Service Credits are applied to future invoices and are not redeemable for cash. Service Credits are Client's sole and exclusive remedy for failure to meet the uptime target.

---

## 6. Performance Targets

6.1. Provider targets the following API response time benchmarks, measured at the 99th percentile (p99) from Provider's edge network:

| Endpoint Type | p99 Target |
|---------------|------------|
| Standard scam check (text/URL) | < 500 ms |
| Deep analysis (image, multi-signal) | < 2,000 ms |
| Dashboard and reporting APIs | < 1,000 ms |
| Health check / status | < 100 ms |

6.2. Performance targets are measured monthly and reported in Provider's status dashboard.

6.3. Performance targets are objectives, not commitments subject to Service Credits. Sustained failure to meet performance targets will be addressed through the support process.

---

## 7. Scheduled Maintenance

7.1. **Maintenance Window.** The standard Maintenance Window is **Sunday 02:00 - 04:00 UTC** each week.

7.2. **Advance Notice.** Provider shall give at least:

- 48 hours notice for routine maintenance;
- 7 days notice for maintenance expected to cause Downtime exceeding 30 minutes;
- Best-effort notice for emergency security patches (target: 4 hours).

7.3. **Communication.** Maintenance notices are published via:

- Email to Client's designated technical contact;
- Provider's status page at status.askarthur.au;
- In-dashboard notification banner.

7.4. **Minimisation.** Provider shall use commercially reasonable efforts to minimise Downtime during maintenance, including rolling deployments and zero-downtime migrations where feasible.

---

## 8. Support Tiers

8.1. Support is provided according to the Client's subscription tier:

| Feature | Essential (Pro) | Professional (Business) | Enterprise |
|---------|----------------|------------------------|------------|
| **Channels** | Email, Help Centre | Email, Help Centre, Chat | Email, Chat, Phone, Slack Connect |
| **Hours** | Business hours (AEST) | Extended hours (06:00 - 22:00 AEST) | 24/7 |
| **Initial Response (P1)** | 4 business hours | 1 hour | 15 minutes |
| **Initial Response (P2)** | 8 business hours | 4 hours | 1 hour |
| **Initial Response (P3)** | 2 business days | 1 business day | 4 hours |
| **Dedicated CSM** | No | No | Yes |
| **Quarterly Reviews** | No | No | Yes |
| **Custom Integrations** | No | Limited | Yes |

8.2. **Contact Details.** Support requests should be directed to:

- Email: enterprise@askarthur.au
- Help Centre: help.askarthur.au

---

## 9. Priority Definitions

| Priority | Definition | Examples |
|----------|-----------|----------|
| **P1 -- Critical** | Platform is unavailable or a core function is completely non-operational, affecting all or most users. No workaround available. | API returning 5xx for all requests; authentication system down; data loss event |
| **P2 -- High** | Significant degradation of a core function affecting a subset of users or a single Client. Workaround may be available. | Intermittent API failures; analysis accuracy degradation; single-tenant outage; dashboard inaccessible |
| **P3 -- Medium** | Minor issue or non-critical feature impacted. Operations continue with minimal disruption. | UI rendering issues; delayed email notifications; non-critical reporting errors; feature requests |

---

## 10. Incident Management

10.1. **Detection.** Provider operates 24/7 automated monitoring with alerting for availability, latency, error rates, and security events.

10.2. **Incident Communication.** Upon detection of a P1 or P2 incident, Provider shall:

| Stage | Timeline | Action |
|-------|----------|--------|
| **Acknowledgement** | Within response SLA (per tier) | Confirm incident via status page and direct notification to affected Clients |
| **Updates** | Every 30 minutes (P1) / 60 minutes (P2) | Status update via status page and email |
| **Resolution** | As soon as practicable | Confirmation of resolution via status page and email |
| **Post-Incident Report** | Within 5 business days (P1) / 10 business days (P2) | Root cause analysis, timeline, remediation steps, and preventive measures |

10.3. **Escalation.** Enterprise clients may escalate unresolved incidents through their dedicated Customer Success Manager or by contacting enterprise@askarthur.au with "ESCALATION" in the subject line.

10.4. **Post-Incident Reports.** For P1 incidents, Provider shall deliver a written post-incident report ("PIR") that includes:

- Incident timeline;
- Root cause analysis;
- Impact assessment;
- Remediation actions taken;
- Preventive measures to avoid recurrence.

---

## 11. Disaster Recovery

11.1. **Recovery Objectives.**

| Metric | Target |
|--------|--------|
| Recovery Time Objective (RTO) | 4 hours |
| Recovery Point Objective (RPO) | 1 hour |

11.2. **Backups.** Database backups are performed continuously with point-in-time recovery capability. Backups are stored in a geographically separate region.

11.3. **DR Testing.** Provider tests its disaster recovery plan at least annually and provides a summary of test results to Enterprise clients upon request.

---

## 12. Monitoring and Reporting

12.1. **Status Page.** Real-time platform status is available at status.askarthur.au.

12.2. **Monthly Reports.** Enterprise clients receive monthly service reports including:

- Monthly Uptime Percentage;
- API latency percentiles (p50, p95, p99);
- Incident summary;
- Support ticket metrics.

12.3. **Quarterly Reviews.** Enterprise clients receive quarterly business reviews covering service performance, roadmap updates, and optimisation recommendations.

---

## 13. Amendments

This SLA may be updated by Provider with at least 30 days notice to Client. Material changes adverse to Client will not take effect until the next renewal term unless Client consents.

---

*Ask Arthur (ABN 72 695 772 313) -- askarthur.au -- enterprise@askarthur.au*
