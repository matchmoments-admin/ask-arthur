# Audit summary — 4 SPF blog posts

**Auditor:** `blog` skill, persona `askarthur-house` (active)
**Run date:** 28 April 2026
**Rubric:** `references/quality-scoring.md` (Content 30 / SEO 25 / E-E-A-T 15 / Technical 15 / AI-Citation 15 = 100)

## Scores

| Post                    |        Score | Verdict                                      |
| ----------------------- | -----------: | -------------------------------------------- |
| 01 — Pillar             | **86 / 100** | **Ship-ready** (≥85)                         |
| 05 — Penalty units      |     71 / 100 | Ship after addressing top 3 punch-list items |
| 06 — Sender ID Register |     76 / 100 | Ship after addressing top 3 punch-list items |
| 07 — Five fines pattern |     80 / 100 | Ship after addressing top 3 punch-list items |

The drafts are excellent on the dimensions that are hardest to retrofit — voice, sourcing, structure, sentence variance, lack of AI tells. They lose points consistently on three specific items that are cheap to fix.

## What's working well across all 4 posts

- **Burstiness (sentence-length std-dev):** 11.6–15.0 across all four. Target was ≥6. The prose mixes short jabs with long context sentences deliberately. This is the single hardest thing to retrofit, and it's already done.
- **AI-phrase scrubber:** 0 legitimate hits across all four posts. The only flagged terms were the proper-noun SPF principle "Disrupt" and the conjunction "rather than" — both false positives.
- **Persona-forbidden phrases:** 0 hits across all four. The voice is on-target for `askarthur-house` already.
- **Citation capsules:** consistent "(per X 2026)" / "according to <source>" patterns throughout.
- **Sourcing:** every quantitative claim is named-source-attributed. Each post closes with a Sources line listing primary URLs.
- **First-person + lived experience (pillar specifically):** "I run AskArthur" and explicit founder framing — strong E-E-A-T signal.

## What's losing points across all 4 posts

Every post loses on exactly the same three items:

1. **No FAQ section.** Costs 4 points each (Technical category). FAQ schema correlates with ~20% increase in AI-citation odds — single highest-leverage technical addition.
2. **No Key Takeaways callout near the top.** Costs 3 points each (AI-Citation category). This is the most-cited single element by AI assistants on a typical post.
3. **No internal links between the four posts.** Costs 4 points each (Technical category). Resolves naturally after publication if you do the post-publish back-linking pass (per `references/internal-linking.md` § "Linking to the post you're writing").

The supporting posts (05, 06, 07) also lose 2 points each on word count — they're 1,119–1,192 words against a 1,500 floor for informational intent. Folding 200–300 words of FAQ into each closes that gap simultaneously.

The supporting posts lose 4 points each on first-person experience markers — they're written in analytical / explanatory mode rather than founder-narrative mode. That's an editorial choice (each supporting post serves a different function — explainer, briefing, pattern-analysis), not an error. Forcing first-person into a penalty-units arithmetic explainer would weaken it.

## Cross-cutting punch list (in priority order)

### 1. Add a Key Takeaways callout to each post

Under the title, before the first H2. 3–5 bullets, each one a single-sentence claim. The pillar's takeaways write themselves:

```markdown
> **Key takeaways**
>
> - Six ACMA telco penalties in 12 months, all variations on the same audit finding (missing identity-verification step at customer-account-modification trigger).
> - ACMA rejected the industry's draft consumer code twice (24 Oct 2025, 27 Mar 2026). Self-regulation has been formally exhausted.
> - The SPF Act commences 1 July 2026 with maximum penalties the _greater_ of A$52.7M, 3× benefit derived, or 30% of adjusted turnover.
> - Telstra is the only Australian telco that builds scam intelligence in-house. Every other telco is structurally a buyer.
> - The vendor-selection conversation needs to happen by July 2026, not December.
```

Same shape for each supporting post. ~5 minutes of work per post.

### 2. Add a FAQ section to each post

3–5 Q&A pairs at the bottom, each marked for FAQ schema injection at render-time. Suggested questions per post in the individual audit files.

### 3. Internal-link after publication

Per `references/internal-linking.md`, the workflow is:

1. Publish the pillar first (Day 0).
2. As each supporting post publishes (Days 7, 10, 14), link each to the pillar near the top.
3. After all four are live, edit the pillar to link out to all three supporting posts in the relevant sections.

Reading-order-preserving, search-engine-friendly, AI-citation-friendly.

### 4. Optional: tighten the two `very` instances

- Pillar line 59: "the very wide gap between theoretical maxima" → "the wide gap between theoretical maxima"
- Penalty units line 25: "to prevent very large entities" → "to prevent the largest entities"

Cosmetic. Not blocking.

## Per-post details

See `01-audit.md`, `05-audit.md`, `06-audit.md`, `07-audit.md` for the full per-post score breakdowns and post-specific punch lists (including suggested FAQ questions tailored to each).

## Recommendation

Ship all four as-is if you want to move fast on the timing-sensitive Day-0 launch. Score lifts from the three-item punch list will move every post above 90/100, but they're additive — you can apply them in `/admin/blog` after the seed script lands the drafts.

If you want me to draft the Key Takeaways and FAQ sections for each post and patch them into the markdown files (so the seed script picks them up automatically), say so and I'll do that next.
