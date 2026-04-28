# Audit: 07 — Five fines pattern (`five-telcos-twelve-months-acma-pattern`)

**Score: 80 / 100 — ship after addressing top 3 punch-list items**

| Category              | Score | Notes                                                                                                                                          |
| --------------------- | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Content Quality       | 27/30 | Burstiness 14.5 (excellent); TTR 0.434 (regulatory vocabulary); 0 AI-phrase hits; the pattern table is original synthesis (first-hand work) +6 |
| SEO Optimization      | 23/25 | Word count 1,183 — under 1,500 floor by 21% (-2). Everything else max.                                                                         |
| E-E-A-T Signals       | 13/15 | Byline ✓; first-person markers minimal — analytical voice (-2); sources extensive ✓; dates ✓                                                   |
| Technical Elements    |  7/15 | No FAQ (-4); no internal links (-4); no images / no code                                                                                       |
| AI-Citation Readiness | 10/15 | Answer-first ✓; no Key Takeaways (-3); citation capsules extensive ✓; info-gain markers ✓; H2s declarative (-2)                                |

## Voice fit (vs `askarthur-house`)

Excellent. The opening table-of-six-fines and the "If you read these notices in sequence, the regulator's voice changes" framing are textbook `askarthur-house` moves — pattern-recognition synthesis with specific dates and quotes. The closing "the cheapest version of regulatory compliance is the version that arrives early" is exactly the kind of compressed-claim closer the persona's `signature_moves` list calls for.

## Punch list (priority order)

### 1. Add Key Takeaways (3 pts)

Insert after the title:

```markdown
> **Key takeaways**
>
> - Six ACMA telco penalties between July 2024 and February 2026, totalling A$6.36M (excluding Telstra's adjacent A$626K Spam Act notice).
> - One audit finding repeated six times: missing or bypassed identity-verification step at a customer-account-modification trigger.
> - The regulator's voice changes through the series — from "an outlier" (July 2024) to "all telcos are on notice" (February 2026).
> - ACMA rejected the industry's draft consumer code twice (24 Oct 2025, 27 Mar 2026); now drafting a mandatory standard.
> - The 1 July 2026 SPF commencement, Sender ID Register enforcement, and AFCA EDR scheme commencement converge on the same architectural moment.
```

### 2. Add FAQ (4 pts) + close word count gap (2 pts)

```markdown
## FAQ

**Are these all telco-specific failures, or does the same pattern apply to banks?**
The six penalties summarised here are all under telco-specific anti-scam rules issued by ACMA. The bank equivalent is APRA's CPS 234 (information security) and the broader ASIC enforcement of consumer-protection breaches. The _audit-finding pattern_ — a documented control gap exploited by an attacker — recurs across both sectors. SPF Act commencement on 1 July 2026 is what unifies the regulatory baseline.

**What's an "infringement notice" vs a "court penalty"?**
ACMA's infringement notices are the regulator's most easily deployed enforcement tool, with maximum quantums set by the underlying telecommunications standards. They're administrative, not court-imposed. The penalties summarised above are infringement notices. SPF civil proceedings (under the _Competition and Consumer Act 2010_ as amended by SPF) go through the Federal Court and use the SPF Tier 1 penalty maxima — orders of magnitude higher.

**What's the difference between the rejected ATA TCP Code and a mandatory industry standard?**
Industry codes are drafted by the relevant industry body (the Australian Telecommunications Alliance) and submitted to ACMA for registration. Mandatory industry standards are drafted by ACMA itself under section 125 of the _Telecommunications Act 1997_ and apply to all carriers and carriage service providers without consent. ACMA rejected the ATA's draft TCP Code on 24 October 2025 and again on 27 March 2026; the regulator is now using its standard-making power.

**Will the new mandatory standard incorporate the audit findings from the six penalties?**
Likely yes. Standards drafting commonly references prior enforcement to define "what good looks like". Telcos and their vendors should plan for the new standard to require, at minimum, well-implemented identity verification with timestamped logs and continuous monitoring of bypass paths — i.e. closing the exact gap that produced the six penalties.

**For a smaller telco, what's the realistic timeline to compliance?**
The body of this post covers two specific actions: an honest internal audit against the public ACMA findings (which can be completed in weeks, not months), and a buy-vs-build vendor decision for the SPF detection layer (which should be made by July 2026, not December — Q4 work runs into AFCA EDR commencement on 1 January 2027). Most smaller telcos will be buyers; the question is which vendor.
```

### 3. Internal link to pillar (4 pts, post-publish)

Open with: "If you took the six anti-scam infringement notices ACMA has issued to Australian telcos between July 2024 and February 2026 — [the dataset that anchors the broader pillar piece on SPF telco readiness](/blog/spf-telco-readiness-1-july-2026) — and arranged the audit findings in a column..."

Also internal-link to penalty-units explainer near "the credible threat point is what shapes the negotiated outcome".

## Projected score after punch list

80 + 3 + 4 + 2 + 4 = **93 / 100**

Strong. This piece is the most evergreen of the supporting set (the pattern is a fact regardless of regulatory cycle) and benefits most from FAQ schema + Key Takeaways for AI-citation longevity.
