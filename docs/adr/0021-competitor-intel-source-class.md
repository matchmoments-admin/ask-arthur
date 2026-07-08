# Competitor-intelligence source class — ingest but never publish

**Status:** proposed (2026-07-08)

## Decision

Consumer scam newsletters we subscribe to as intelligence (Which? Scam Alerts,
AARP Fraud Watch, MoneySavingExpert, etc.) are ingested through the existing
inbound-email pipeline into `feed_items` but marked with
`category = 'competitor_intel'` and a slug on the `COMPETITOR_INTEL_SOURCES`
allowlist. This class is **ingested-but-never-published**: the rows land
`published = false` permanently, the Edge Function's tier_3 drop gate lets them
through _before_ the drop check, and the admin quarantine promote action refuses
any `competitor_intel` row. They feed the weekly synthesis cohort and the
operator coverage-gap digest as _signal_; they are never surfaced on the public
`/scam-feed`. Provenance tier stays honest (`tier_3_curated`) — the new
dimension is **category/purpose**, not trust.

## Context

The inbound pipeline (Cloudflare Email Routing → Worker → Edge Function →
`feed_items`) already ingests regulator alerts (tier_1/2, publishable) and, until
2026-06-29, security-press digests (tier_3 — Krebs, THN, Risky Biz), which are
now silently dropped at ingest to keep the quarantine on-mission. Competitor
_consumer scam_ newsletters are a third thing: on-mission enough that dropping
them is wrong, but third-party editorial content that a trust brand must never
republish. Neither existing bucket fits.

## Considered options

- **A new provenance tier (`tier_5_competitor`).** Rejected — provenance_tier
  encodes _trust/authority_ (regulator > CERT > press > OSINT); these newsletters
  are editorially curated (tier_3-ish trust). Overloading provenance to also mean
  "never publish" would corrupt a dimension other code reads for ranking. The
  publish/purpose decision is orthogonal to trust, so it gets its own field.
- **Just don't ingest them.** Rejected — loses the aperture-widening signal and
  the coverage-gap intelligence that is the whole point.
- **Ingest as tier_3 and rely on the existing drop gate staying off.** Rejected —
  the gate exists for a reason; blanket-disabling it re-admits the off-mission
  security press we deliberately dropped.

## Consequences

- **Non-obvious guard:** a future engineer will see rows that are `published =
false` forever and can't be promoted, and wonder why. The answer:
  copyright + trust — competitor content is intelligence, never content.
- **Two new enforcement points** must stay in sync with the slug allowlist: the
  Edge Function gate exception and the promote-action refusal. Adding a competitor
  source means adding it to both plus `COMPETITOR_INTEL_SOURCES`.
- **The synthesis prompt contract** (see `docs/plans/arthurs-watch-newsletter.md`
  §3) is load-bearing: competitor rows may only produce Arthur-voiced,
  corroborated stories — the model must never reproduce competitor prose or
  launder an unverified claim into an Arthur verdict.
