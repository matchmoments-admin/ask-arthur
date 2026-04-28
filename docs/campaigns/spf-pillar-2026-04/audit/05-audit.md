# Audit: 05 — Penalty units (`spf-159745-penalty-units-explained`)

**Score: 71 / 100 — ship after addressing top 3 punch-list items**

| Category              | Score | Notes                                                                                                                                                              |
| --------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Content Quality       | 18/30 | Burstiness 11.6 (excellent); TTR 0.362 (low — explained by tight regulatory vocabulary); 1 minor `very` (-3); first-person markers minimal (analytical voice) (-3) |
| SEO Optimization      | 23/25 | Word count 1,177 — under the 1,500 informational floor by ~22% (-2). Everything else max.                                                                          |
| E-E-A-T Signals       | 13/15 | Byline ✓; first-person markers minimal (-2); sources ✓; dates ✓                                                                                                    |
| Technical Elements    |  7/15 | No FAQ (-4); no internal links (-4); no images / no code                                                                                                           |
| AI-Citation Readiness | 10/15 | Answer-first ✓; no Key Takeaways (-3); citation capsules ✓; info-gain markers ✓ ("nobody is talking about"); H2s declarative (-2)                                  |

## Voice fit (vs `askarthur-house`)

Voice is on-target but quieter than the pillar (deliberately — this is a numerical/explanatory piece). No persona violations. The single `very` is a mild slip; the rest of the prose is strong.

## Punch list (priority order)

### 1. Add Key Takeaways (3 pts)

Insert after the title:

```markdown
> **Key takeaways**
>
> - Tier 1 SPF maximum is the _greater_ of three numbers: 159,745 penalty units (A$52.7M today), 3× benefit derived, or 30% of adjusted turnover.
> - The penalty unit value indexes on 1 July 2026 — the same day SPF commences. Every compliance document quoting "A$52.7M" goes stale on 2 July.
> - For TPG, Optus, Aussie Broadband, the 30% of turnover option is the relevant ceiling — and runs into hundreds of millions for a year-long contravention.
> - The "reasonable steps" defence requires an evidence trail that exists _before_ the contravention. It cannot be reconstructed.
```

### 2. Add FAQ (4 pts) + grow word count past 1,500 floor (2 pts)

This punch-list item also closes the word-count gap. Append:

```markdown
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
```

### 3. Internal link to pillar (4 pts, post-publish)

Open the post with a linked reference: "If you have been reading the _Scams Prevention Framework Act_ commentary [in our [pillar piece](/blog/spf-telco-readiness-1-july-2026) and elsewhere]..."

### 4. Cosmetic: tighten the `very`

Line 25: "to prevent very large entities from treating..." → "to prevent the largest entities from treating...". Not blocking.

## Projected score after punch list

71 + 3 (Key Takeaways) + 4 (FAQ) + 2 (word count via FAQ) + 4 (internal link) = **84 / 100**

Tips into ship-with-punch-list-addressed band. Could push higher with more first-person markers (e.g. "I had to recompute this for our own SPF readiness brief" framing in the intro), but the analytical register is appropriate for a numerical piece — don't force first-person if the voice doesn't want it.
