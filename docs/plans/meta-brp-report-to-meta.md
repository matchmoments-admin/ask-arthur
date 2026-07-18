# Report scams TO Meta via Brand Rights Protection — requirements & plan

**Status:** scoped, not built (brand-gated). See [ADR-0023](../adr/0023-meta-platform-boundaries.md).

The goal "report scams to Meta for takedown" has exactly one programmatic path
in 2026: the **IP Reporting API inside Meta Brand Rights Protection (BRP)**. It
is narrow — and understanding _how_ narrow is the point of this doc, so we don't
build a general "report any scam to Meta" pipe that Meta does not offer.

## What BRP IP Reporting can and cannot do

- **Can:** let a **rights holder** report content that infringes **their own**
  registered trademark / copyright — including scam ads, fake Pages, and
  impersonation profiles that misuse _that specific brand_.
- **Cannot:** report arbitrary scams, or brands you don't hold rights to. There
  is no general "report content" Graph endpoint. Everything else is a **manual
  webform** (facebook.com/help/reportlinks).

## Eligibility gate (all required)

1. A **Meta Business Manager** account (Ask Arthur's — exists).
2. **BRP access approved** by Meta (application + review; not self-serve).
3. An **active registered trademark** for the brand being protected.
4. The applicant is an **employee/authorised agent** of the rights holder.
5. `META_BRP_ACCESS_TOKEN` issued for the approved Business (env reserved,
   unused in code today).

## Why it's a Brand Monitor add-on, not a consumer feature

Ask Arthur does not own most brands it detects impersonations of. BRP only works
when **the brand itself authorises Ask Arthur as its agent**. So this rides the
Brand Monitor pilot: a monitored/pilot brand with a registered trademark signs
an authorisation → Ask Arthur enrolls in BRP as their agent → we report
Meta-hosted impersonations of _their_ mark. It is one brand's takedown lever,
not a firehose.

## Build plan (when the first authorised brand exists — NOT before)

Deferred deliberately: a client + worker with no authorised brand is dead code
and cannot be tested end-to-end. When a pilot brand signs:

1. `packages/scam-engine/src/meta-brp.ts` — a thin IP-Reporting client
   (submit + status), gated by a `feature_brakes.meta_brp` kill-switch and
   `logCost({feature:"meta_brp"})`, keyed per authorised `brand_key`.
2. A `meta_ip_report` onward destination (enum + worker) that **no-ops unless**
   the impersonated `brand_key` is in an `brp_authorised_brands` allowlist —
   so it can never fire for a brand that hasn't authorised us.
3. An authorisation record (brand_key → trademark reg #, authorisation doc ref,
   BRP-enrolled bool) so the worker's gate is auditable.
4. Reuse the clone-watch weaponisation evidence (screenshots, URLs) as the
   report payload where the impersonation is a domain/clone.

## Interim (today)

For any Meta-hosted scam, the honest path is the **manual webform**: the bot /
web "Report scam" flow can surface `facebook.com/help/reportlinks` as guidance.
No API, no automation, no false promise of takedown.
