# Hacker News submission — Pillar

**Source:** [`/blog/spf-telco-readiness-1-july-2026`](../01-pillar-blog-post.md)

**Verdict on submitting to HN:** Worth submitting. The post has a specific contrarian take ("Telstra is the only Australian telco that builds; everyone else buys") backed by named vendor relationships, dollar figures, and dates. That's the shape HN rewards. The audit-finding-pattern table (six fines in 12 months, all the same root cause) is the kind of synthesis HN votes up.

**Submission type:** Standard link submission (not "Show HN" or "Ask HN" — this is a story/analysis post).

---

## Title (≤80 chars works best on HN; HN auto-lowercases the leading "The")

**Recommended:**

> ACMA has fined six Australian telcos in 12 months for the same audit finding

83 chars — at the upper limit. HN may truncate slightly in mobile lists but the front-page rendering will show it in full.

**Alternative titles:**

- "Six telco fines, one rejected industry code, sixty-four days" (66 chars — punchier but more obscure)
- "Australia's Scams Prevention Framework Act commences 1 July 2026" (66 chars — descriptive but boring)
- "Why every Australian telco except Telstra will be a buyer of scam intelligence" (84 chars — leads with the contrarian claim)

The recommended title leads with the _evidence_ (the six-fine pattern). HN audiences distrust headlines that lead with the conclusion, but reward headlines that lead with the data.

---

## Submission text

**Recommended:** Link-only (no submission text). HN voters generally prefer to read the post first; submission text is most useful for "Show HN" / "Ask HN" framings or when the URL alone doesn't make the topic clear.

If you want to add a short framing note (visible only to people who click into the discussion before reading the article), use this:

```
Author here. Quick context for non-Australian readers: ACMA is the
telecoms regulator, NASC is the new National Anti-Scam Centre (under the
ACCC), and the Scams Prevention Framework Act 2025 is the closest
analogue to the EU's NIS2 / DORA — designated industries (banks, telcos,
digital platforms) face civil penalties up to A$52.7M per contravention
or 30% of adjusted turnover, whichever is greater.

The post collects six ACMA enforcement actions from the past 12 months,
notes that they all involve the same audit finding (identity-verification
failure at customer-account-modification), and argues that this is the
regulator's revealed preference about what their new mandatory standard
will require. The supporting argument is that Telstra is the only
Australian telco that has built scam-intelligence in-house, with the
others operating as buyers from a small set of vendors (Mavenir, Apate.ai,
Tollring) — and that the buy-decision needs to happen by July, not
December.

Disclosure: I run a scam-intelligence platform that would be a vendor
into this market.
```

(The disclosure is mandatory on HN. Submissions without disclosed conflicts get flagged.)

---

## Publishing notes

- **Best time to post:** Tue/Wed/Thu, 8–10am PT (the HN peak is West Coast US morning). For an Australian author this is 1–3am AEST, so schedule via the user's normal scheduling tool or wait for an alternate-day morning.
- **Avoid weekends.** HN has weekend traffic but the algorithm favours Tue–Thu submissions.
- **Don't ask for upvotes.** HN bans accounts for vote manipulation (and the community is good at detecting it).
- **Don't submit your own content more than once a month.** This is the single most-watched community-sentiment metric.
- **Engage substantively in comments early.** Top-voted comments get the most reply visibility, so a substantive author reply within the first 30–60 minutes can drive thread growth and front-page persistence.

## Anticipated comment patterns

- **"Australia is in some ways further along than the EU on this — interesting."** — Engage. Note that SPF's 30%-of-turnover penalty option is more aggressive than DORA's flat-percentage maxima.
- **"Why is this any different from GDPR's enforcement against banks?"** — Engage. The difference is the multi-party EDR (AFCA from Jan 2027) — a single complaint can implicate three sectors simultaneously, which doesn't have a GDPR analogue.
- **"This reads like a sales pitch."** — Reply once with the disclosed conflict, point at the explicit "if a different vendor is right, that's also a productive outcome" framing in the post. Don't argue.
- **"How does this compare to UK Online Safety Act / EU DSA?"** — Engage. Both are platform-focused; SPF is uniquely cross-sector (banks + telcos + platforms).
- **"What about Optus?"** (referencing the 2022 breach) — Engage briefly. The 2022 breach is not the SPF context (predates the Act); the November 2025 Coles Mobile penalty IS the SPF context.

## What gets the post killed on HN

- **Pay walls.** AskArthur's blog is open — this is fine.
- **Aggressive CTAs.** The post has CTAs but they're soft ("if AskArthur is the right shape... or if a different vendor is right, that's also a productive outcome"). Acceptable.
- **Tracking-heavy URLs.** Strip any UTM parameters before submitting; vanilla URL only.
- **Marketing register.** The post avoids this; the voice is engineering-deep-dive, which is HN-native.

## Lifecycle expectation

- **Hours 0–2:** Front-page entry requires 4–6 upvotes within 30–60 minutes. If the post hasn't moved in the first hour, it likely won't.
- **Hours 2–24:** If it makes the front page, expect 100–500 points and 50–200 comments. Telco/regulatory analysis with strong contrarian takes typically does well in this range on HN.
- **After 24h:** Drops off the front page; long tail of inbound traffic via search and HN historical browsing for ~3 months.

## When NOT to submit

- If r/AusFinance submission has just gone live and you're trying to amplify it — HN will frequently see crossposts as low-effort and downvote.
- If there's a fresh major Australian privacy/breach story dominating tech press — wait 48 hours.
- If you can't engage in comments for the first 2 hours after submission — defer to a day when you can.

## Don't bother submitting

- Show HN. The pillar isn't a Show HN — it's an analysis post. Submitting under "Show HN: " framing would be off-pattern.
- Ask HN. The pillar isn't asking a question; it's making an argument.
