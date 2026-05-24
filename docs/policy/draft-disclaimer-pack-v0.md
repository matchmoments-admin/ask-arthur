# Draft disclaimer pack v0 — pre-counsel redline target (#371)

**Status:** v0 draft. **NOT live legal copy.** This document is a redline target for the engagement described in `docs/policy/371-disclaimer-pack-sow.md`. Every surface here is published as a concrete starting point so the firm can react to specific language rather than draft from scratch.

**Version stamp convention:** every surface carries a slug of the form `<surface>-v<n>-<YYYY-MM-DD>`. v0 is pre-counsel. v1 is the first lawyer-signed-off version. v2+ are revision rounds (the SOW allows two within the fixed fee). The `template_version TEXT` column on `shopfront_takedown_attempts` (per #376 schema spec) records the exact slug used for every outbound artefact.

**Locked language principles (from `docs/policy/371-disclaimer-pack-sow.md` + ADR-0015):**

1. **Factual signal language only** — every assertion describes an observed signal ("we detected X at time Y with score Z"), never a legal characterisation ("this is a clone", "this is a scammer", "this site is fraudulent").
2. **Point-in-time framing for Verified surfaces** — "as of [timestamp]", "no negative signal detected at the time of this check", never "safe to transact" or any warranty-shaped language.
3. **Two-tier confidence** for clone-detection — distinguish _signal-confirmed_ (Brand Match + Visual Match both fired with page fetched) from _signal-suspected_ (Brand Match only; page not fetched).
4. **Even-handed third-party language** for cold-outreach — "we observed a domain that matches your brand at edit-distance N"; never name the registrant or imply intent.

---

## Surface 1 — Verified badge

**Code constant target:** `VERIFIED_BADGE_COPY` in `apps/shopfront-shopify/lib/copy.ts`.

**Where rendered:** Order Status thank-you page UI extension on installed merchant storefronts.

**Version slug:** `verified-badge-v0-2026-05-24`.

### Badge label (visible inline)

> **Verified by Ask Arthur** &middot; checked [N] minutes ago

### Hover / tap explainer (modal)

> **What "Verified by Ask Arthur" means**
>
> This merchant is currently a participant in the Ask Arthur Shield Verified program. As of [verified_at timestamp, AEST], no negative signal had been detected against this storefront in our daily checks. Negative signals include suspected impersonation domains targeting this brand, scam-report references naming this merchant, and storefront content fingerprints matching known abuse patterns.
>
> **What this badge does _not_ mean.** This badge is not a warranty that any specific transaction will be safe, that goods will arrive, or that the merchant's products meet any particular standard. It records the absence of a negative signal in our checks at a point in time. The badge may be revoked at any time, and is re-checked daily.
>
> **If you have a concern about this merchant**, you can report it at askarthur.au/report &middot; Verification status history is published at askarthur.au/verified/[shop-handle].

### Revoked-state copy (badge transitions to "revoked")

> **Verification revoked** &middot; revoked [N] hours ago. The reason for revocation is published at askarthur.au/verified/[shop-handle]/history.

### Rationale (for counsel)

The badge is the highest-volume surface in the pack — every install renders it on every order-status page. Two defamation/ACL concerns:

- **s 18 ACL (misleading-or-deceptive)** — risk that consumers read "Verified" as a transaction warranty. Mitigation: explicit "this badge does not mean" paragraph in the explainer + point-in-time framing on the label itself.
- **Uniform defamation (re merchants)** — risk that the _revoked_ state imputes wrongdoing. Mitigation: factual-signal "negative signal detected" language + linked history page so the merchant can see and (if appropriate) dispute the specific signal that triggered revocation.

### Open questions for counsel

1. Is "Verified by Ask Arthur" sufficient as the inline label, or do we need a longer disclaimer chip on first-render (e.g. "Verified — point-in-time")?
2. The revoked-state copy is the most-litigable line in the pack. Does the firm prefer "Verification revoked" (current draft) over softer alternatives like "Verification paused" or "Verification under review"? Each has different defamation profiles.
3. Should the explainer cite a specific Australian Consumer Law section (s 18) by name, or is the plain-English framing sufficient?

---

## Surface 2 — Clone-detection alert (signal-confirmed: Brand Match + Visual Match fired, page fetched)

**Code constant target:** `CLONE_ALERT_CONFIRMED_EMAIL` and `CLONE_ALERT_CONFIRMED_DASHBOARD` in `apps/shopfront-shopify/lib/copy.ts`.

**Where rendered:** email to merchant + Polaris card on merchant dashboard.

**Version slug:** `clone-alert-confirmed-v0-2026-05-24`.

### Email subject

> [Ask Arthur Shield] Possible impersonation domain detected for [merchant_name]

### Email body

> Hi [merchant_first_name],
>
> Our daily Shield scan detected a domain that appears to be impersonating your storefront. The detected signals are listed below. **We have not made any legal characterisation of the registrant or the operator** — these are the raw factual signals our scanner observed.
>
> **Detected at:** [detected_at, AEST]
> **Suspected impersonation domain:** [candidate_domain]
> **Brand Match signal:** your brand name "[merchant_brand]" appears in the domain at Levenshtein edit-distance [N]. (Brand Match score: [0.0-1.0].)
> **Visual Match signal:** the homepage at the suspected domain was fetched at [fetched_at]. Logo perceptual-hash distance from your storefront: [N]. Page-structure fingerprint similarity: [score]. (Visual Match score: [0.0-1.0].)
> **Composite severity:** [LOW / MEDIUM / HIGH] (see askarthur.au/verified/methodology for how this is computed).
>
> **What you can do:**
>
> 1. **Review the signals above.** If the domain is your own (a campaign microsite, a partner storefront, a Shopify Shop redirect), reply to this email and we'll add it to your allowlist within one business day.
> 2. **If the domain is not yours**, you can use our merchant-self-serve abuse templates at askarthur.au/shield/takedown to file a DMCA notice (US registrar), a domain-registrar abuse report (most TLDs), or a Cloudflare host-abuse report. Templates are pre-filled with the signals above so you can send them without re-typing.
> 3. **Upgrade to Shield Pro** (A$29/mo) if you'd like Ask Arthur's takedown team to handle this for you within 5 business days. See askarthur.au/shield/pro.
>
> **What this email is not.** This is not legal advice. We have not characterised the registrant or operator of the suspected domain. We have not contacted them on your behalf. The signals above are factual observations from our scanner that you can use to make your own decisions.
>
> &mdash; Ask Arthur Shield
> [template_version: clone-alert-confirmed-v0-2026-05-24]

### Dashboard card (same signals, condensed)

> **Possible impersonation domain detected**
>
> [candidate_domain] &middot; detected [N] hours ago &middot; severity [LOW / MEDIUM / HIGH]
>
> Brand Match: edit-distance [N] from "[merchant_brand]"
> Visual Match: logo pHash distance [N], page-structure similarity [score]
>
> [Review signals] [File takedown] [Allowlist as mine]

### Rationale (for counsel)

This is the merchant-internal surface — the merchant is the data subject of the email. Defamation risk is lower than the cold-outreach surface (#5) because we're not communicating about the merchant to a third party. The primary risks are:

- **ACL s 18 (if signals are wrong)** — risk that the merchant relies on a false-positive to file a takedown that defames an innocent registrant. Mitigation: factual-signal-only language in the email + the takedown templates themselves; explicit "we have not characterised" disclaimer.
- **APP 6 (personal information about the registrant)** — if the registrant's identifying information appears anywhere in the email (it doesn't in v0 — only the domain), APP 6 may apply.

### Open questions for counsel

1. Should the email include the registrant's WHOIS details when available (more useful for the merchant's takedown decision), or strictly exclude them (lower APP / defamation surface)?
2. The "Composite severity" label uses LOW / MEDIUM / HIGH. Does the firm prefer more neutral language (e.g. SIGNAL_WEAK / SIGNAL_MIXED / SIGNAL_STRONG) to avoid implying a verdict?
3. Is the "What you can do — Upgrade to Shield Pro" CTA acceptable in the same email as a factual signal report, or does it need to be in a separate follow-up?

---

## Surface 2b — Clone-detection alert (signal-suspected: Brand Match only, page not fetched)

**Code constant target:** `CLONE_ALERT_SUSPECTED_EMAIL` and `CLONE_ALERT_SUSPECTED_DASHBOARD`.

**Version slug:** `clone-alert-suspected-v0-2026-05-24`.

### Email subject

> [Ask Arthur Shield] Potential impersonation domain registered for [merchant_name] (low-confidence signal)

### Email body (deltas from 2)

> Our daily Shield scan detected a newly-registered domain whose name resembles your storefront. **We did not fetch the page content**, so we have no Visual Match signal yet — this email reports the Brand Match signal only.
>
> **Detected at:** [detected_at, AEST]
> **Suspected impersonation domain:** [candidate_domain]
> **Brand Match signal:** your brand name "[merchant_brand]" appears in the domain at Levenshtein edit-distance [N]. (Brand Match score: [0.0-1.0].)
> **Visual Match signal:** _not yet evaluated. The page will be fetched on the next scan window if it remains active._
> **Composite severity:** [LOW / SUSPECTED] (lower than confirmed alerts because only one signal has fired).
>
> [...same takedown / allowlist / Shield Pro options as Surface 2, but with stronger language about waiting for the Visual Match]
>
> **What this email is not.** This is not legal advice, and the signal here is weaker than a fully-fetched candidate. If you file a takedown based on this signal alone, the abuse contact may push back asking for evidence the page is actually impersonating your brand. We recommend waiting for the next scan window (typically 24 hours) unless the domain is clearly typosquatting your brand on its face.

### Rationale

This surface exists because of the SOW's "two-tier confidence" requirement. The signal-suspected variant must be visibly weaker in tone so merchants don't over-rely on it. The "page not fetched" framing is important — it explains why the signal is weaker without implying we're hiding information.

### Open questions

1. Is "low-confidence signal" in the subject line acceptable, or does the firm prefer "preliminary signal" / "early signal"?
2. Should signal-suspected alerts route to the dashboard only (no email) until they upgrade to signal-confirmed, to reduce false-positive noise to merchants?

---

## Surface 3 — Verified Directory listing copy

**Code constant target:** `VERIFIED_DIRECTORY_LISTING_COPY` in `apps/web/app/verified/[shop-handle]/page.tsx`.

**Where rendered:** public page at `askarthur.au/verified/[shop-handle]`.

**Version slug:** `directory-listing-v0-2026-05-24`.

### Page header

> **[merchant_business_name]**
> Verified by Ask Arthur Shield &middot; verified continuously since [first_verified_at, AEST]
> Current status: **Verified** (last checked [N] minutes ago)

### What this listing means (sticky callout)

> **What this Verified listing means**
>
> This merchant is a current participant in the Ask Arthur Shield Verified program. As of the most recent check (timestamp above), no negative signal had been detected against this storefront. Negative signals are described in our methodology at askarthur.au/verified/methodology.
>
> **What this listing does not mean.** This listing is not a warranty that any specific transaction will be safe, that goods will arrive, or that the merchant's products meet any particular standard. Verification records the absence of a negative signal in our checks, and may be revoked at any time. The full revocation history for this merchant is published below.

### Verification history block (always rendered, even if no revocations)

> **Verification history**
>
> | Date (AEST) | Event    | Signal             |
> | ----------- | -------- | ------------------ |
> | 2026-05-24  | Verified | First verification |
> | (none)      |          |                    |
>
> _Revocations are recorded with the specific signal that triggered them. If a verification was restored, the restoration event is recorded with the resolving signal._

### Footer

> Have a concern about this listing? Report it at askarthur.au/report. Are you the merchant and want to dispute a revocation event? Email shield@askarthur.au.
>
> [template_version: directory-listing-v0-2026-05-24]

### Rationale

The Directory is the **primary moat** per ADR-0014 — every listing is a public assertion about a merchant. Defamation surface is highest where a revocation event is rendered next to the merchant's name. The mitigation strategy is:

- **Always show the verification history block**, even when empty, so consumers understand the time dimension of the badge.
- **Record the specific signal** that triggered a revocation, so the merchant can see and dispute it.
- **Provide a contact path** for the merchant to dispute revocations.

### Open questions

1. The verification history table publishes the _signal type_ (e.g. "Brand Match + Visual Match fired against impersonation-domain candidate"). Should we publish the specific candidate domain that triggered the revocation, or omit it for the registrant's protection?
2. Does "Verified continuously since [first_verified_at]" carry warranty implications under s 18 ACL that "Verified since [first_verified_at]" wouldn't?
3. The page is public and crawlable by search engines. Does the firm want a `noindex` instruction on revoked-status pages until a dispute window closes?

---

## Surface 4 — Takedown templates (DMCA / registrar abuse / Cloudflare host abuse)

**Code constant targets:**

- Merchant-self-serve (free tier): `TAKEDOWN_TEMPLATE_MERCHANT_DMCA`, `TAKEDOWN_TEMPLATE_MERCHANT_REGISTRAR`, `TAKEDOWN_TEMPLATE_MERCHANT_CLOUDFLARE`
- Ops-sent (Shield Pro 5-BD): `TAKEDOWN_TEMPLATE_OPS_DMCA`, `TAKEDOWN_TEMPLATE_OPS_REGISTRAR`, `TAKEDOWN_TEMPLATE_OPS_CLOUDFLARE`

**Version slug:** `takedown-templates-v0-2026-05-24`.

### Merchant DMCA template (self-serve)

> Subject: DMCA Takedown Notice — [merchant_brand] / [candidate_domain]
>
> To: [abuse contact]
>
> I am writing to provide notice under 17 U.S.C. § 512(c) of copyright infringement on the website hosted at your service.
>
> **My copyright-protected work:** [merchant_brand] storefront content at https://[merchant_shopify_domain] (registered/published date: [first_observed]).
>
> **The allegedly infringing material:** https://[candidate_domain]/[path]
>
> **Factual signals supporting this notice** (provided by Ask Arthur Shield):
>
> - Brand Match: the suspected domain contains my brand name at Levenshtein edit-distance [N]
> - Visual Match: the suspected page's logo perceptual-hash distance from my storefront's logo is [N]
> - Visual Match: the suspected page's structure fingerprint similarity to my storefront is [score]
> - Detected by Ask Arthur Shield at [detected_at, AEST]; signals reproducible at [signal_evidence_url]
>
> I have a good-faith belief that the use of the material identified above is not authorized by me, my agent, or the law. The information in this notification is accurate, and under penalty of perjury, I am authorized to act on behalf of the copyright holder.
>
> [merchant_name]
> [merchant_email]
> [merchant_business_address]
>
> [template_version: takedown-templates-v0-2026-05-24]

### Ops DMCA template (Shield Pro — Ask Arthur sends on merchant's behalf)

> Subject: DMCA Takedown Notice — [merchant_brand] / [candidate_domain] (acting as authorised agent)
>
> To: [abuse contact]
>
> Ask Arthur Pty Ltd (askarthur.au) is acting as authorised agent for [merchant_business_name] under the Shield Pro takedown service. The merchant's agency authorisation is on file with us (Shield Pro engagement ID [engagement_id]) and is available on request.
>
> [...same body as the merchant template, with the closing signature block replaced...]
>
> Yours faithfully,
> Ask Arthur Shield takedown team
> shield@askarthur.au
>
> [template_version: takedown-templates-v0-2026-05-24]

### Registrar abuse template + Cloudflare host abuse template

Same structural pattern: factual signal block + standard registrar/host-abuse boilerplate + contact block. Full text omitted from v0 because it follows the DMCA template's shape and the firm's redline on DMCA will propagate cleanly.

### Rationale

Takedown templates have a different threat model from the merchant-facing alerts. The abuse contact at a registrar or host is a third party with the power to disconnect a domain. Mis-stating a legal characterisation in a takedown can:

- Trigger counter-notice from the registrant (DMCA § 512(g))
- Expose the merchant (or Ask Arthur, on Shield Pro) to a defamation claim from the registrant if the takedown succeeds and the registrant disputes
- Trigger ACL s 18 risk if the takedown notice misleads the host about the basis for the claim

The mitigation: **the templates ship the factual signals verbatim** rather than legal characterisations, so the merchant or Ask Arthur is not asserting infringement _as a legal conclusion_ — they're providing the signals and the standard "good-faith belief" clause that DMCA requires.

### Open questions

1. Should the merchant template require the merchant to add a sworn declaration of authorisation, separate from the DMCA "under penalty of perjury" clause?
2. The Ops template asserts agency authorisation. Does that need to be backed by a signed engagement letter beyond the click-through Shield Pro signup, and if so, what wording for the Shield Pro signup flow?
3. Registrar and host abuse templates (not DMCA) — does the firm want each to follow the DMCA factual-signal shape, or is there a different tradition we should follow for non-DMCA abuse channels?

---

## Surface 5 — Cold-outreach email (clone-detection → claim-your-badge)

**Code constant target:** `COLD_OUTREACH_CLONE_HIT_EMAIL` in `apps/web/lib/cold-outreach/copy.ts`.

**Where rendered:** outbound email sent by Ask Arthur to AU merchants whose brand appears in a clone alert (#385). **Highest defamation exposure in the pack** — third-party-to-third-party communication.

**Version slug:** `cold-outreach-clone-hit-v0-2026-05-24`.

### Subject

> [Ask Arthur] We observed a domain that resembles your brand — claim a Verified listing?

### Body

> Hi [recipient_first_name or "team at [inferred_target_brand]"],
>
> Ask Arthur (askarthur.au) is an Australian scam-detection platform. Our daily scanning observed a domain that resembles your brand. We are writing as a third party to let you know what we observed and to offer you a free Verified listing in our public directory, which makes it easier for consumers to distinguish your real storefront from look-alikes.
>
> **What we observed (factual signals only):**
>
> - **Inferred target brand:** [inferred_target_brand]
> - **Inferred target domain:** [inferred_target_domain]
> - **Observed candidate domain:** [candidate_domain]
> - **Brand Match signal:** the candidate domain contains your brand name at Levenshtein edit-distance [N]
> - **Detected at:** [detected_at, AEST]
>
> **What we have not done.** We have not characterised the operator of the candidate domain. We have not contacted them. We have not made any legal claim about their conduct. The observation above is a signal from our scanner that we are sharing with you because you appear to be the brand that signal references.
>
> **Why we're emailing you.** Two reasons:
>
> 1. **Awareness.** You may already know about this domain. If so, no action required from this email.
> 2. **An offer.** Ask Arthur runs a free Verified directory at askarthur.au/verified for Australian merchants. Listed merchants get a public listing that consumers can use to confirm a storefront is their real one (handy when look-alike domains exist). If you'd like to claim a free Verified listing, reply to this email or sign up at askarthur.au/shield.
>
> **How we found you.** Our scanner observes new domain registrations and matches them against known Australian brand names. The match that triggered this email is described above. If you'd like to opt out of future emails of this kind, reply with "unsubscribe" and we'll suppress your brand from future outreach within one business day.
>
> &mdash; Ask Arthur
> brendan@askarthur.au &middot; askarthur.au
>
> [template_version: cold-outreach-clone-hit-v0-2026-05-24]

### Rationale

This is the highest-stakes surface in the pack because:

- We are emailing a third party (the inferred target merchant) about another third party (the candidate domain registrant)
- The merchant has no pre-existing relationship with us
- The email _implies_ the candidate domain is impersonating the merchant — defamation surface if we're wrong about the candidate, ACL s 18 surface if the merchant relies on the email and takes action

Mitigation strategy in the draft:

- **Inferred** language throughout — "inferred target brand", "inferred target domain", never "your impersonator"
- **Factual signals only** in the observation block — no characterisation
- **Explicit "what we have not done"** paragraph isolating Ask Arthur from any legal claim about the candidate's operator
- **Genuine value-add framing** — the offer is a free Verified listing, not a paid product upsell, so the email is not pretextually marketing-shaped
- **Unsubscribe path** so the merchant can opt out; reduces SPAM Act exposure

### Open questions for counsel (most critical in the pack)

1. **Defamation by implication.** Even without naming the candidate's operator, does the email's structure (here is a domain, here is your brand, here is the match) impute wrongdoing to the candidate's registrant? If so, what language change neutralises the implication?
2. **Australian Spam Act 2003.** Cold-outreach to merchants we have no prior relationship with — does this qualify as "commercial electronic message" requiring prior consent? The "genuine offer of value, no commercial intent" framing in the draft is intended to push the email into "factual notification" territory, but counsel's call.
3. **ACCC / ACL s 18.** Does the "Verified listing" offer carry warranty implications when paired with the clone-detection observation?
4. **Who is the appropriate sender.** Currently the draft signs `brendan@askarthur.au` — should this be a no-reply, a `shield@`, or a personal sender? Each has different liability profiles.
5. **Volume cap.** Is there a per-merchant or per-week volume cap we should commit to as part of the pack to limit the "this looks like a marketing campaign" framing risk?
6. **One-shot vs. follow-up.** The current draft is one-shot per merchant per candidate (no follow-up). Is that the right discipline, or does the firm advise something different?

---

## Cross-cutting open questions for counsel

These don't fit a single surface but should be answered as part of the engagement:

1. **Plain-English explanation document.** Each surface deserves a short rationale doc that future engineers can read so they don't soften the copy into a liability. v0 includes a "Rationale" block on each surface intended as the seed. Does the firm want to produce a single rationale doc covering all 5 surfaces, or per-surface rationale docs?
2. **Translation policy.** All surfaces are English-only in v0. If we localise (Mandarin, Vietnamese, Arabic per the AU consumer mix), is the disclaimer pack's protection inherited by the translations, or do the translations need a separate review?
3. **Storage of historical versions.** Per the SOW + #376 schema, every outbound artefact records its `template_version`. Does the firm want a destruction policy for old versions, or do we retain indefinitely for evidence purposes?
4. **Engagement of a defamation-specialist barrister.** The cold-outreach surface (#5) may benefit from a barrister opinion alongside the firm's solicitor advice. Is this in scope of the A$3-5K envelope, or a separate cost?

---

## What we want back from the engagement

- **v1 redlined drafts** of all 5 surfaces (the firm signs off on the language)
- **A single rationale doc** explaining the language choices so future engineers and AI assistants do not soften the copy into a liability
- **A short opinion** on the cross-cutting questions above

The 5 v1 drafts will be committed as code constants in `apps/shopfront-shopify/lib/copy.ts` (or the appropriate file per surface) with the `template_version` slug stamped on every outbound artefact via the `shopfront_takedown_attempts.template_version` column.

---

## Why this document exists ahead of engagement

The disclaimer pack is on the critical path for #376 (clone-detection scanner flag flip), #385 (cold-outreach pipeline), #374 (Verified badge surface), and #375 (Verified Directory). Engaging a lawyer with a brief produces a 4-week wall-clock (engagement letter → first draft → review → revisions). Engaging the same lawyer with a concrete redline target compresses that to ~2 weeks (engagement letter → redline → revisions) for the same fee envelope. The 2-week saving stacks on top of every downstream dependency.

This document is a one-shot artefact. After v1 returns from counsel, this file is superseded by the audited copy committed in `apps/shopfront-shopify/lib/copy.ts` and the rationale doc returned by the firm.
