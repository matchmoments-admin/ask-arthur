# /hub — LinkedIn launch post

Drafted with the `linkedin-writing` skill against the Ask Arthur client profile.
**Purpose:** launch · **Voice:** 3 (Founder-Builder Reflective) blended with 1 (Trusted Mate) · **Audience:** B2C.

---

## Two corrections to the draft that shipped in `launch-notes.md`

**1. The hook number was stale and is now unusable as written.** The draft opened on
"981 domains… last month". That figure came from the rolling 30-day
`clone_watch_public_impact` window, which drifts daily — it read 1,025 at the start of the
session that built this page and 1,035 twenty minutes later.

The post below uses the **July calendar-month cohort** instead — `clone_watch_report_summary`
for `2026-07-01`: **1,000 domains across 150 brands**. A cohort figure is fixed once the month
closes, so it stays true no matter when the post is read, and it reconciles exactly with the
`/clone-watch/2026-07` page anyone clicks through to.

> Rolling / cohort / ad-hoc are three different numbers over the same pipeline. Quote the one
> whose window you named.

**2. The draft named specific clone domains — cut them.** It listed three lookalike domains as
colour. The hub page itself says _"We never publish which specific domains we report."_
Publishing them in the post promoting that page contradicts it in the same breath, and a list
of live lookalikes is a directory for the next person. The brand-side facts (how many, whose)
carry the point without it.

---

## Post body

Last month, 1,000 domains were registered that were pretending to be Australian brands.

Not "suspicious-looking websites". Newly-registered names sitting a character or two away from a bank, a telco, a retailer you'd know on sight.

150 different brands. In one month.

We run that sweep every day and publish the totals every month. We don't publish which specific domains we report — those go to community blocklists so browsers block them globally. Naming them here would just be a directory for whoever's next.

Ask Arthur started as a smaller question: when a text arrives and you're not sure, where do you actually go?

Not a government portal with a form. Not a forum thread from 2019. Somewhere you can paste the thing and get an answer before you decide.

It's grown since then:

— The scanner. Paste a message, link, phone number or screenshot. Verdict in seconds.
— Persona Check. For when it isn't a message you're unsure about but a person — the recruiter, the match, the seller.
— Clone-watch. The daily sweep above. Least glamorous thing we do, probably the most useful.

All free. No signup. Nothing stored.

The problem was that it was scattered — four things in four places with no front door. So I built one. Five chapters, one page, everything in it.

Australians lost A$2.18 billion to scams in 2025 (ACCC Targeting Scams Report, March 2026). Almost none of that started with someone being careless. It started with something that looked right.

Arthur won't stop every scam. It gives you the moment to pause.

If there's a message sitting in your phone right now that you're not sure about — that's exactly what it's for.

askarthur.au/hub

PS — being scammed is never your fault. Reporting helps the next person.

---

**Length:** ~1,640 characters — inside the 1,200–1,800 launch range.

## Hashtags

`#ScamAwareness` `#OnlineSafety` `#CyberSecurity` `#Australia`

## Link placement — the one judgement call

The skill's launch playbook defaults to _link in first comment_. **Don't follow it here.** The
research in `launch-notes.md` (van der Blom, 2026, 1.3M posts) found first-comment links are
now suppressed harder than body links — up to ~80%, versus ~19% for a link in the body. The
old workaround has stopped working.

Treat both figures as directional; other datasets disagree and LinkedIn denies an official
penalty exists. But for a one-off launch to an audience that already knows you, a tappable
link at the moment of interest beats slightly more impressions. The body link above is the
recommended call.

## Format

Two options, in order of reach:

1. **Document/carousel** — run `pnpm --filter @askarthur/web hub:carousel` for the 5-slide
   PDF. Documents lead all LinkedIn formats (~7% engagement). Links inside a PDF are not
   tappable, so the body link still does the work.
2. **Plain text** — the body above on its own. Simplest, and fine.

## Mechanics

- Post when the audience is actually online; reply to every comment in the first hour — the
  first 60 minutes decide distribution.
- Don't repost this text later. Come back in a few weeks with one chapter, one finding, or one
  thing you learned building it.

## Pre-publish checks

- [ ] Re-read the hook against `clone_watch_report_summary` — if August has closed by the time
      you post, "last month" means August, and the number changes. **Query, don't assume.**
- [ ] `LINKEDIN_URL` is set in `apps/web/app/hub/page.tsx` (the Elsewhere row hides itself
      while it's null).
- [ ] Run `askarthur.au/hub` through linkedin.com/post-inspector. LinkedIn caches previews for
      ~7 days and the inspector only fixes _future_ posts.
