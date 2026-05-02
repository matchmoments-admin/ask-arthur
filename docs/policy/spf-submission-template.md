# Treasury SPF Subordinate-Rules Submission — Outline

**Submission target:** Any open Treasury, ACCC, or ACMA consultation on SPF subordinate rules between now and end of 2026. The Treasury industry-codes consultation closed 5 January 2026, but follow-on subordinate-rules drafting is active through 2026 and ACMA's mandatory industry standard (post the 27 March 2026 TCP Code rejection) will have its own consultation window.

**Strategic posture:** This submission is not a sales pitch. It is a constructive, technical contribution from a small Australian-built provider. The submission should read as if written by a sovereign-tech advocate, not a vendor. The benefit to AskArthur is that every Treasury / ACCC / ACMA submission becomes a permanent search-indexed credibility artefact; the secondary benefit is that AskArthur's positioning _becomes_ the regulatory floor.

**Length:** 8–12 pages. Treasury submissions over 15 pages are not read in detail.

**Format:** PDF on AskArthur letterhead, ABN footer, named author (Brendan Milton, Founder), executive summary on page 1.

---

## Cover note

Submitter: AskArthur Pty Ltd, ABN 72 695 772 313
Sole director and author: Brendan Milton
Sector: Australian-built scam-intelligence platform; B2B Threat Intelligence API provider; consumer scam-detection tool
Authority to speak on the matter: AskArthur is a sole-trader-scale Australian Pty Ltd that operates a production scam-detection platform across seven consumer surfaces, six B2B API endpoints, and sixteen continuous threat feeds. The submission represents the engineering perspective of a vendor that would be one of dozens supplying the SPF detection layer to regulated entities.

---

## Executive summary (page 1)

AskArthur welcomes the _Scams Prevention Framework Act 2025_ and the proposed subordinate-rules architecture. We make six specific recommendations to strengthen the framework's operational practicality:

1. **Specify a machine-readable verdict-layer architecture** for Actionable Scam Intelligence that regulated entities can reasonably implement and that regulators can audit at scale.

2. **Define time-bound obligations in concrete latency budgets** (e.g. < 200ms p95 for Detect-trigger verdicts) rather than the current "immediately" formulation, which is operationally ambiguous.

3. **Add a Schedule 2 of currently excluded sectors** (online marketplaces, dating apps, gaming platforms, app stores, large email providers, Facebook Marketplace) with a designation timeline. The current designation is too narrow to address the actual loss surface.

4. **Require machine-readable evidence trails** with structured verdict, confidence, source-attribution, and timestamp fields, suitable for AFCA EDR review without manual data extraction.

5. **Reference ACMA's revealed enforcement preference** — the pattern of identity-verification failures across six telco penalties from 2024–2026 — in the subordinate-rules guidance, to anchor the rules in observed regulatory practice.

6. **Provide a sovereign-data-residency carve-out** for SPF detection providers, recognising that scam-intelligence data is a national-security asset.

---

## Body sections

### 1. The verdict-layer architecture (~600 words)

The SPF Detect principle requires regulated entities to identify scam activity in time to act. The Treasury position paper specifies _Actionable Scam Intelligence_ as the data substrate, and defines this as a _reasonable belief_ that activity is or may be a scam.

A _reasonable belief_ is not a directly machine-instantiable concept. In practice, regulated entities will operationalise reasonable belief through some combination of:

- a verdict (a discrete output: SAFE / SUSPICIOUS / HIGH_RISK or equivalent);
- a confidence score (0.0–1.0);
- a set of source attributions (which threat feeds, which intelligence sources, which timestamps contributed to the verdict);
- a derivation trail (the inputs that produced the verdict).

The subordinate rules are silent on this architecture. We recommend the rules specify a _minimum_ verdict-layer architecture that regulated entities must implement, leaving the implementation choice to the entity but ensuring auditability across the sector.

A reasonable specification would require: at least three verdict states (binary verdicts are insufficient for policy nuance); a documented confidence calibration; named source attributions with timestamps; and a derivation trail accessible for AFCA EDR review for at least 7 years.

This is not an exotic ask. AskArthur's three-tier verdict (SAFE / SUSPICIOUS / HIGH*RISK) with confidence score, source attribution, and full derivation trail is one of several reference implementations. Other vendors will have different but compatible architectures. The point is that the rules should \_require* the architecture exists, not specify which vendor produces it.

### 2. Latency budgets for time-bound obligations (~400 words)

The Treasury position paper uses _immediately_ as the latency requirement for certain Prevent and Detect obligations. This is operationally ambiguous.

In practice, scam-intelligence systems operate across a spectrum of latencies — from sub-100ms real-time API calls (e.g. inline content verdict) to multi-hour batch enrichment cycles (e.g. WHOIS / certificate transparency lookups). The same regulated entity may produce verdicts at multiple latencies for different obligation contexts.

We recommend the subordinate rules specify concrete latency budgets for named obligations:

- **Inline content verdict (Detect at point of customer interaction):** < 200ms p95
- **Trigger-event response (Prevent at customer-initiated transaction):** < 1 second p95
- **Batch enrichment refresh (Detect for systemic threat):** < 6 hours
- **Reporting to ACCC (Report principle):** within 24 hours of detection

These numbers are illustrative; the actual budgets should reflect industry consultation. But the principle is that _immediately_ should be replaced by named latencies that engineering teams can implement against and regulators can audit.

### 3. Excluded sectors (~400 words)

The Joint Consumer SPF Designation submission (financialrights.org.au, January 2026) identified a gap: the initial SPF designation excludes online marketplaces, dating apps, gaming platforms, app stores, large email providers (Gmail, Outlook), and Meta-operated Facebook Marketplace. These are precisely the surfaces where the largest reported scam losses originate.

We support the consumer groups' submission and add an engineering observation: the current narrow designation creates a perverse incentive for regulated entities to _redirect_ scam communications onto excluded sectors, where they cannot be detected or interdicted. A bank that detects a scam URL on its own customer support channel can act; a bank that detects the same URL on a Facebook Marketplace listing cannot, because the platform is not designated.

We recommend a Schedule 2 of currently excluded sectors with a phased designation timeline. Treasury should not need to re-litigate the designation question for each sector individually; a clear, timed pathway protects consumer welfare while giving sector participants reasonable lead time.

### 4. Machine-readable evidence trails (~350 words)

AFCA's role as the SPF EDR scheme begins 1 September 2026, with complaints accepted from 1 January 2027. AFCA's new Chief Scams Officer, Dr David Lacey, has signalled that determinations will consider _all parties_ involved in a scam.

A multi-party EDR scheme requires evidence at machine-readable scale. If a single complaint involves a bank, a telco, and a digital platform, AFCA must be able to ingest the verdict-layer evidence from all three parties without manual extraction. The current framework does not specify the format.

We recommend the subordinate rules specify a machine-readable evidence-trail format — structured JSON or equivalent — with named fields for verdict, confidence, source attribution, timestamps, and a regulated-entity identifier. This format should be common across all three designated sectors, allowing AFCA to operate the multi-party scheme efficiently from day one.

### 5. ACMA's revealed enforcement preference (~350 words)

Between July 2024 and February 2026, ACMA issued six anti-scam infringement notices to Australian telcos: Telstra (A$1.5M, July 2024), Circles.Life (A$413K, May 2025), Exetel (A$694K, June 2025), Southern Phone (A$2.5M, September 2025), Optus Mobile (A$826K, November 2025), and Lycamobile (A$376K, February 2026). All six involved variations on the same audit finding: a missing or bypassed identity-verification step at a customer-account-modification trigger point.

This is the regulator's revealed preference about what _good_ looks like. The SPF subordinate rules should reference this enforcement pattern explicitly — not to dictate detection methodology, but to anchor the rules in observed regulatory practice. Regulated entities and their vendors benefit from knowing what the regulator has historically considered an unacceptable architecture.

### 6. Sovereign-data-residency carve-out (~300 words)

Scam-intelligence data is a national-security asset. The aggregated stream of Australian consumer scam reports, threat-feed enrichment, and entity-cluster intelligence is, in aggregate, a map of how criminals operate against Australian financial and telecommunications infrastructure.

We recommend the subordinate rules include a sovereign-data-residency carve-out for SPF detection providers. Regulated entities should be permitted, but not required, to specify Australian-only data residency for their SPF detection layer; vendors that offer Australian residency should be permitted to certify this in their compliance disclosures.

This is not a protectionist measure. It is a national-security alignment with the broader Australian government posture on critical infrastructure data residency. AskArthur is Australian-hosted (Supabase ap-southeast, Vercel Sydney edge) and would self-certify under such a carve-out. Other Australian-built providers would have the same option. International vendors with Australian data-residency offerings would also qualify. Vendors without Australian residency would be transparently identified as such.

---

## Closing

AskArthur supports the SPF Act and the broader regulatory architecture being constructed around it. We submit these recommendations as a small but production-deployed Australian provider, with the engineering perspective of a vendor that will be one of dozens supplying the detection layer to regulated entities.

We are happy to discuss any of these recommendations in detail with the Treasury, ACCC, ACMA, or AFCA teams.

Brendan Milton
Founder, AskArthur Pty Ltd
brendan@askarthur.au | askarthur.au

---

## Implementation notes for Brendan

- **Submit to every open consultation, not just one.** The Treasury industry-codes window closed 5 January 2026 but ACMA's mandatory industry standard (post 27 March rejection) will have its own consultation window in mid-to-late 2026. ACCC will run consultations on subordinate rules. Submit to all of them. Each becomes a permanent search-indexed credibility artefact.
- **Use the same six-recommendation structure across submissions.** Adapt the framing to each consultation's specific scope, but keep the recommendations consistent. This builds AskArthur's regulatory-thought-leadership profile coherently.
- **Cross-reference each submission in the LinkedIn series.** Post 4 (buyer not builder) is the natural place to mention the submission. "I have made a public submission to Treasury arguing that the SPF subordinate rules should specify a machine-readable verdict-layer architecture..."
- **Send a courtesy copy to Charlotte Davidson at IDCARE.** Not for endorsement — just so Davidson knows AskArthur is participating constructively in the policy process. Strengthens the partnership conversation.
- **Send a courtesy copy to AFCA's Chief Scams Officer David Lacey.** He is, after all, the person who will operationalise much of what is in the submission. A one-line cover note ("FYI — submitted this to Treasury today, given AFCA's role in the EDR scheme it may be of interest") is appropriate.
