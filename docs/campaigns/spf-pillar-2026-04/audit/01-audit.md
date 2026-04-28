# Audit: 01 — Pillar (`spf-telco-readiness-1-july-2026`)

**Score: 86 / 100 — ship-ready**

| Category              | Score | Notes                                                                                                                                                                                                                                  |
| --------------------- | ----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content Quality       | 27/30 | Burstiness 15.0 (excellent); TTR 0.439 (regulatory vocabulary repeats by necessity); 0 legitimate AI-phrase hits; ≥2 first-person markers; original architecture content                                                               |
| SEO Optimization      | 25/25 | Heading hierarchy clean; primary keyword in title/H1/first-100/H2; meta description fits; word count 2,991 (target ≥1,500 informational); freshness signals throughout                                                                 |
| E-E-A-T Signals       | 15/15 | Named author byline + ABN; multiple first-person markers ("I run AskArthur"); every quantitative claim attributed; date markers present                                                                                                |
| Technical Elements    |  8/15 | No FAQ schema (-4); Article schema assumed +3; no internal links to other AskArthur posts in body (-4 since not greenfield — there's at least one related post on the existing blog); no images / no code blocks (full marks on those) |
| AI-Citation Readiness | 11/15 | Answer-first H2s ✓ +4; no Key Takeaways callout (-3); strong citation capsules +4; ≥1 information-gain markers +2; H2s are mostly declarative, not question-shaped (-1)                                                                |

## Voice fit (vs `askarthur-house` persona)

| Metric               | Declared | Observed      | Drift                                                      |
| -------------------- | -------- | ------------- | ---------------------------------------------------------- |
| Sentence-length mean | 22 ± 9   | 20.5 ± 15.0   | -1.5 / std-dev exceeds target — fine                       |
| Reading grade        | 11–13    | 12 (estimate) | within band                                                |
| Forbidden phrases    | 0        | 0             | ✓                                                          |
| Do rules applied     | 8/8      | 7/8           | "Mermaid C4 diagram or table near top" missing — see below |
| Don't rules violated | 0/7      | 0/7           | ✓                                                          |

**Voice fit: very good.** The piece is recognisably `askarthur-house`. The one gap is the absence of a diagram in the first 30% — see Punch list item 4.

## Punch list (priority order)

### 1. Add Key Takeaways callout (3 pts uplift)

Insert directly after the subtitle / before "On 7 April 2026":

```markdown
> **Key takeaways**
>
> - Six ACMA telco penalties in 12 months, totalling A$6.36M, all variations on the same audit finding (missing identity-verification step at customer-account-modification trigger).
> - ACMA rejected the industry's draft consumer code twice (24 Oct 2025, 27 Mar 2026). Self-regulation has been formally exhausted; ACMA is now drafting a mandatory standard.
> - The SPF Act commences 1 July 2026. Maximum Tier 1 penalty is the _greater_ of A$52.7M, 3× benefit derived, or 30% of adjusted turnover.
> - Telstra is the only Australian telco that builds scam intelligence in-house. Every other telco is structurally a buyer.
> - The vendor-selection conversation needs to happen by July, not December.
```

### 2. Add FAQ section (4 pts uplift via Technical, +AI-citation odds)

Append before the byline. Suggested questions, drawn from the searches a telco compliance lead would type into ChatGPT / Perplexity:

```markdown
## FAQ

**When does the SPF Act actually commence?**
1 July 2026. AFCA EDR begins 1 September 2026; AFCA accepts SPF complaints from 1 January 2027. The reporting and disrupt rules are due to be finalised by 31 March 2027. Full implementation across the three designated sectors is targeted for end of 2027.

**What's the actual maximum penalty?**
The greater of three numbers per Tier 1 contravention: 159,745 penalty units (A$52,715,850, indexing on 1 July 2026), three times the benefit derived from the contravention, or 30% of adjusted turnover during the contravention period. The 30% turnover option is the one that should focus telco minds — for an entity the size of TPG or Optus, it can run into the hundreds of millions.

**Is my telco actually designated under SPF?**
The initial designation covers banks, telecommunications providers, and certain digital platforms. If you operate a telecommunications service in Australia — including MVNOs and wholesale providers — you are likely designated. Final designation instruments were consulted between 28 November 2025 and 5 January 2026; check the ACCC's published list.

**Can we rely on our existing Mavenir / Tollring / network-layer vendor for SPF compliance?**
Network-layer vendors handle the call layer. SPF Detect requires Actionable Scam Intelligence at the _content_ layer (the inbound text, link, image, QR code) too. Most telcos will need both layers; the question is which vendor for which layer.

**What happens if we miss the 1 July 2026 deadline?**
SPF obligations apply from day one of commencement. Tier 1 contraventions expose the entity to civil proceedings by the ACCC as SPF General Regulator, with the penalty maxima above. AFCA's EDR scheme accepts complaints from 1 January 2027, with David Lacey as inaugural Chief Scams Officer (started 31 March 2026) — formerly the founder of IDCARE.
```

### 3. Internal links (4 pts uplift, post-publish)

After the supporting posts publish (Days 7, 10, 14), add three sentences in the pillar:

- Near "159,745 penalty units (currently A$52,715,850...)" — link to `/blog/spf-159745-penalty-units-explained`
- Near "And on the same day, the SMS Sender ID Register" — link to `/blog/sms-sender-id-register-cio-guide-2026`
- Near "If you read these notices in sequence" — link to `/blog/five-telcos-twelve-months-acma-pattern`

Use descriptive anchor text (not "read more"): "the [arithmetic of 159,745 penalty units in detail](/blog/...)".

### 4. Optional: add a diagram in the first third (persona signature move)

The `askarthur-house` persona's signature moves include "Mermaid C4 diagram or a markdown table of structured data near the top." The pillar has the table of fines later (good) but no diagram up top. Two reasonable additions:

- A **timeline of the 6 ACMA fines** (already generated as `diagrams/acma-fines-timeline.excalidraw` — embed the PNG export under "## The fines, in chronological order")
- A **regulatory architecture diagram** (already generated as `diagrams/regulatory-architecture.excalidraw` — embed near "And on the same day, the SMS Sender ID Register")

These are aesthetic uplifts, not score uplifts (the rubric doesn't reward diagrams directly), but they reinforce voice and make the piece more cite-able by visual aggregators.

### 5. Cosmetic: tighten the one `very`

Line 59: "the very wide gap between theoretical maxima" → "the wide gap between theoretical maxima". Not blocking.

## Projected score after punch list

86 + 3 (Key Takeaways) + 4 (FAQ) + 4 (internal links) = **97 / 100**

Maxed except for the long-tail-question-H2 dimension (1/2). Nothing left to fix beyond that.
