# Small-start commercial plan

Prepared 2026-09-08. Targets below are decision rules proposed for this launch, not forecasts or observed customer demand.

## One audience engine and one paid offer

Keep consumer checking and Arthur’s Watch free. Publish one useful issue weekly, distribute through the founder’s LinkedIn account and warm community partners, and ask readers what was useful. Start without paid acquisition or another newsletter platform. The paid offer is the existing Brand Monitor pilot, consistent with NORTH_STAR: A$300/month after a first month free. Confirm the existing billing terms, GST treatment and supported service scope before quoting or charging; no new checkout implementation is required for this experiment.

Cap the first cohort at three organisations so delivery stays personal. Three retained pilots would represent A$900/month in gross subscription revenue before tax, fees and delivery costs; this is arithmetic, not projected revenue. Track actual staff time and provider costs separately. Expand only after a customer finds the evidence useful enough to keep paying.

## Reviewable pilot offer

**For:** a brand owner receiving reports of impersonation or lookalike websites, with a named person responsible for reviewing alerts.

**Offer:** a one-month Brand Monitor trial using the existing supported monitoring and report workflow. Agree the exact brands/domains and available coverage before activation. Hold a short onboarding conversation, review findings weekly, and end with a usefulness assessment. A lack of findings does not establish absence of impersonation.

**Boundary:** detection coverage, takedown, recovery of funds and prevention of every scam are not guaranteed. Do not sell features that are disabled or unverified. Any reporting or takedown action follows the existing authorised workflow.

**Price:** first month free, then A$300/month if the customer chooses to continue under the verified billing terms. Explain renewal and cancellation before enrolment; do not silently convert a verbal trial into a charge.

**Acceptance evidence:** customer confirms the scope, an authorised account can view its own reports, an alert reaches the nominated inbox, a second organisation cannot view those reports, and cancellation is demonstrated. Local unit tests do not satisfy these live checks.

## Warm prospect message — draft, not sent

“Hi [name], I’m testing a small Brand Monitor pilot for businesses dealing with online impersonation. We agree the brands and supported coverage, review the findings together, and assess whether the evidence is useful to your team. The first month is free; continuing is A$300/month under the agreed terms. Would a 20-minute conversation about your current process be useful? No need to send customer data.”

## Customer interview guide

1. Tell me about the last suspicious site or impersonation report your team handled.
2. Who discovered it, and how long did the team spend checking it?
3. What evidence did you need before taking action?
4. Which part of your current process was hardest or slowest?
5. Who owns the decision and budget for improving this process?
6. What would make a month of this pilot useful enough to continue at A$300?
7. What coverage or workflow would make the offer unsuitable?

Record anonymised themes and explicit next steps. Ask permission before quoting anyone. A polite expression of interest is not a paying customer.

## Weekly scorecard

| Measure                           | Definition                                                             | Current evidence / entry                                                    |
| --------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Confirmed readers                 | Active email_subscribers rows                                          | 0 at 2026-09-07 21:21 UTC; see readiness-baseline.json                      |
| New confirmations                 | Confirmed readers gained during week, account for opt-outs separately  | Not instrumented as an immutable event history; record weekly snapshots     |
| Accepted newsletter sends         | Provider returns message id                                            | Code now checks receipts; not proof of inbox delivery                       |
| Newsletter-driven useful checks   | Existing first-party attribution plus voluntarily reported usefulness  | Establish baseline after controlled acceptance; no invented conversion rate |
| Reader replies                    | Substantive feedback, manually counted                                 | Not measured yet                                                            |
| Unsubscribes / complaints         | Suppression records and provider reporting, no raw emails in scorecard | Not measured yet                                                            |
| Partner conversations             | Actual two-way discussions                                             | Not started                                                                 |
| Qualified pilot conversations     | Scope and decision owner established                                   | Not started                                                                 |
| Trial starts / paid continuations | Agreed starts and verified payment outcomes                            | Not started                                                                 |
| Revenue / costs / founder hours   | Actual receipts, provider usage and logged delivery time               | Not measured yet                                                            |

## Four-week sequence

- **Before week 1:** finish release acceptance, confirm one controlled inbox, approve issue 1 and the exact publication/send audience. Prepare five warm contacts; send only after authorisation.
- **Week 1:** publish issue 1, ask two readers to describe their checking experience, hold two partner conversations. Fix observed signup/checker obstacles before adding features.
- **Week 2:** publish issue 2, interview two qualified brand owners, offer at most three scoped trials. Avoid custom feature promises.
- **Week 3:** publish issue 3, review any pilot findings with the customer, measure delivery time. Prepare a workshop outline only if interviews show demand for teaching rather than monitoring.
- **Week 4:** publish issue 4, request an explicit pilot continuation decision, review the scorecard and decide whether to try the four-video experiment.

If warm outreach produces no qualified conversations, change the audience or problem statement before building another product. If people start checking but cannot understand the result, improve that result flow first. Sponsorships, ads and paid consumer subscriptions remain deferred until repeat usefulness and an audience are demonstrated.

## Gaps that still matter

1. No active reader base at the verified baseline: distribution and feedback are the next constraint.
2. Schema deployment state needs reconciliation: the ledger’s latest recorded name is v280 while this branch starts from repository migrations through v302. This does not prove all later schema is missing; inspect objects and deployment records before applying anything.
3. Provider acceptance is not inbox delivery. Confirm sender authentication, complaint webhook configuration and actual delivery through a controlled test.
4. A confirmed-signup event history and end-to-end attribution are not yet established. Do not report consent_at snapshots as exact historical conversion analytics.
5. Pilot value is unproven. A passing billing/auth test suite is not customer validation or live billing acceptance.
6. Retention cleanup is bounded to 500 pending rows per weekly run. At the request cap, backlog can grow; measure backlog before expanding acquisition and move cleanup to a more frequent bounded job if needed.
