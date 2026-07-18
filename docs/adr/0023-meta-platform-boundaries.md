# 0023 — Meta platform boundaries (2026): what we can and can't build

**Status:** accepted (2026-07-19)

When Meta developer access (WhatsApp + Messenger) was granted, we scoped three
asks — activate inbound scam-check bots, report scams TO Meta for takedown, and
ingest Facebook Marketplace/Messenger data — against Meta's actual 2026 API and
policy surface. This ADR records the feasibility verdicts so the blocked paths
aren't re-scoped every quarter.

## Decision

Build only the two green-lit surfaces; treat the rest as blocked or brand-gated.

| Capability                           | Verdict                 | Basis                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **WhatsApp inbound check-bot**       | ✅ Build                | Cloud API; `whatsapp_business_messaging` + `whatsapp_business_management`; user-initiated → 24h service window, free-form text+image reply, no template needed.                                                                                                                                                                                                               |
| **Messenger inbound check-bot**      | ✅ Build                | Send API + webhooks; `pages_messaging`; 24h standard window; automated advisory replies are within policy.                                                                                                                                                                                                                                                                    |
| **Report scam → Meta (takedown)**    | ⚠️ Brand-gated only     | The ONLY programmatic path is the **IP Reporting API inside Brand Rights Protection**, usable ONLY for a rights-holder's **own registered trademark**. There is **no general "report any scam" Graph endpoint**; arbitrary scam/impersonation/fake-listing reports stay **manual webform**. See [docs/plans/meta-brp-report-to-meta.md](../plans/meta-brp-report-to-meta.md). |
| **Ingest Marketplace conversations** | ❌ Blocked              | Marketplace chats live on **personal profiles**; the Messenger Platform only delivers webhooks for Page/IG-professional inboxes, so those conversations never reach a third-party app.                                                                                                                                                                                        |
| **Ingest Marketplace listings**      | ❌ Blocked (commercial) | Only the **academic-only** Meta Content Library API exposes Marketplace listings (accredited research institutions, clean-room). No consumer Graph API. **Scraping violates Meta ToS.**                                                                                                                                                                                       |
| **Ad Library API (AU scam ads)**     | ⚠️ Narrow               | In **Australia the Ad Library API returns political/social-issue ads only**; all-ad-type coverage exists only in EU/UK under the DSA. Not a usable AU consumer-scam-ad feed. Scraping the UI breaches ToS. (See issue #823.)                                                                                                                                                  |

## Consequences

- The "activate the bots" goal is delivered by config, not new detection code
  — see [docs/ops/meta-bots-config.md](../ops/meta-bots-config.md).
- The only feasible "Facebook Marketplace scam detection" is **user-initiated**:
  a user forwards a suspicious listing/message to the bot, or uses the
  extension's client-side, in-the-user's-own-browser Marketplace content script
  (`apps/extension/src/entrypoints/facebook-marketplace.content.ts`, dark behind
  `WXT_FACEBOOK_ADS`). **Do not** plan any server-side Marketplace data flywheel
  via Meta — there is no commercial channel.
- "Report to Meta" is not a consumer feature; it is a **Brand Monitor add-on**
  contingent on a pilot brand + their registered trademark + BRP enrollment.
- A logged `meta_report` onward destination was considered and **deferred**: its
  only current consumer (the web onward picker) is thin and it wouldn't surface
  for the bots (channel unknown). Revisit when a concrete consumer exists.
