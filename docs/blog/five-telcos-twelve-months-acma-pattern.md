If you took the six anti-scam infringement notices ACMA has issued to Australian telcos between July 2024 and February 2026, redacted the brand names, and arranged the audit findings in a column, you would not be able to tell which telco was which. The findings are that consistent.

This is the column.

> **Key takeaways**
>
> - Six ACMA telco penalties between July 2024 and February 2026, totalling A$6.36M (excluding Telstra's adjacent A$626K Spam Act notice).
> - One audit finding repeated six times: missing or bypassed identity-verification step at a customer-account-modification trigger.
> - The regulator's voice changes through the series — from "an outlier" (July 2024) to "all telcos are on notice" (February 2026).
> - ACMA rejected the industry's draft consumer code twice (24 Oct 2025, 27 Mar 2026); now drafting a mandatory standard.
> - The 1 July 2026 SPF commencement, Sender ID Register enforcement, and AFCA EDR scheme commencement converge on the same architectural moment.

![Six ACMA telco penalties on a timeline from July 2024 to February 2026: Telstra A$1.55M, Circles.Life A$413K, Exetel A$695K, Southern Phone A$2.50M, Optus Mobile A$826K (max penalty), Lycamobile A$376K. Regulator's voice escalates across the series from "unacceptable" to "all telcos on notice"; ACMA rejected the ATA's draft TCP Code twice (24 Oct 2025, 27 Mar 2026) before drafting a mandatory standard.](/illustrations/blog/spf-pillar-2026-04/acma-fines-timeline.webp)

---

## The pattern

| Telco          | Date     | Penalty     | Contraventions            | Consumer losses                                |
| -------------- | -------- | ----------- | ------------------------- | ---------------------------------------------- |
| Telstra        | Jul 2024 | A$1,551,000 | 168,000+ ID auth failures | No direct loss link                            |
| Circles.Life   | May 2025 | A$413,160   | 26                        | A$45,000                                       |
| Exetel         | Jun 2025 | A$694,860   | 73                        | A$412,000                                      |
| Southern Phone | Sep 2025 | A$2,500,560 | 168                       | A$393,000                                      |
| Optus Mobile   | Nov 2025 | A$826,320   | 44                        | A$39,000 (4 customers' bank accounts accessed) |
| Lycamobile     | Feb 2026 | A$376,200   | 131                       | A$175,000                                      |

The audit finding, in every case, is some variation on: _the telco failed to perform the required identity-verification step at a customer-account-modification trigger point, and a scammer exploited that gap to take control of a phone number._

This is not a sophisticated attack. It is the simplest possible failure mode. And it has now produced six different penalties in twelve months, totalling A$6.36 million — not counting the Telstra Spam Act notice (A$626,000 in March 2025) which sits adjacent to but outside this dataset.

---

## What ACMA is actually saying

The interesting thing about this dataset is the _language_ the regulator has used in successive notices. It changes.

July 2024 (Telstra). Authority Member Samantha Yorke: _"It is unacceptable that Telstra did not have proper systems in place when the rules came into force."_ The frame is procedural disappointment. The systems were not in place. They should have been.

May 2025 (Circles.Life, second offence). Yorke: _"Telcos should be aware they cannot outsource their legal obligations to protect Australian consumers."_ The frame has shifted to liability. The regulator is now signalling that vendor delegation is not a defence.

November 2025 (Optus Mobile). Yorke: _"This is the maximum financial penalty the ACMA was able to give in this matter. It reflects the serious nature of the breaches."_ The frame has shifted again — from disappointment to _we have used everything we have_. ACMA is now flagging the limits of its own toolkit.

February 2026 (Lycamobile). Chair Nerida O'Loughlin: _"This is the fifth time this year the ACMA has found breaches of these rules and all telcos are on notice that their ID verification systems must not have vulnerabilities that scammers can target."_ The frame is no longer about a specific telco. It is about the industry. _All_ telcos. _On notice_.

> [!DANGER]
> "All telcos are on notice" is the language a regulator uses immediately before it stops asking and starts requiring. Read in sequence, the four ACMA notices trace a clean escalation: _correcting an outlier_ → _correcting an industry_. The phrase appearing in February 2026 — three months before SPF commencement — is the explicit signal that the supervisory grace period has ended.

If you read the notices in sequence, the regulator's voice changes from _we are correcting an outlier_ to _we are correcting an industry_. The most recent quote — "all telcos are on notice" — is the language a regulator uses immediately before it stops asking and starts requiring.

---

## What happened next

What happened next was the 27 March 2026 rejection of the Australian Telecommunications Alliance's draft Telecommunications Consumer Protections Code, and the announcement that ACMA would _determine_ an industry standard under section 125 of the _Telecommunications Act 1997_. This is the second time ACMA has rejected the ATA's draft (the first rejection was 24 October 2025). Industry self-regulation has been formally exhausted.

In O'Loughlin's words: _"the ACMA still does not have before it a code capable of registration. We have also considered the contemporary expectations of consumers and decided that moving to an industry standard is now necessary."_

The chronology is unambiguous. Six identical-pattern penalties over twelve months. Industry self-regulation rejected twice. Mandatory standard now being drafted. SPF Act commencing 1 July 2026 with maximum penalties of A$52.7 million per contravention — or 30% of adjusted turnover, whichever is greater. SMS Sender ID Register going live the same day. AFCA's new Chief Scams Officer, David Lacey, in place from 31 March 2026 to handle the EDR fallout.

This is, in regulatory terms, the architecture being completed in plain sight.

---

## The audit finding, generalised

If you are at a smaller Australian telco and you look at this dataset, the question is not "what did Telstra get wrong" or "what did Optus get wrong." The question is: _what is the systemic failure mode that has produced six identical findings in twelve months across telcos of every size and ownership structure?_

In every case, the failure was: a customer-account-modification request was processed without the required identity-verification step, and the scammer was the customer. The control was missing or bypassed. The audit trail did not detect the bypass until the fraud had already happened. The remedies imposed by ACMA — undertakings, independent consultants, periodic reporting — are all forms of _external observation_ of the missing control.

> [!WARNING]
> The systemic implication is that the existing telco identity-verification architecture is **brittle by design**. It was designed for a low-fraud environment, with manual review processes, with enough flexibility for legitimate edge cases that it has the structural shape of a sieve. It does not have what a security architect would call defence-in-depth. The single failure of a single check is the single failure of the system.

The SPF Act, the Sender ID Register, and the new ACMA mandatory standard are all converging on a different architecture. Continuous threat-intelligence ingestion. Multi-source enrichment. Time-bound _Actionable Scam Intelligence_. Auditable evidence of _reasonable steps_. None of these are options for a smaller telco. They are the new floor.

---

## What to do this quarter

Two things.

> [!TIP]
> The cheapest version of regulatory compliance is the version that arrives early. Vendors that sign in May–July 2026 have a six-month head start over those that sign in December — and the difference shows up in the AFCA EDR determinations of 2027.

**Do an honest internal audit against the public ACMA findings.** For each of the six penalty patterns, work backwards to your own architecture and ask: _if a similar trigger occurred at our company today, would the missing-control failure happen?_ The honest answer for most smaller telcos is yes. The fix is documented, not exotic — it is well-implemented identity verification with timestamped logs and continuous monitoring of the bypass paths.

**Decide whether you build or buy the SPF detection layer.** Telstra is the only Australian telco that has built scam intelligence as in-house IP. Every other telco is, structurally, a buyer. The buying decision wants to be made by July, not December — Q4 SPF compliance work runs into AFCA EDR commencement (1 January 2027) and the first wave of public ASI reporting. Vendors that sign in May–July have a six-month head start.

If AskArthur is the right shape of vendor for the SPF detection layer, the conversation is at askarthur.au or brendan@askarthur.au. If a different vendor is right, that is also a productive outcome — every smaller telco that buys _something_ before 1 July is one that ACMA does not have to write the next press release about.

---

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

---

_Brendan Milton is the founder of AskArthur. AskArthur Pty Ltd, ABN 72 695 772 313._

_Sources: ACMA enforcement notices for Telstra (acma.gov.au/articles/2024-07/telstra-penalised-15m-scam-rule-breaches), Circles.Life (acma.gov.au/articles/2025-05/circleslife-pays-413k-more-anti-scam-breaches), Exetel (miragenews.com/exetel-penalised-694k-for-anti-scam-breaches-1521733/), Southern Phone (acma.gov.au/publications/2026-04/report/action-scams-spam-and-telemarketing-october-december-2025), Optus Mobile (acma.gov.au/articles/2025-11/optus-penalised-826k-breaching-anti-scam-rules), Lycamobile (acma.gov.au/articles/2026-02/lycamobile-pays-376k-scam-rule-crackdown); ACMA TCP Code rejection (acma.gov.au/articles/2026-03/acma-replace-telco-consumer-code-stronger-protections); AFCA Chief Scams Officer announcement (afca.org.au)._
