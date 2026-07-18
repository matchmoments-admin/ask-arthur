# Brand-facing communications — legal review pack

**Status:** DRAFT for external legal review · authored 2026-07-18 · owner: founder
**Purpose:** the hand-off artifact a lawyer reviews before Ask Arthur turns on any
brand-facing outbound send. It pairs draft copy with the specific legal decisions
embedded in each line, so the reviewer marks up *choices*, not blank pages.

> **This document is not legal advice.** It is scaffolding written to make a real
> review fast and cheap. Every "mitigation" below is a drafting hypothesis for a
> qualified Australian lawyer to confirm, reject, or refine. Do not flip any send
> flag until this pack has been reviewed and signed off (tracked as issue #805 /
> #371).

---

## Why this exists

Ask Arthur detects lookalike/clone domains impersonating Australian brands, tracks
when a lookalike "weaponises" (goes live as a phishing site), and can run managed
takedown on a brand's behalf. Turning that intelligence into **outbound brand
communications** crosses from "we observe" into "we assert things to third parties
about other third parties" — which is where legal risk concentrates.

Five surfaces send (or will send) brand-facing content. Each is gated behind a
feature flag today precisely so this review can gate the flip:

| # | Surface | Flag | Sends to | Automated? |
|---|---------|------|----------|-----------|
| 1 | Cold pilot outreach email | *(none — manual composer)* | prospect brand's security/role inbox | No — founder composes each |
| 2 | Monthly brand-stewardship report | `FF_BRAND_STEWARDSHIP_SEND` | monitored brand's verified contact | Yes |
| 3 | Real-time weaponisation alert | `FF_CLONE_WEAPONISED_ALERT` | monitored brand's verified contact | Yes |
| 4 | Managed takedown request | *(takedown send gate)* | registrar / host / Netcraft / abuse desks | Yes |
| 5 | SPF evidence appendix (inside #2) | *(ships with the report)* | monitored brand's contact | Yes |

---

## The five risk axes (defined once, referenced per surface)

### A. Defamation (uniform Defamation Acts, state-based)
The load-bearing risk. Stating that a third-party **domain or its registrant is a
scam / fraud / criminal** can defame that registrant — even if we're warning their
victim. The registrant, not just the brand, is a potential plaintiff.
- **Available defences** to keep in reach: *justification/truth* (the statement is
  substantially true), *honest opinion* (clearly opinion, based on stated facts, on
  a matter of public interest), and *qualified privilege* (a communication made to a
  recipient with a legitimate interest in receiving it — an impersonated brand has a
  clear interest in knowing about domains impersonating it).
- **Drafting mitigations:** state **observable facts + our automated
  classification**, never a bare conclusion about a person. "A domain our system
  detected as designed to resemble yours" / "classified as likely-phishing by
  [vendor] on [date]" — not "the criminals who are defrauding you." Attach the
  evidence. **Never name an individual** as the perpetrator. Prefer verifiable,
  time-stamped, machine-derived statements over characterisations.

### B. Spam Act 2003 (Cth)
Commercial electronic messages need: (1) **consent** — express, or *inferred* via
conspicuous publication of a business role address where the message relates to that
role; (2) **sender identification**; (3) a **functional unsubscribe**.
- The monthly report / alert to a **published `security@` / `abuse@` role address**,
  about that organisation's own brand-abuse exposure, is a strong candidate for
  *inferred consent* — but the reviewer should confirm the boundary, especially for
  the **cold pilot outreach** (surface 1), which is the closest to the line.
- (2) and (3) are already implemented in code: every send carries List-Unsubscribe
  (RFC 2369 + 8058 one-click), a mailto STOP fallback, and the ABN/sender block.

### C. Australian Consumer Law (Competition and Consumer Act 2010, Sch 2)
s18 (misleading or deceptive conduct) + s29 (false representations about services).
- Do **not** imply official / regulator / law-enforcement status.
- Do **not** overstate capability or **guarantee** a takedown or SPF-compliance
  outcome.
- Do **not** imply affiliation with, or endorsement by, the brand.

### D. SPF-compliance framing
Never state or imply Ask Arthur **assesses or certifies the recipient's compliance**
with the Scams Prevention Framework. The mandated phrase across all brand comms:
> *"This is evidence of Ask Arthur's own detections and actions — not an assessment
> of your organisation's SPF compliance."*
(Already applied to the SPF evidence appendix; this pack extends it to every surface.)

### E. Privacy Act 1988 (APPs)
Registrant PII (names, ABNs from RDAP/WHOIS) is constrained upstream and must stay
out of brand-facing copy **except where the brand itself is the data subject**.
Derived, non-identifying signals ("registrar-suspended", "ABN cancelled") are safe;
a named registrant individual is not.

### F. (Minor) Trademark / passing-off
Using a brand's name to *identify* it (nominative use) is fine. Do not use their
logo/marks in a way that implies endorsement or partnership.

---

## Surface 1 — Cold pilot outreach email

**Purpose:** founder's first personal contact with a prospect brand from the
clone-watch shortlist, offering a pilot. **Manual, four-eyes** — the founder writes
and reviews every send (the `/admin/brand-outreach` composer), which is why it has
no automation flag. That manual nature is itself the primary legal control.

**Primary risks:** B (Spam Act — cold B2B), C (no overstated claims), A (any
specific clone claim in the body).

**Sample copy (annotated):**

> Subject: A coordinated operation is registering fake {{Brand}} domains
>
> Hi {{name or team}},
>
> I run Ask Arthur, an Australian scam-detection service. Our system has been
> tracking newly-registered domains that appear designed to impersonate {{Brand}}
> — **{{N}} so far**, and {{M}} of them trace to the same operator that's also
> targeting {{K}} other Australian brands. [¹]
>
> I'm reaching out because a few of these have already moved from "parked" to
> **live phishing pages**, and I thought {{Brand}} would want visibility. [²] I've
> attached what we've observed. There's nothing to buy in this email — I'd just
> value 20 minutes to show you the evidence and see if it's useful. [³]
>
> If you'd rather not hear from me, reply STOP or use the unsubscribe link below. [⁴]
>
> — {{Founder}}, Ask Arthur · ABN 72 695 772 313 · Sydney

- **[¹]** "appear designed to impersonate" + "our system has been tracking" — Axis A:
  factual + our-classification framing, no assertion that a named person is a
  criminal. **Lawyer Q:** is "coordinated operation" / "same operator" defensible as
  honest opinion based on the attached campaign-linkage evidence?
- **[²]** "moved from parked to live phishing pages" — a time-stamped observable, not
  a characterisation. Attach the urlscan/detection evidence. **Lawyer Q:** acceptable?
- **[³]** "nothing to buy in this email" + no capability guarantee — Axis C.
- **[⁴]** unsubscribe + sender ID — Axis B (already coded).

**Lawyer decisions for this surface:**
1. Does cold B2B outreach to a published `security@` address, about that org's own
   brand exposure, sit inside Spam Act inferred consent?
2. Is the "coordinated operation targeting you + K others" claim safe as attached-
   evidence-based opinion, or should it be softened further?
3. Any required disclaimer we're missing for a commercial cold approach?

---

## Surface 2 — Monthly brand-stewardship report

**Purpose:** automated monthly summary to a **verified** brand contact:
detections, weaponisations, takedowns, and the SPF appendix (surface 5).
Code already enforces: verified-contact gate (`known_brands.last_verified_at`),
unsubscribe honouring, shadow-recipient validation path, idempotency.

**Primary risks:** A (per-domain claims at volume), D (SPF framing), B (cadence
consent).

**Copy principles (not a fixed template — the report is data-driven):**
- Lead with **coordination and timeline**, stated as facts: "17 lookalike domains
  detected; 3 classified as live-phishing; median time from registration to live
  phishing across your cohort: ~33 hours." No adjectives about perpetrators.
- Every per-domain row shows: the domain, the **observed status** (parked / live /
  registrar-suspended), the **detection timestamp**, and the **classifying source**.
- The report describes **what Ask Arthur did** (detected, reported to X), never what
  the brand "must" do.
- Footer carries the Axis-D disclaimer verbatim.

**Lawyer decisions:**
1. Is a recurring monthly send to a verified role address inside inferred consent, or
   do we need explicit opt-in at first contact?
2. Sign-off on the standing per-domain status vocabulary (parked / lookalike /
   likely-phishing / registrar-suspended) as non-defamatory descriptors.

---

## Surface 3 — Real-time weaponisation alert

**Purpose:** automated, event-triggered email the moment a tracked lookalike flips
to live-phishing. **Highest defamation exposure** — it makes the sharpest claim
("this specific domain is now phishing you") at the moment of least human review.

**Primary risks:** A (sharpest single claim), C (urgency ≠ guarantee).

**Sample copy (annotated):**

> Subject: A fake {{Brand}} site just went live
>
> At {{timestamp AEST}}, a domain we've been tracking — `{{domain}}` — was
> **classified as a live phishing page** by {{vendor}}. [¹] It had been registered
> on {{reg_date}} and was previously inactive. Evidence and screenshot: {{link}}. [²]
>
> We've {{already reported it to / are reporting it to}} {{destinations}}. [³] This
> is our automated detection, shared so your team has early visibility — not an
> assessment of your SPF compliance. [⁴]

- **[¹]** attributed classification with source + timestamp — Axis A. **Lawyer Q:**
  is "classified as a live phishing page by {{vendor}}" the safest possible phrasing
  vs. e.g. "displaying characteristics of"?
- **[²]** evidence attached — supports justification/qualified privilege.
- **[³]** describes our action, no takedown guarantee — Axis C.
- **[⁴]** Axis-D disclaimer.

**Lawyer decisions:**
1. For the automated, low-latency path, do we need a **confidence floor** (only alert
   at ≥X detection confidence) as a legal control, not just a product one?
2. Is naming the classifying vendor helpful (shifts the assertion) or harmful
   (implies their endorsement of our email)?

---

## Surface 4 — Managed takedown request

**Purpose:** outbound request to registrars, hosts, and abuse desks (incl. the
Netcraft reporter) asking them to action a domain, on the brand's behalf.

**Primary risks:** A (asserting abuse to a third party who may act on it), C
(authority to act for the brand), and a distinct one: **authority/agency** — we
must not overstate that we act *as* the brand.

**Copy principles:**
- Frame as a **report with evidence**, requesting review under the recipient's own
  abuse policy — not a demand or a legal notice.
- State the factual basis (impersonation of {{Brand}}, evidence attached) and that we
  report **on behalf of / with the authorisation of** {{Brand}} **only where a
  monitored-brand authorisation actually exists** — never imply authority we don't
  hold.
- No threats of legal action we're not instructed/able to bring.

**Lawyer decisions:**
1. What authorisation record must exist (a signed pilot/managed-takedown term?)
   before we may say "on behalf of {{Brand}}"?
2. Preferred language for the evidence-based report to avoid both defamation of the
   registrant and misrepresentation of agency.
3. Do takedown requests need brand sign-off per-instance, or a standing mandate in
   the managed-tier contract?

---

## Surface 5 — SPF evidence appendix (inside Surface 2)

Already drafted with the Axis-D framing (PR #812, `docs/plans/assets/spf-evidence-
appendix-template.md`). Included here so the reviewer confirms the **one line that
matters most**:
> *"This appendix is evidence of Ask Arthur's detections and actions. It is not, and
> must not be read as, an assessment or certification of {{Brand}}'s compliance with
> the Scams Prevention Framework."*
Plus: every SPF clause citation is marked "exposure draft, 28 May 2026 — re-verify at
finalisation" so we never misstate the law's current force.

**Lawyer decision:** is that disclaimer sufficient to avoid an implied-certification /
misleading-conduct claim, or does it need strengthening / relocating to the top?

---

## Consolidated decision checklist for the reviewer

1. **Spam Act inferred-consent boundary** for (a) cold pilot outreach and (b)
   recurring monthly sends to published role addresses.
2. **Defamation-safe vocabulary**: sign off the standing descriptor set (parked /
   lookalike / likely-phishing / registrar-suspended / coordinated-campaign) and the
   "our-system-classified" framing as the house style across all surfaces.
3. **Confidence floor** as a legal control on the automated weaponisation alert.
4. **Authority language** for takedown requests + what authorisation record must
   exist before "on behalf of {{Brand}}."
5. **SPF disclaimer** sufficiency and placement.
6. **Individual-naming rule**: confirm the blanket "never name a registrant
   individual in brand-facing copy" as policy.
7. Any **required disclaimer / footer** we're missing for commercial cold approaches.

Once these seven are settled, the flag flips (`FF_BRAND_STEWARDSHIP_SEND`,
`FF_CLONE_WEAPONISED_ALERT`, the takedown-send gate) become a clean mechanical step,
and the outreach composer's copy can be locked to the approved house style.

## How to run the review cheaply
This pack is deliberately structured so a lawyer bills for *decisions*, not drafting.
A fixed-fee commercial/tech lawyer (or an AU service like LegalVision) reviewing
pre-drafted copy + a seven-item checklist is a ~2-hour engagement, not a project.
Send this file; apply the markup; flip the flags.
