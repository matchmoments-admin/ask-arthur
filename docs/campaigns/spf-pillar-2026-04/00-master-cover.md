# AskArthur SPF Pillar Campaign — Master Deliverables

**Date compiled:** 28 April 2026
**Verification status:** All 15 critical flags from the prior research dossier have been independently verified. See verification update for details.

This package contains eleven deliverables that together execute the prioritised action plan from the 27 April 2026 competitor scan. The campaign is structured around the 1 July 2026 SPF Act commencement window — sixty-four days from publication.

---

## What is in this package

| #   | File                                    | Type                        | Word count | Audience                                 |
| --- | --------------------------------------- | --------------------------- | ---------- | ---------------------------------------- |
| 01  | `01-pillar-blog-post.md`                | Pillar blog post            | 2,980      | Telco compliance / legal / risk leaders  |
| 02  | `02-email-davidson-idcare.md`           | Outreach email + impl notes | ~600       | Charlotte Davidson, IDCARE Group CEO     |
| 03  | `03-email-chiarelli-tpg.md`             | Outreach email + impl notes | ~700       | Giovanni Chiarelli, TPG Group CTO        |
| 04  | `04-email-walsh-vocus.md`               | Outreach email + impl notes | ~700       | Matt Walsh, Vocus CCO (via IDCARE intro) |
| 05  | `05-blog-supporting-1-penalty-units.md` | Supporting blog             | ~1,300     | Telco legal / risk                       |
| 06  | `06-blog-supporting-2-sender-id.md`     | Supporting blog             | ~1,200     | CIOs at telcos / banks / agencies        |
| 07  | `07-blog-supporting-3-five-fines.md`    | Supporting blog             | ~1,300     | Telco compliance leads                   |
| 08  | `08-linkedin-series.md`                 | Six-post series + strategy  | ~1,400     | Founder-led B2B audience                 |
| 09  | `09-aea-grant-narrative.md`             | Grant application skeleton  | ~1,400     | AEA assessors (with UNSW partner)        |
| 10  | `10-treasury-submission.md`             | Policy submission outline   | ~2,200     | Treasury / ACCC / ACMA consultations     |
| 11  | `11-claude-code-instructions.md`        | Implementation instructions | ~1,800     | Claude Code / engineering execution      |

Total deliverable word count: ~16,000 words across eleven assets, all production-ready.

---

## Verification summary

All 15 flagged items from the prior research dossier have been independently verified. Most material updates:

- **Dodo / iPrimus breach: 17 October 2025** (not 2024 — corrected throughout)
- **Charlotte Davidson: "Group CEO"** (substance interim, but title is Group CEO)
- **Lacey "4,000 referrers" quote: verbatim** — "Over 4000 organisations refer people to IDCARE, but less than a few hundred actually contribute funding to support this delivery. If your organisation is a referrer and not a funder, set things right!"
- **TPG Senior Engineer Scam & Fraud role: confirmed open** (and three other related roles)
- **TPG NASC Investment Scam Fusion Cell participation: confirmed** in the ACCC final report
- **IDCARE "Intelligence Profiling and Alerting": exact verbatim service name** on idcare.org/organisations
- **Cambodian scam centre alert: 11 February 2026**
- **Penalty unit quantum: A$330 currently; A$52,715,850 = A$52.7M** (with indexation 1 July 2026)
- **Lacey AFCA Chief Scams Officer: appointed 31 March 2026** — _much_ more significant than "publicly indicated"
- **Telco SPF code drafting: ACMA rejected ATA's draft TWICE** (24 Oct 2025 and 27 Mar 2026); ACMA now drafting mandatory standard
- **AISA CyberCon CFP CLOSED 15 April 2026** — defer to 2027 cycle
- **Apate.ai: VC-funded, NOT an AEA grant precedent** — corrected throughout

---

## Execution order

### Week 1 (Days 1–7)

**Day 1 (publication day):**

- Run `npx tsx apps/web/scripts/seed-spf-pillar-blogs.ts` (per file 11) to load all four blog drafts
- Review pillar post in `/admin/blog`; flip status to `published`
- Post LinkedIn Post 1 from file 08 with link to pillar
- Send Davidson IDCARE letter (paper + email follow-up) per file 02

**Day 4:**

- Post LinkedIn Post 2

**Day 7:**

- Publish supporting blog 3 (`five-telcos-twelve-months-acma-pattern`) from draft to published

### Week 2 (Days 8–14)

**Day 8:**

- Post LinkedIn Post 3
- Send Chiarelli TPG email per file 03 (LinkedIn InMail first, then email)

**Day 10:**

- Publish supporting blog 1 (`spf-159745-penalty-units-explained`)

**Day 13:**

- Post LinkedIn Post 4

**Day 14:**

- Publish supporting blog 2 (`sms-sender-id-register-cio-guide-2026`)

### Week 3 (Days 15–21)

**Day 15+:**

- If Davidson has acknowledged the IDCARE letter, request the Walsh / Vocus warm intro
- Send Walsh email per file 04 only after either (a) IDCARE intro confirmed or (b) 30 days have elapsed with no IDCARE traction

**Day 18:**

- Post LinkedIn Post 5

**Day 21:**

- Approach UNSW Parwada about AEA partnership; do not draft AEA application until partnership is in writing

### Week 4+ (Days 22–30+)

**Day 25:**

- Post LinkedIn Post 6 (the IDCARE pivot post)

**Day 30+:**

- Once AEA partnership is in writing, draft AEA application using file 09 skeleton
- Watch Treasury / ACCC / ACMA for next open SPF subordinate-rules consultation; submit using file 10 outline
- Federal Budget 12 May 2026 — monitor for NASC / SPF-related allocations

---

## What is NOT in this package and why

- **CyberCon Melbourne speaker submission.** CFP closed 15 April 2026. Defer to AISA branch events (smaller, monthly slots) and 2027 main programme CFP.
- **Optus outreach.** Deferred to Q3 2026 per the action plan — Optus is mid-leadership-rebuild and pitching now will get reflexive deferral.
- **Telstra outreach.** Telstra is a competitor (Quantium Telstra), not a customer.
- **Cold outreach to Apate.ai or Truyu.** These are peer-not-competitor relationships; structured introductions through OIF Ventures or x15ventures are preferable to cold contact.
- **Banking / mid-tier ADI outreach.** Recommended as a separate workstream (file 09 references COBA — the Customer Owned Banking Association — as the right channel). Not bundled here because the SPF Act content will reach that audience organically through the LinkedIn series and the pillar post's SEO traffic.

---

## Success metrics

The campaign succeeds if, by 30 days post-launch, AskArthur has achieved any three of the following six outcomes:

1. The pillar post indexes for "SPF Act telco compliance" in the top 10 Google results for Australian queries.
2. At least 5 inbound enquiries via askarthur.au or brendan@askarthur.au from telco / bank / digital platform compliance contacts.
3. A confirmed meeting with Charlotte Davidson at IDCARE.
4. A confirmed discovery call with TPG (Chiarelli or Singh) or Vocus (Walsh).
5. A signed academic partnership letter with UNSW (Parwada) for the AEA application.
6. A submitted Treasury / ACCC / ACMA consultation response that becomes part of the public record.

---

## Production-ready vs needs-customisation

**Production-ready (paste and ship):**

- 01 pillar blog post (2,980 words, fully verified)
- 05, 06, 07 supporting blogs (all verified)
- 08 LinkedIn series
- 11 Claude Code instructions

**Production-ready with minor inserts:**

- 02 Davidson email (review the implementation notes — paper letter routing requires the IDCARE postal address from idcare.org/contact-us)
- 03 Chiarelli email (verify Chiarelli LinkedIn URL before InMail)
- 04 Walsh email (contingent on IDCARE warm intro)

**Needs partner / consultation confirmation before submission:**

- 09 AEA grant narrative (requires UNSW partnership in writing)
- 10 Treasury submission (requires open consultation window)
