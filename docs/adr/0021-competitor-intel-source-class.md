# Competitor-intelligence source class — ingest but never publish

**Status:** accepted (2026-07-09)

## Decision

Consumer scam newsletters we subscribe to as intelligence (Which? Scam Alerts,
AARP Fraud Watch, MoneySavingExpert, etc.) are ingested through the existing
inbound-email pipeline into `feed_items` but marked with
`category = 'competitor_intel'` and a slug on the `COMPETITOR_INTEL_SOURCES`
allowlist. This class is **ingested-but-never-published**: the rows land
`published = false` permanently, the Edge Function's tier*3 drop gate lets them
through \_before* the drop check, and the admin quarantine promote action refuses
any `competitor_intel` row. They feed the weekly synthesis cohort and the
operator coverage-gap digest as _signal_; they are never surfaced on the public
`/scam-feed`. Provenance tier stays honest (`tier_3_curated`) — the new
dimension is **category/purpose**, not trust.

## Context

The inbound pipeline (Cloudflare Email Routing → Worker → Edge Function →
`feed_items`) already ingests regulator alerts (tier*1/2, publishable) and, until
2026-06-29, security-press digests (tier_3 — Krebs, THN, Risky Biz), which are
now silently dropped at ingest to keep the quarantine on-mission. Competitor
\_consumer scam* newsletters are a third thing: on-mission enough that dropping
them is wrong, but third-party editorial content that a trust brand must never
republish. Neither existing bucket fits.

## Considered options

- **A new provenance tier (`tier_5_competitor`).** Rejected — provenance*tier
  encodes \_trust/authority* (regulator > CERT > press > OSINT); these newsletters
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
- **Slug sync-point checklist.** Adding one competitor source is a distributed
  change that touches _five_ places, all of which must land together or the source
  silently mis-behaves (dropped, mis-attributed, or un-embedded):
  1. **Worker** `apps/cloudflare-email-worker/src/index.ts` — add the tag to
     `KNOWN_TAGS`.
  2. **Edge Function** `supabase/functions/intel-inbound-email/index.ts` — add the
     slug to the Zod source enum, `COMPETITOR_INTEL_SOURCES` (gate exception +
     `category='competitor_intel'` stamp + 45k body-store), `provenanceTierFor()`,
     and `countryCodeFor()`.
  3. **Migration** — extend `feed_items_source_check`, the
     `get_unembedded_narrative_feed_items()` RPC allowlist, and the partial
     unembedded index (see v213 for the reference shape).
  4. **`feed_sources` seed row** — one INSERT (`enabled=false`) in that same
     migration.
  5. **CF Email Routing rule** for the tag (dashboard or API) + the actual
     newsletter subscription.
- **No sender verification on inbound attribution (hard Phase 3 gate).** Source
  attribution is derived purely from the recipient tag
  (`<tag>+ingest@askarthur-inbound.com`) — there is **no SPF/DKIM/DMARC or
  sender-identity check** on the inbound path. Anyone who guesses a tagged address
  can inject content that gets attributed to a trusted source and lands in the
  synthesis cohort. This is acceptable while the content is inert (quarantined,
  never published) but is a **hard blocker for Phase 3 (the public aperture
  blend)**: no un-sender-verified competitor row may reach a public surface until
  this gap is closed.
- **The 45k stored competitor body is un-scrubbed by design.** Competitor rows
  store up to 45k of the newsletter body (to feed extraction). Unlike user-submitted
  content, this is **third-party PUBLISHED editorial** — it carries no user PII, so
  it is deliberately **not** run through `redactPII`/`stripUrlPii`. This is a
  documented exemption from the "scrub PII before storing" rule, justified by the
  content being already-public editorial rather than user data.
- **The synthesis prompt contract** (see `docs/plans/arthurs-watch-newsletter.md`
  §3) is load-bearing: competitor rows may only produce Arthur-voiced,
  corroborated stories — the model must never reproduce competitor prose or
  launder an unverified claim into an Arthur verdict.
