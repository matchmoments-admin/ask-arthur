# Shop Signal — deep check is user-initiated

**Status:** accepted (2026-05-20)

Shop Signal's Stage 1 enrichment — ABN verification, WHOIS domain age, and
APIVoid Site Trustworthiness — runs as a **user-initiated "Deep shop check"**,
triggered by an explicit click in the result card, rather than firing
automatically on every commerce-flagged analyze.

## Context

The original Stage 1 spec (issue #321) emitted a `shop.signal.evaluated.v1`
Inngest event synchronously from the analyze dual call-site
(`packages/scam-engine/src/analyze-core.ts` +
`apps/web/app/api/analyze/route.ts`), so the paid APIVoid feed ran on every
commerce analyze. Three problems surfaced when the build reached #321:

1. **Cost.** APIVoid credits and the whoisjson.com free tier (~1000/month,
   already near-exhausted) would be spent on every commerce analyze — most of
   which never need the depth.
2. **No first-paint surface.** The enrichment is async; APIVoid takes seconds.
   The planned ResultCard accordion could never paint on the live web path
   without a background poll on every analyze (open decision D3).
3. **Coupling.** A synchronous emit at the dual call-site grows the ADR 0007
   drift surface and needs a shared persist helper threaded through both sites.

A zoom-out review against the original fake-shop research also found the build
had shipped APIVoid (research priority #6, "tertiary, if budget permits") while
leaving ABN verification (#1, the AU differentiator) and domain age (#3,
"highest-signal feature in published ML research") unbuilt.

## Decision

The deep check is a **separate, user-initiated request** — not a step in the
analyze pipeline:

- The analyze pipeline and the Stage 0 detector (`shop-signal.ts`) are
  untouched. `AnalysisResult.shopSignal.isCommerce` is the only thing the
  client reads to decide whether to offer the deep check.
- The result card renders a distinct "Deep shop check" tray with a "Run a
  deeper shop check" CTA.
- On click → `POST /api/shop-check` creates a `shop_checks` row and emits
  `shop.check.requested.v1` → the `shop-signal-enrich` Inngest function runs
  ABN + WHOIS + APIVoid → the client polls `GET /api/shop-check/[id]`.
- ABN + WHOIS join APIVoid so the deep check rests on the research's
  top-ranked signals, not the blocklist feed alone.

This **supersedes the #321 auto-fire spec.** No Inngest event is emitted from
the analyze dual call-site; the shared `shop-signal-persist.ts` helper that
spec called for is not needed.

## Consequences

- **Cost is bounded by user intent**, not commerce volume — the deep check
  fires only on an explicit click (the `POST /api/shop-check` route is
  rate-limited 5 / 10 min per IP).
- **D3 dissolves.** The user clicks and actively waits, so the poll is a
  natural foreground interaction, not a background poll on every analyze.
- **Zero analyze-pipeline coupling.** The dual call-site (ADR 0007) is not
  touched; its drift surface does not grow.
- **Fewer measurement data points** than auto-fire would produce — but each
  point is a real user-intent deep check, which is the better input to the
  day-31 APIVoid paid-tier renew decision.
- Issue #321's body is now stale; its auto-fire scope is dropped for this model.

## Reversal trigger

If the day-31 measurement shows users rarely click the CTA (low deep-check
volume) and more data is needed, revisit auto-firing the enrichment for a
sample of commerce analyzes behind a flag. That would re-introduce D3 and
require the poll-on-every-analyze surface this ADR avoided.

## Related

- Supersedes the auto-fire scope of issue #321
- ADR 0007 — Shop Signal dual call-sites (deliberately not extended)
- Plan: [`docs/plans/shop-guard-v2.md`](../plans/shop-guard-v2.md)
- ADR 0005 — pgvector index policy (`shop_checks` stays lean per the hot-table rule)
