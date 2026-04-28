# Audit: 06 — SMS Sender ID Register (`sms-sender-id-register-cio-guide-2026`)

**Score: 76 / 100 — ship after addressing top 3 punch-list items**

| Category              | Score | Notes                                                                                                                                                                                                                      |
| --------------------- | ----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content Quality       | 24/30 | Burstiness 12.4 (excellent); TTR 0.415 (regulatory vocabulary); 0 legitimate AI-phrase hits (one false-positive `rather than`); first-person markers minimal (-3)                                                          |
| SEO Optimization      | 23/25 | Word count 1,119 — under 1,500 floor by 25% (-2). Everything else max.                                                                                                                                                     |
| E-E-A-T Signals       | 13/15 | Byline ✓; first-person markers minimal (-2); sources ✓; dates ✓                                                                                                                                                            |
| Technical Elements    |  7/15 | No FAQ (-4); no internal links (-4); no images / no code                                                                                                                                                                   |
| AI-Citation Readiness |  9/15 | "Misconception N: ..." structure is essentially answer-first by design (4/4); no Key Takeaways (-3); citation capsules slightly thin (-2); info-gain markers ✓; H2s partly question-shaped via Misconception framing (1/2) |

## Voice fit (vs `askarthur-house`)

Strong. The "Misconception 1 / 2 / 3 / 4 / 5" structure is a natural fit for the persona's deliberate-structure preference (similar in shape to "Part 1 / Part 2 / Part 3" deep-dive layout). Voice and confidence are on-target.

The "rather than" false positive on the scrubber is just the conjunction (which the scrubber explicitly exempts). No actual issue.

## Punch list (priority order)

### 1. Add Key Takeaways (3 pts)

Insert after the title:

```markdown
> **Key takeaways**
>
> - The SMS Sender ID Register becomes mandatory 1 July 2026. Unregistered alphanumeric sender IDs will display as "Unverified" on every customer's phone.
> - The hard deadline is 1 July 2026, not December 2025 (which was the standard's commencement, not the operational deadline).
> - The Register operates at the _carriage_ level — register every alphanumeric sender ID on every aggregator route, not just the brand name.
> - The Register reduces alphanumeric impersonation, but does not stop SMS scams from numeric sender IDs.
> - 1 July 2026 is the convergence date for three regulatory regimes — SPF Act commencement, Sender ID Register enforcement, and penalty unit indexation.
```

### 2. Add FAQ (4 pts) + close word count gap (2 pts)

```markdown
## FAQ

**Is the Register mandatory?**
Administratively voluntary, operationally mandatory. The Register itself has no direct fine for non-registration, but the _enforcement mechanism_ is built into the carrier compliance chain. Telcos that participate display "Unverified" on unregistered messages and, in time, can block or down-rank unregistered traffic. Telcos that don't participate are excluded from sender ID messaging entirely.

**What about messages from numeric mobile numbers?**
Out of scope. The Register addresses alphanumeric sender ID spoofing only. Scams from numeric mobile numbers remain a separate problem (and a larger volume category) — they're addressed by ACMA's existing anti-scam standard and the SPF Act's Detect principle, not by the Register.

**We use multiple aggregators. Do we register every route?**
Yes. The audit point is "every alphanumeric sender ID on every aggregator route" — not just the brand name. Marketing-automation traffic on a different aggregator from transactional traffic counts as two separate pathways.

**What happens to legitimate messages that display as "Unverified"?**
Even with perfect registration, some edge-case sender IDs may display "Unverified" in the first weeks of operation, particularly for less common strings. Customer-service script for the inbound calls should be drafted before 1 July, not after — see the body of this post for the exact language.

**Does this affect international SMS to Australian numbers?**
Yes. Any alphanumeric sender ID _to_ an Australian mobile number must be registered, regardless of where the message originates. Non-participating overseas carriers cannot transit or terminate sender ID messages to Australian recipients.
```

### 3. Internal link to pillar (4 pts, post-publish)

Add a sentence after "the convergence date for three regulatory regimes": "The pillar piece on telco SPF readiness covers the broader [buyer-vs-builder dynamic across the Australian telco sector](/blog/spf-telco-readiness-1-july-2026)."

## Projected score after punch list

76 + 3 + 4 + 2 + 4 = **89 / 100**

Comfortably ship-ready. The Misconception-N format already does most of the answer-first work; the punch list closes the structural gaps without disturbing the voice.
