# North Star

_Read this before deciding to build anything. If a proposed feature can't pass the filter below in one paragraph, it doesn't get built._

_(Adopted 2026-08-06 via wayfinder map [#898](https://github.com/matchmoments-admin/ask-arthur/issues/898); drafted and approved in [#899](https://github.com/matchmoments-admin/ask-arthur/issues/899).)_

## Mission

Help Australians — and eventually people anywhere — become aware of, report, and stay safe from scams, especially as new ones emerge.

## How it survives: two engines

**Engine 1 — Consumer protection (the mission and the flywheel).** Free scam-checking wherever people already are: web, extension, bots, email forwarding. Every check and report a consumer makes feeds the intel corpus. This engine is why the platform exists, and its data exhaust is what makes anything sellable. It is measured by _usage_, not features: checks per week, reports per week, returning users.

**Engine 2 — B2B protection & intel (what keeps the lights on).** The same intel corpus, sold to the people who bear scam losses at scale. The committed near-term rail is the **Brand Monitor pilot (A$300/mo, first month free)** — clone-watch detection, takedown escalation, and outcome reporting for AU brands. The medium-term thesis is **intel licensing** — stats, emerging-scam patterns, and feeds for banks, government, and brands (NSW Police pilot is the first proof point; scoping in [#902](https://github.com/matchmoments-admin/ask-arthur/issues/902) — sell self-originated data only, never re-aggregated third-party feeds).

The engines feed each other and neither gets amputated: no consumer feature that starves the intel corpus, no B2B deal that requires degrading the free service.

## Three pillars

1. **Protect** — the consumer checking surfaces (Engine 1).
2. **Fund** — the B2B rail (Engine 2).
3. **Teach** — the broadcast arm of the data flywheel: LinkedIn, the email newsletter, and the blog, led by what the platform detects (detect → cluster → publish), plus community outreach to the people least likely to find a website — aged-care homes, community groups. **The content rule:** every piece either comes _from_ the platform (data-driven) or leads _to_ it (evergreen basics that end at a live tool). Content that does neither is off-mission.

## The filter

Before building or extending anything, it must pass all four, in one paragraph, written down:

1. **Who does it serve now** — Australian consumers, or the AU intel flywheel? ("It might help someday" fails.)
2. **Which engine or pillar does it strengthen**, and does it weaken any other?
3. **Does something already built do this?** Activation beats construction. Extending an existing seam beats a parallel module.
4. **How will we know it worked** — the usage signal, named before the build, checked after.

## Stance

**AU-first, portable patterns.** The moat is Australian: local feeds, `.au` clone-watch, AU jurisdiction routing, SPF positioning. Global is a horizon, not a work item — but build so expansion is a data problem, not a rewrite (source classes, jurisdiction-as-data, brands-as-config).

**Ship, don't shelve.** The failure mode this document exists to prevent: building dark and moving on. A feature isn't done when merged; it's done when someone used it and we saw the signal. When a dark feature _is_ activated, canary it end-to-end and expect stacked defects — the 2026-08-07 blog activation surfaced six.

## Mothballed

_Decided in [#906](https://github.com/matchmoments-admin/ask-arthur/issues/906) (2026-08-06). Mothballed = no further investment; the revive condition is part of the entry and must be met before any work resumes._

| Feature             | Status                                                                      | Revive condition                                                                                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phone Footprint** | Mothballed (zero lifetime usage)                                            | A named prospect asks for it, **and** security issue [#417](https://github.com/matchmoments-admin/ask-arthur/issues/417) (fleet path trusts caller-supplied `org_id`) reopens and ships **first** |
| **Breach Defence**  | Mothballed (paused after PR 2/19; schema live, flags OFF)                   | Engine 2 evidence: brand-pilot conversations surface breach-monitoring demand, or an SPF obligation creates a named buyer                                                                         |
| **Mobile app**      | Mothballed as-built (no live surface)                                       | Engine 1 shows sustained traction, **then** discovery first ([#916](https://github.com/matchmoments-admin/ask-arthur/issues/916)) — never resumed construction of the existing app                |
| **WhatsApp bot**    | _Parked-blocked, not mothballed_ (code-complete; Meta rejects VoIP numbers) | Activate the founder's Amaysim eSIM, then the ADR-0023 Meta runbook — an errand, not a build                                                                                                      |

Stronger than mothballed: the CT-firehose/certstream mechanism is **dead** per ADR-0016's 2026-07-17 amendment; on-page programmatic ads + publisher-side ad scanning is **permanently out of scope** per [#901](https://github.com/matchmoments-admin/ask-arthur/issues/901).
