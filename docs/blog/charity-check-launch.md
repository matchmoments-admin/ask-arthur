# How to Check an Australian Charity in 30 Seconds — Without Giving Them a Cent First

![A faceless person standing on a city footpath holding up a smartphone showing a small green check-mark badge — a quiet pause before deciding whether to donate.](/illustrations/blog-charity-check-hero-v1.webp)

_A donor's guide to the four registers that matter, the four red flags that should stop you, and a free tool that combines all of them in one screen._

---

You're walking through the city on a Saturday. Bourke Street, or Pitt Street, or wherever your equivalent is. A young person with a clipboard and a charity-branded t-shirt steps into your path, smiles, and asks if you have a minute to hear about kids in remote communities. They have a card reader on their phone. They want $30 a month — direct debit, the regular giving page is open and ready.

The cause sounds real. The badge looks official. The pitch is good — they've clearly done this before. But your gut is doing that small thing it does when something doesn't quite fit. Maybe it's the brand-new domain on the printed flyer. Maybe it's the second person hovering ten metres away pretending to scroll their phone. Maybe nothing in particular — you're just the kind of person who'd rather check.

So what do you actually do?

The honest answer is that, until last week, the answer was: take the flyer, get away from the conversation politely, get home, open the ACNC website on your laptop, type in the charity name, squint at the Annual Information Statement, look up the ABN separately on the Australian Business Register to confirm they're DGR-endorsed, then maybe Google whether they're on the Public Fundraising Regulatory Association's list of member charities. By that point — half an hour later, with seven tabs open — you've forgotten the badge number, you've forgotten the agency name, and the moment is gone. Most people just don't.

We built `/charity-check` to collapse that into 30 seconds on a phone, on the footpath, while the conversation is still happening. This post is what's underneath it, what it does well, what it doesn't yet do, and why we think this is the right shape for it.

## Why this is harder than it should be

Australia has four authoritative registers that every donor should arguably know exist. They are all public, they are all free to query, and they don't talk to each other.

**The Australian Charities and Not-for-profits Commission** maintains the Charity Register — about 64,000 entries, every charity registered for Commonwealth tax concessions since 2012. If a charity isn't here, that doesn't always make it a scam (some legitimate fundraisers operate under different legal structures), but for the donor-on-the-footpath case it's the highest-fidelity yes/no answer you can get. The ACNC publishes the register as a downloadable dataset on data.gov.au under a permissive licence; we mirror it locally so a search returns in milliseconds, not seconds.

**The Australian Business Register** holds the ABN status, entity name, registration date, and — crucially — the Deductible Gift Recipient (DGR) endorsement that lets a charity legitimately claim donations are tax-deductible. ABR has a free public lookup. A surprising number of fundraisers will print "tax-deductible" on a flyer without an actual DGR endorsement; for an Australian donor, that combination is a near-perfect red flag.

**State fundraising regulators** vary wildly. New South Wales, since April this year, automatically deems any ACNC-registered charity to hold a state fundraising authority. Victoria, Queensland, South Australia and the ACT exempt ACNC charities entirely or just require notification. **Western Australia and Tasmania still require their own Charitable Collections Licence** on top of ACNC registration. The Northern Territory has no fundraising legislation at all. None of this is searchable from a single place.

**The Public Fundraising Regulatory Association** is the self-regulatory body for face-to-face fundraising in Australia. Member charities — about 50 of them, including names you'd recognise — agree to the PFRA Standard for conduct, and every PFRA-aligned street or door fundraiser carries a numbered ID badge with the agency's branding visible. PFRA membership is the single highest-confidence positive signal you can get for a person standing in front of you with a clipboard. It's also published as plain HTML on `pfra.org.au/membership/` — easy to scrape, almost impossible to discover by accident.

Plus **Scamwatch**, the ACCC's National Anti-Scam Centre, which doesn't run a register but does publish alerts when specific charities are being impersonated — Red Cross after Black Saturday, Rural Fire Service after the Bourke Street attack, Save the Children after the 2020 floods. These alerts are useful context but tricky to use as a verdict input on their own: an alert about _scammers impersonating the Red Cross_ doesn't make the Red Cross any less legitimate.

So the donor on the footpath isn't asking one question. They're asking five, against five different APIs (one of which is HTML and one of which doesn't exist), and they need an answer in the time it takes the fundraiser to get bored and move on.

## The four signals the tool actually checks

When you submit a name or an ABN to `/charity-check`, four things happen in parallel inside a five-second budget. Each one returns its own pillar score — `0` (clean) to `100` (flagged) — and the engine combines them with a weighted sum, redistributing weight when any pillar can't run.

**ACNC registration.** The first and largest signal. We mirror the full ACNC Register locally — every name, ABN, registered website, charity size, and address. A submission by ABN is an exact primary-key lookup; a submission by name uses Postgres trigram similarity to match common variations ("Cancer Council" finds the five state-level Cancer Councils plus the federal one). When the input is a name with no exact match but a strong fuzzy match — say, "Australian Red Cros" — and the edit distance to a registered name is small (three characters or fewer), we flag it as a possible typosquat and force the verdict to HIGH_RISK regardless of anything else.

**ABN active and DGR endorsed.** The Australian Business Register lookup runs in parallel against the ACNC check. We extract entity name, status, and the DGR endorsement (item number, effective dates) from the public ABR XML response. A cancelled ABN is the strongest single negative signal in this pillar. A name mismatch — the user typed "Cancer Foundation" but the ABR returns "ABC Marketing Pty Ltd" — escalates to UNCERTAIN even when the ABN is technically active.

**Donation URL scrutiny.** When the user supplies a donation URL — typed, or from a flyer, or from a QR code they scanned earlier — we run two checks against it: Google Safe Browsing for malware/phishing classifications, and a WHOIS lookup for domain age. A donation domain registered in the last 30 days, attached to a "bushfire appeal" or a "flood relief fund," is the canonical fake-charity scam pattern. Our scoring takes the maximum of the two sub-checks rather than blending them, so a clean WHOIS can't dilute a Safe Browsing hit.

**PFRA membership.** The fourth pillar runs against our local mirror of the PFRA member directory (charities + accredited fundraising agencies). We refresh it weekly. PFRA membership is _additive only_ — when a charity is a member, it nudges the verdict towards SAFE; when it isn't, the pillar simply doesn't fire. This matters because PFRA covers face-to-face fundraising specifically; a perfectly legitimate online-only charity might never join. Penalising non-membership would create false positives at a rate we couldn't justify.

Plus a non-pillar **Scamwatch alert join** — we query our existing Scamwatch RSS mirror for any alerts in the last year that mention the charity name and surface them as collapsible context on the verdict screen. They never affect the score. They come with a disclaimer that the alert may describe an _impersonator_, not the charity itself. The user reads them and judges.

## The four red flags that should stop you regardless

The tool will tell you what the registers say. There are four signals it can't see — the ones in front of you, not on a flyer — that should override anything the tool returns.

1. **Cash, gift cards, cryptocurrency, or a transfer to someone's personal bank account.** Legitimate Australian charities don't ask for these from a stranger on the street. Card readers, regular giving forms, official donation websites — those are the standard. The moment the payment method becomes anything else, the verdict in our tool floors at HIGH_RISK regardless of how clean the registration check came back.
2. **No ID badge, or a refusal to show one when asked.** PFRA-aligned fundraisers carry numbered ID badges with the agency name visible. They are required to show them. A polite "Could I see your ID?" is a fair question; an awkward redirect or an outright refusal is a hard scam signal. Many legitimate non-PFRA fundraisers also carry ID — the absence of a badge isn't damning on its own, but a refusal to produce one is.
3. **A name that's _almost_ a real charity.** "Cancer Cuncil." "Astralian Red Cross." "Save the Childrn." Typosquat names are how scammers piggyback on a brand's recognition without crossing the line into outright impersonation that the brand could litigate. The tool catches these via the trigram + Levenshtein check on the ACNC pillar; the verdict copy spells out the closest match so you can see the resemblance for yourself.
4. **A donation URL that looks like the charity but isn't on the ACNC register's listed website.** Every ACNC-registered charity has a registered website on file. When a fundraiser hands you a URL or a QR that points somewhere else, navigate to the _registered_ site instead — it's the link our verdict screen surfaces as the official CTA. Scammers count on you typing whatever they print on the flyer.

## A walk-through

Open `/charity-check` on your phone. Three input modes: charity name (with autocomplete), ABN (digit pad, spaces and dashes are fine, we strip them), or a photo of the lanyard / badge / flyer. The photo path runs the image through Claude Vision, extracts the charity name and ABN if they're printed clearly, and pre-fills the form for you. If you have one hand on your phone and the other holding a coffee, the photo path is the fastest way in.

Below that, an optional "Are they in front of you right now?" toggle. If you turn it on, we show two follow-up questions — _did they show ID when asked_ and _how are they asking you to pay_ — and the answers feed the behavioural floor rules above. If you leave it off, only the payment-method question shows; we treat the request as an online appeal where ID isn't relevant.

Submit. The verdict screen renders in under a second. At the top: a big coloured pill with one of four labels — **Looks legitimate**, **Pause — we can't fully verify**, **Suspicious**, or **High risk — don't donate** — and a single sentence of plain-English explanation. Below that, a five-icon strip showing whether each pillar passed: ACNC ✓, ABN ✓, DGR ✓, Donation URL ✓, PFRA ✓. If the verdict is SAFE or UNCERTAIN and we have an official donation URL on file, there's a single CTA button: "Donate via their official site." It deep-links the URL we got from the ACNC register. Never the URL the fundraiser supplied.

Scroll. If the charity is a PFRA member, you see an emerald callout explaining what that means and linking to the public directory. If they're registered with ACNC but operating in WA or Tasmania, you see a blue callout pointing to the state register because ACNC registration alone doesn't satisfy those two jurisdictions. If there are recent Scamwatch alerts mentioning the name, they're in an amber collapsible — with the disclaimer that the alerts may describe impersonators, not the charity. If the verdict is HIGH_RISK, there's a recovery section with deep-links to Scamwatch's report flow, IDCARE for identity recovery, and a reminder to contact your bank if you've already paid.

That's the whole thing. The longest path through it is about 25 seconds.

Try the typosquat case to see what HIGH_RISK looks like. Type "Astralian Red Cross" — one letter dropped — into the name field. The autocomplete won't show it (because it's not in the register). Submit anyway. The verdict says: _Stop. The name you entered closely resembles "Australian Red Cross Society" — a registered charity. This is a common impersonation pattern. Don't donate; report this fundraiser to Scamwatch if approached in person or online._

## What we built, briefly, and why

The engine is around 1,500 lines of TypeScript in a workspace package called `@askarthur/charity-check`. Each pillar is its own provider that implements a small interface — `id`, `timeoutMs`, `run(input)` — and the orchestrator calls them all in parallel inside a single five-second budget using `Promise.allSettled` with per-provider timeouts. When a provider fails or times out, the scorer redistributes its weight across the pillars that did return, so a verdict is meaningful even when one upstream is down. This is the same shape we use in the Phone Footprint product; it's documented as ADR-0002 in the repo as a pattern we'll extract into a shared module if a third use case appears.

The data underneath is two Postgres tables. `acnc_charities` holds the 63,637 rows we mirror from the data.gov.au ACNC dataset, refreshed daily by a Python scraper that pages CKAN's `datastore_search` API in 5,000-row chunks and skips writes for unchanged rows via a content-hash check. `pfra_members` holds the ~60 rows we scrape weekly from the PFRA membership pages. ABR Lookup we hit live with a 24-hour Redis cache, because ABR statuses do change and we don't want a charity's ABN cancellation taking a day to propagate. Safe Browsing and WHOIS use the same wrappers the rest of our scam-detection pipeline uses; we get them effectively for free.

We don't store anything about the queries. No PII, no IP-charity-name associations, no funnel of "people who searched X also searched Y." The cost-telemetry table records that _a_ check was done, with the verdict and which providers contributed, so we can monitor spend — but it doesn't record what was checked. The strategic argument is that a charity-verification tool that builds a corpus of "people researching specific charities" is one subpoena away from being a privacy embarrassment. The simpler argument is that we don't need the data.

Total infrastructure cost: zero per query, basically. The ACNC dataset is free. The ABR lookup is free. The PFRA scrape is free. Safe Browsing and WHOIS are free at the volumes we expect. The only thing that costs anything is the optional photo-OCR path, which calls Claude Haiku Vision at roughly half a cent per image — capped at five dollars a day via a circuit breaker that pauses the feature if the daily spend exceeds the threshold. At a hundred lookups a day, your cost to run this tool is your Vercel + Supabase line items, which we'd be paying anyway.

## What we deliberately don't do

We're a quiet second opinion. We're not a regulator. We don't have enforcement powers, and we don't claim that a SAFE verdict means a charity is safe — only that the registers say what they say and the cross-checks lined up. There are charities with legitimately withheld ACNC details (women's-shelter security exemptions, for instance) where our tool returns less than it normally would; we treat missing data as missing, not as suspicious.

We don't scrape the state fundraising registers for NSW, Victoria or WA — yet. The strategic memo for the next sprint adds them, but for now we link out to the official state pages when the charity's registered address makes them relevant. The two states where this matters most for the donor are WA and Tasmania, because both still require their own Charitable Collections Licence on top of ACNC registration. The verdict screen surfaces a callout in those cases, but the donor has to follow the link and check.

We don't yet pull Annual Information Statement financials. The data is on data.gov.au, but it's a separate annual dataset and we haven't done the work to surface "X% of revenue went to programs vs admin" alongside the verdict. The blunt truth is that financial efficiency is a noisier signal than the existence-of-registration signals we already use; a brand-new charity might legitimately spend most of its first year's revenue on infrastructure. We'll add it when we can present it without misleading.

We don't currently have a B2B API. The same engine is one route handler away from being one — `POST /api/v1/charity/verify` is on the roadmap to ship before the Scams Prevention Framework Act obligations kick in for designated banks and telcos on 1 July 2026. If you're a bank or a telco looking at SPF compliance and want pre-transaction charity-payee verification, we'd love to talk.

## Three things to do right now

1. **Try it.** [askarthur.au/charity-check](https://askarthur.au/charity-check). Search for a charity you know, search for one you don't, type a name with a deliberate typo and watch the typosquat detection fire.
2. **Add it to your home screen.** It's a Progressive Web App; on iOS or Android, "Add to Home Screen" makes it a one-tap launcher next to your other apps. The next time you're stopped on the footpath, it's on the second tap.
3. **If you run a charity, check that your ACNC website field is up to date.** That's the URL our verdict screen uses as the official-donation CTA. If it's stale, donors arriving via this tool will be sent somewhere stale.

If the tool catches a fake-charity scam for you, [report it to Scamwatch](https://www.scamwatch.gov.au/report-a-scam). If you've already paid and you're worried about identity recovery, [IDCARE](https://www.idcare.org) is the right call. If you're a journalist working on a charity-scam story and want context on the data, [say hello](mailto:brendan@askarthur.au).

The tool is free and stays free. Most of what we build at Ask Arthur will. The product gets better when more people use it; the data gets better when more people contribute to it; the architecture stays out of the way of that loop. Donating safely shouldn't require a laptop and seven tabs.

_Ask Arthur is askarthur.au. The platform is Australian and the data stays Australian. If you're a sector partner — ACNC, Scamwatch, IDCARE, PFRA — and you'd like to integrate, [say hello](mailto:brendan@askarthur.au)._
