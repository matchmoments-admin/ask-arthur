# What "159,745 penalty units" actually means for an Australian telco on 2 July 2026

If you have been reading the _Scams Prevention Framework Act_ commentary and you keep seeing the figure "A$52.7 million" for a Tier 1 maximum penalty, here is what is actually going on under that number — and why the number itself is going to change on 1 July 2026, the same day the Act commences.

> **Key takeaways**
>
> - Tier 1 SPF maximum is the _greater_ of three numbers: 159,745 penalty units (A$52.7M today), 3× benefit derived, or 30% of adjusted turnover.
> - The penalty unit value indexes on 1 July 2026 — the same day SPF commences. Every compliance document quoting "A$52.7M" goes stale on 2 July.
> - For TPG, Optus, Aussie Broadband, the 30% of turnover option is the relevant ceiling — and runs into hundreds of millions for a year-long contravention.
> - The "reasonable steps" defence requires an evidence trail that exists _before_ the contravention. It cannot be reconstructed.

## The arithmetic

Australian Commonwealth penalties are denominated in _penalty units_, not dollars. The current value of a single penalty unit is **A$330**, set on 7 November 2024 under section 4AA of the _Crimes Act 1914_. Tier 1 contraventions under the SPF Act expose a regulated entity to the _greater_ of three numbers: 159,745 penalty units, three times the benefit derived from the contravention, or 30% of adjusted turnover during the contravention period.

159,745 × A$330 = **A$52,715,850**.

That is where the A$52.7 million figure comes from. It is correct on the day this is written. It will not be correct on 1 July 2026.

## The indexation event nobody is talking about

Section 4AA(3) of the _Crimes Act_ provides that on 1 July 2026 — and on every third 1 July after that — the dollar value of a penalty unit is automatically indexed by reference to CPI. The indexation factor is calculated against the March quarter immediately before the indexation day, with a known formula and a published indexation factor.

Here is the implication that is not in any vendor's compliance deck. The SPF Act commences on 1 July 2026. The penalty unit indexation occurs on 1 July 2026. So the _first_ SPF contravention is exposed to a higher Tier 1 ceiling than the A$52.7 million figure that has been quoted in every legal explainer for the past twelve months. The exact post-indexation figure depends on what the All Groups CPI does in the March 2026 quarter. If CPI runs at, say, 3% for the indexation reference period, the penalty unit moves from A$330 to approximately A$340, and the Tier 1 ceiling becomes A$54.3 million. If CPI runs hotter, the ceiling moves higher.

This is the kind of detail that matters for two reasons. First, your legal team is going to need to update every internal compliance document on 1 July, because the headline figure is going to change. Second, the _floor_ of the maximum penalty — A$52.7 million — is itself only one of three options. The 30% of adjusted turnover number can be larger by orders of magnitude.

## Why 30% of adjusted turnover is the number that matters

For a telco the size of TPG (FY24 revenue A$5.5 billion), 30% of adjusted turnover during a contravention period is, depending on how the period is calculated, a number that can run into the hundreds of millions. For Optus (FY24 revenue ~A$8.4 billion), it is larger again. For a smaller telco — say, Aussie Broadband (FY24 revenue A$786 million) — 30% of turnover during a year-long contravention is A$236 million. All three of those numbers are dramatically larger than A$52.7 million.

The legislative point of the three-option formula is to prevent very large entities from treating the penalty-unit ceiling as a cost of doing business. A flat-dollar maximum is a calculable risk. A turnover-percentage maximum is a balance-sheet event.

This is why "the maximum penalty is A$52.7 million" is, while technically true, the wrong way to frame the SPF risk to an executive committee. The correct framing is: _"The maximum penalty for a single Tier 1 contravention against our entity is the greater of three numbers, of which the A$52.7 million ceiling is the floor. For our turnover, the relevant number is closer to A\$X."_

## Stacking, accumulation, and continuing breach

There is a further wrinkle. The penalty-unit and turnover figures are _per contravention_. A regulated entity that fails to act on Actionable Scam Intelligence across, say, ten distinct customer interactions on the same day is potentially exposed to ten distinct Tier 1 contraventions. The drafters of the SPF have not made it easy to argue that a systemic failure is a single event.

Compare this to the existing ACMA infringement-notice regime. The Lycamobile penalty (4 February 2026) of A$376,200 covered 131 contraventions. That is roughly A$2,872 per contravention. The Optus Mobile maximum (November 2025) of A$826,320 covered 44 contraventions — roughly A$18,780 per contravention. These are infringement notices: ACMA's most easily deployed enforcement tool, with maximum quantums set by the underlying telecommunications standards. They are not court penalties.

The SPF Tier 1 maximum applies _per contravention_ through court action. If the ACCC pursues civil proceedings — which it can do as the SPF General Regulator — and a court finds 131 contraventions of the SPF Detect principle, the theoretical exposure is 131 × A$52.7 million, even before considering the 30% turnover option.

In practice, courts almost never impose theoretical maxima. But the SPF was designed to give regulators a credible threat point, and the credible threat point is what shapes the negotiated outcome.

## What this means for "reasonable steps"

The SPF principles attach a _reasonable steps_ defence to most of the Tier 1 obligations. A regulated entity that can demonstrate it took reasonable steps to comply has a defence; one that cannot, does not.

The phrase "reasonable steps" is going to do an enormous amount of work between now and the first SPF prosecution. It will be litigated. It will be the subject of ACCC guidance. AFCA's Chief Scams Officer, David Lacey, has already signalled that EDR determinations will look at all parties involved in a scam — meaning that "reasonable steps" will be assessed across the chain of bank, telco, and digital platform, not just within one entity.

The practical implication for telcos: an evidence trail of _what you did, when, with what data, and why you formed the belief you formed_ is the artefact that turns "reasonable steps" from a slogan into a defence. That artefact has to exist before the contravention occurs. It cannot be reconstructed.

## What to do this quarter

Three things.

First, calculate your _actual_ Tier 1 ceiling for your entity. The A$52.7 million figure is almost certainly wrong for you. The 30% of turnover number is the one that goes to the board.

Second, document your Actionable Scam Intelligence pipeline. The audit artefact is the defence. Continuous threat-feed ingestion, multi-source enrichment, three-tier verdict, timestamped entity history — this is what reasonable steps looks like in code.

Third, update every public reference to your maximum SPF exposure on 2 July. The penalty-unit indexation is not optional; it is automatic. Compliance documents that say "A$52.7 million" on 2 July will be outdated by definition.

If you want to talk through how AskArthur's Threat API maps to the _reasonable steps_ evidence trail your legal team is going to need, I can be reached at brendan@askarthur.au or at askarthur.au.

## FAQ

**What's a "penalty unit" and why do they matter?**
Australian Commonwealth penalties are denominated in penalty units, not dollars. The current value is A$330 (set 7 November 2024 under section 4AA of the _Crimes Act 1914_). Penalty units index every three years on 1 July; the next indexation is 1 July 2026 — the same day SPF commences.

**How is "30% of adjusted turnover" calculated?**
The legislative definition is "adjusted turnover during the contravention period". The "contravention period" is what gets argued in court. For a continuing breach (e.g. a systemic failure to detect scams over 12 months), the period is potentially the full 12 months of revenue, multiplied by 0.30. That's the number that should go to the board.

**Will any court actually impose the maximum?**
Almost certainly not in absolute terms — courts impose negotiated penalties well below maxima, especially for first-time SPF cases. But the _credible threat point_ drives the negotiated outcome. A court that can impose A$200M will negotiate down to numbers that would have been unthinkable under ACMA's existing infringement-notice toolkit (where individual penalties cap at A$2.5M-ish).

**Are penalties per-customer or per-incident?**
Per _contravention_. A failure to act on Actionable Scam Intelligence across, say, 10 customer interactions on the same day is potentially 10 distinct Tier 1 contraventions. The Lycamobile precedent (4 February 2026, A$376,200 across 131 contraventions) shows ACMA's existing approach to stacking; SPF court action would apply per-contravention maxima at much higher levels.

**What does "reasonable steps" actually mean in court?**
Untested. The phrase will be litigated extensively in the first 12 months post-commencement. Most likely interpretive anchor: AFCA's Chief Scams Officer (David Lacey, formerly IDCARE founder) has signalled that EDR determinations will look at all parties involved in a scam. So "reasonable steps" will be assessed across the chain — bank, telco, digital platform — not just within one entity. The audit-trail evidence has to exist at each layer.

---

_Brendan Milton is the founder of AskArthur. AskArthur Pty Ltd, ABN 72 695 772 313._

_Sources: Crimes Act 1914 s.4AA (austlii.edu.au); ASIC penalty unit guide (asic.gov.au/about-asic/asic-investigations-and-enforcement/fines-and-penalties); KWM SPF unpacking (kwm.com); Ashurst SPF operationalising (ashurst.com); ACMA enforcement notices (acma.gov.au); AFCA Chief Scams Officer announcement (afca.org.au)._
