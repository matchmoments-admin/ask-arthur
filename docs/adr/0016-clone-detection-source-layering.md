# Clone-detection data source layering — corpus first, CT firehose second, NRD + Hetzner conditional

**Status:** accepted (2026-05-24)

Shopfront clone-detection layers its **data sources** in three phases
that mirror ADR-0015's signal-model phases. **Phase A** consumes the
existing scam corpus (`scam_reports` + `reddit_post_intel` + `feed_items`)
joined daily against Verified Shops' brand names — a pull-mode corpus
search, NOT a new scraper (tightened during the 2026-05-24 grilling
session; see #376 for the column mapping). **Phase B** adds a
Calidog public certstream WSS subscription as a sibling data source
feeding the SAME `shopfront_clone_alerts` table. **Phase C** adds a
whoisds NRD daily backstop and — only conditionally — a self-hosted
Hetzner certstream-server. There is no new `clone_findings` table;
there is no new `packages/domain-monitor/` package at Phase A or B.

## Context

The unreviewed Proactive Domain Monitor draft proposed a
`packages/domain-monitor/` package that would subscribe to Calidog,
whoisds NRD, AND a self-hosted Hetzner certstream-server from day one,
writing into a brand-new `clone_findings` table parallel to the
existing `brand_impersonation_alerts` (9 rows) and the planned
`shopfront_clone_alerts` (in `supabase/migrations/v140`). That
architecture is overbuilt for Phase A's user surface, fragments the
data corpus (two parallel tables for the same domain-of-discourse
concept), and pays Hetzner hosting cost before Calidog's public
endpoint has been measured.

The existing `packages/scam-engine/src/inngest/ct-monitor.ts` is a
DIFFERENT product surface. It targets AU government / bank / telco
brand impersonation (keywords: `mygov`, `centrelink`, `ato.gov`,
`auspost`, `commbank`, `nab`, `westpac`, `telstra`, `servicensw`)
running every 12h against crt.sh with exponential backoff. It is NOT
the Shopfront merchant-protection surface and MUST NOT be replaced or
repurposed by clone-detection work. It writes to a different concern
(brand-impersonation feed for the consumer extension + scam-corpus
enrichment), it owns its own keyword list, and it has its own
rate-limit story (12h cadence, retry budget).

The `brand_impersonation_alerts` table (existing, 9 rows) is the
write target for that CT monitor. Clone-detection for Shopfront
merchants is a different read pattern (per-merchant alert digest,
takedown queue) and gets its own table — `shopfront_clone_alerts` from
v140 — but the two concerns should be **discriminated**, not
**parallelised**: if there is ever overlap (a Calidog hit that flags
both a SPF-sector govt impersonation AND an installed Shopfront
merchant clone), it should be modelled with a discriminator column on
the existing table, not a third parallel table.

Calidog (`certstream.calidog.io`) is a public WSS endpoint that has
had documented outages and the maintainer has flagged cost pressure on
the public service. Building Phase B without measuring its reliability
first invites the same kind of "first production load broke our cron"
incident that ADR-0011's continuous-verification gates were designed
to avoid.

## Decision

**Source layering, strictly phased.**

| Phase    | Sources                                                                                                                                                                                                                                                                  | Storage                                                                               | Package                                                                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A (#376) | Brand-keyword corpus search over `scam_reports` (`impersonated_brand` + FTS `body_tsv`) + `reddit_post_intel` (GIN-indexed `brands_impersonated`) + `feed_items` (`impersonated_brand`) — daily SQL UNION joined against Verified Shops. Pull-mode only, no new scraper. | `shopfront_clone_alerts` (v140 — ships with #373)                                     | `packages/shopfront-glue/`                                                                                                                                                                   |
| B        | Adds Calidog public certstream WSS as a sibling data source. Aho-Corasick + dnstwist permutations precomputed on a new `shopfront_shop_permutations` table                                                                                                               | SAME `shopfront_clone_alerts` table (NOT a parallel `clone_findings` table)           | `packages/shopfront-glue/` (extended)                                                                                                                                                        |
| C        | Adds whoisds NRD daily backstop. Self-hosted Hetzner certstream-server **only if** the Phase B Calidog stability spike fails OR an enterprise Layer 4 customer requires hard SLA                                                                                         | `shopfront_clone_alerts` + sibling `shopfront_clone_alerts_embeddings` (per ADR-0015) | A standalone `packages/domain-monitor/` is justified ONLY at this point — when Hetzner + NRD + Voyage embeddings make the surface independently complex enough for the deletion test to pass |

**Existing CT monitor stays as-is.**
`packages/scam-engine/src/inngest/ct-monitor.ts` is a different product
surface (AU govt / bank / telco brand impersonation, every 12h via
crt.sh, writing to `brand_impersonation_alerts`). Clone-detection
work MUST NOT replace, refactor, or merge with it. Future
discriminator-column work can be considered if Calidog hits genuinely
overlap both concerns; that is a future ADR, not Phase A/B/C scope.

**Brand-impersonation alerts table is extended, not supplanted.** Per
the discriminator-column principle above, if cross-concern overlap
emerges, the existing `brand_impersonation_alerts` table gets a
discriminator column (e.g. `surface TEXT NOT NULL CHECK (surface IN
('au_govt_finance_telco', 'shopfront_merchant'))`) rather than
spawning a third parallel table.

**Pre-Phase-B sub-task: 48-hour Calidog stability spike.** Before any
Phase B code commits, run a 48-hour measurement of the public Calidog
WSS endpoint — connection-uptime percentage, reconnect frequency,
certificate-event throughput, dropped-event symptoms. **Pass
threshold: ≥99% uptime over the window.** If Calidog passes, Phase B
proceeds with the public endpoint and Hetzner stays Phase C
conditional. If Calidog fails, Phase B inherits the Hetzner self-host
work originally scoped to Phase C — meaning Phase B's eng-week
estimate jumps from 1–2 weeks to 4–5 weeks and the Phase C gating on
enterprise customer demand becomes the gating on whether to ALSO add
NRD + Voyage on top of the Hetzner stack already shipped.

**Phase B also extracts lexical patterns from the broader scam corpus
to catch clones of unverified AU merchants.** Phase A's matcher only
fires on permutations of installed `shopfront_shops`. Phase B adds a
second matcher track: extract recurring lexical patterns from
`scam_reports` + `verified_scams` + `reddit_post_intel` (e.g. n-grams,
TLD-combo signatures, keyword-position patterns) into a new
`scam_lexical_patterns` table, score each pattern by
hits-in-confirmed-scam-corpus over hits-in-legitimate-corpus, and feed
patterns above a precision threshold into the same Aho-Corasick
matcher. Matches against these patterns land in `shopfront_clone_alerts`
with `target_shop_id = NULL` and `source = 'lexical_pattern'` — flagged
for human triage. The unverified-merchant matches are then the inbound
queue for the cold-outreach pipeline (Phase B+: when a `lexical_pattern`
match lands on a real AU store that isn't an installed Shopfront
merchant, that store becomes a sales lead — "we detected `fake-yourstore.shop`
being issued an SSL cert; here's the takedown template, here's how to
claim a Verified badge"). The outreach flow itself is a separate
issue (`[Shopfront S2.7]` — clone-detection cold-outreach pipeline)
gated on this lexical-pattern infrastructure shipping first.

`scam_lexical_patterns` precision-tuning + cold-outreach copy carry
their own defamation-exposure risk: a pattern hit is even further
from "this is a clone" than a permutation hit. The lawyer-vetted
language pack (#371) must already be in place before any
lexical-pattern match triggers outbound merchant comms.

## Consequences

- **No `clone_findings` table.** All clone detections — regardless of
  signal source — land in `shopfront_clone_alerts`. Schema migrations
  for Phase B and Phase C extend this table (or add the sibling
  embedding table), they do not parallel it.
- **No `packages/domain-monitor/` at Phase A or B.** All Phase A work
  lives in `packages/shopfront-glue/` per Shopfront plan §3.2. Phase B
  extends `shopfront-glue/`. A standalone `packages/domain-monitor/`
  is only justified at Phase C when Hetzner + NRD + Voyage make the
  surface independently complex enough that the deletion test
  (CLAUDE.md → "Always do" → "Apply the deletion test before adding
  any new wrapper module") finally passes. At Phase A or B, it would
  be a pass-through wrapper around `shopfront-glue/` and fail the
  test.
- **Calidog reliability risk is surfaced before build commits.** The
  48-hour stability spike is the first sub-task of Phase B. Failure
  triggers the Hetzner self-host work; success defers it. Either way,
  the cost surface is known before the merchant-facing alert SLA is
  promised.
- **Existing CT monitor is protected from accidental refactor.** The
  ADR explicitly names `packages/scam-engine/src/inngest/ct-monitor.ts`
  - its keyword list + its target table so future agents reading this
    ADR don't try to "consolidate" the two surfaces. They serve different
    consumer-vs-merchant product concerns.
- **Source overlap is modelled by discrimination, not duplication.** If
  a Calidog hit flags both a govt-impersonation domain AND a
  Shopfront-merchant clone, the discriminator column on the existing
  table is the right shape — not a third table.

## Alternatives considered

1. **Parallel `clone_findings` table for the Proactive Monitor
   surface.** Rejected — fragments the corpus, doubles the write path
   for Phase A's merchant dashboard query, and requires UNION queries
   across two tables to render a single merchant's alert list.
2. **Standalone `packages/domain-monitor/` from Phase A.** Rejected —
   fails the deletion test at Phase A scope. Phase A is corpus reads
   - Shopify Admin GraphQL reads; everything fits in `shopfront-glue/`.
3. **Skip Calidog, jump straight to Hetzner certstream-server at Phase
   B.** Rejected on cost grounds — Hetzner adds a hosting line item
   (~A$40–80/mo) before measuring whether Calidog's free public
   endpoint suffices for the design-partner cohort's volume. Phase B
   can always fall back to Hetzner via the 48-hour stability spike
   gate.
4. **Use crt.sh as the Phase B firehose, reusing the existing CT
   monitor's adapter.** Rejected — crt.sh is rate-limited and
   designed for batch keyword queries, not firehose subscription.
   Repurposing the existing CT monitor for Shopfront would also break
   the consumer-vs-merchant separation this ADR is explicit about
   preserving.

## Reversal trigger

If the Phase B 48-hour Calidog stability measurement returns <99%
uptime, Phase B inherits the Hetzner self-host work originally scoped
to Phase C. The Phase C gating on enterprise customer demand then
applies only to the NRD + Voyage additions, not to Hetzner.

If Calidog's maintainer announces a shutdown / paywall change for the
public endpoint at any point post-Phase-B, Phase B work re-targets
Hetzner immediately and a new ADR captures the operational ownership
of the self-hosted stream.

## Amendment 2026-05-24 — NRD pulled forward to Pre-Stage-1 MVP (Layer 0)

A pre-Stage-1 MVP layer ("Layer 0 — clone-watch") is added that runs
the whoisds NRD daily zip against a static AU brand watchlist
(~50 retail merchants). Layer 0 sits BEFORE Phase A's
installed-merchant scope and feeds the public `askarthur.au/clone-watch`
page. The full Layer 0 plan lives at
`docs/plans/clone-watch-mvp.md`.

**Justification.** The locked plan put Shield app surfaces (badge,
Directory, scanner gated to installed merchants) BEFORE the engine,
on the assumption merchants would install on the strength of the
Stage 0 outreach narrative. User-driven reality check 2026-05-24:
the Shield is a wrapper around evidence the engine produces, and
the outreach in #367 / #370 is vaporware without an operating
engine. Layer 0 costs A$0/mo marginal (whoisds free tier +
deterministic lexical matching + 1 daily Inngest fn within
free-tier headroom) and gives every Stage 0 outreach a live URL
to land on.

**What moves.** Only the whoisds NRD daily zip ingest moves from
Phase C to Layer 0.

**What stays in Phase C unchanged.** Voyage embeddings (the
"primary verdict for the logo-swap, copy-preserved attack class"
per ADR-0015), Hetzner certstream-server (conditional on Calidog
spike failure OR enterprise SLA), cross-merchant federated
clustering. All still gated on Layer 4 WTP signal from #368 +
privacy counsel opinion from #369.

**What stays in Phase B unchanged.** Calidog public certstream
WSS firehose, the 48h stability spike gate, the
`shopfront_shop_permutations` precomputed table for installed
merchants. Phase B is still gated on ≥10 paying Shield Pro
merchants.

**Where Layer 0 writes.** Same `shopfront_clone_alerts` table
(Decision #1 of the build chain unchanged) with `target_shop_id IS
NULL` + `inferred_target_domain` populated + `source = 'nrd'`. The
schema's existing CHECK constraint and `idx_clone_alerts_unverified`
partial index already support this branch — no schema change beyond
shipping v140 itself.

**Where Layer 0 code lives.** `packages/shopfront-glue/` — same as
Phase A. Deletion test still fails for `packages/domain-monitor/`
at Layer 0 scope. The Layer 0 lexical matcher is the foundation
that Phase A and Phase B both reuse; the deletion test for
`shopfront-glue/` passes from Layer 0 onward.

**Where the public page lives.** `apps/web/app/clone-watch/` (Next.js
App Router server component). Read-only, factual-signal-only,
indexable. v0 copy follows the principles in
`docs/policy/draft-disclaimer-pack-v0.md`; v1 copy replaces it when
#371 lawyer-vetted pack returns.

**Source-layering table after this amendment:**

| Phase       | Sources                                                                                             | Storage                                                                  | Package                                           |
| ----------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------- |
| **0 (MVP)** | whoisds NRD daily zip × static AU brand watchlist (~50 brands)                                      | `shopfront_clone_alerts` (target_shop_id IS NULL, source = 'nrd')        | `packages/shopfront-glue/`                        |
| A (#376)    | Brand-keyword corpus over `scam_reports` + `reddit_post_intel` + `feed_items` × installed merchants | `shopfront_clone_alerts` (target_shop_id IS NOT NULL, source = 'corpus') | `packages/shopfront-glue/`                        |
| B           | Calidog public certstream WSS + lexical-pattern matcher (precomputed permutations)                  | SAME `shopfront_clone_alerts` (NOT a parallel table)                     | `packages/shopfront-glue/` (extended)             |
| C           | Voyage embeddings + Hetzner (conditional) + cross-merchant federation                               | `shopfront_clone_alerts` + sibling `shopfront_clone_alerts_embeddings`   | `packages/domain-monitor/` (deletion test passes) |

**Reversal trigger for Layer 0.** If whoisds.com paywalls or
disables free NRD access, swap to an alternative free source
(ICANN CZDS per-TLD subscriptions, registry-specific public
lists). If no free source remains, Layer 0 degrades to "engine
only on internal corpus" (the existing #376 Phase A path) — the
public-evidence flywheel weakens but the merchant-installed path
is unaffected.

## Amendment 2026-05-29 — CT monitor keyword set now derives from the shared watchlist (still a distinct surface)

The CT monitor (`ct-monitor.ts`) previously hardcoded its own 9 keywords
(`mygov`, `centrelink`, `ato.gov`, `auspost`, `commbank`, `nab`, `westpac`,
`telstra`, `servicensw`) and its own legit-domain exclusion list. Those two
lists had drifted from the ~150-brand `au-brand-watchlist.ts` that clone-watch
Layer 0 uses, and the research finding that AU brand impersonation is highly
**concentrated** (super funds post-April-2025, Linkt, energy retailers,
Macquarie/Optus, Medibank/Bupa, Qantas) showed the fast CT signal was missing
most of the high-loss mid-tier.

The monitor now derives its keyword set **and** legit-domain exclusions from
the shared watchlist via `getCtMonitorConfig(includeExpanded)`
(`packages/shopfront-glue/`). A `core` tier reproduces the original 9 keywords
byte-for-byte; an `expanded` tier (the concentrated targets) fires only when
`FF_CT_MONITOR_EXPANDED` is ON.

**This does NOT violate the "CT monitor stays a distinct surface" decision
above.** The two surfaces are still discriminated, not merged: the CT monitor
keeps its own 12h cadence, its own retry budget, and still writes
`brand_impersonation_alerts` (consumer-extension feed), while clone-watch keeps
writing `shopfront_clone_alerts`. Only the **source-of-truth for which brands
to watch** is unified, so the keyword and legit-domain lists can no longer
drift apart. The tables, crons, and consumer surfaces remain separate per the
original Decision. A future discriminator-column merge (if Calidog hits ever
overlap both concerns) remains out of scope and a future ADR.

## Related

- `docs/plans/shopify-shopfront.md` §2 Layer 1 + §5 Stage 2 (a/b)
- `docs/plans/clone-watch-mvp.md` — Layer 0 / MVP plan (NEW 2026-05-24)
- ADR-0015 — clone-detection signal model (deterministic-first, embeddings primary at Phase C)
- ADR-0011 — continuous re-verification (the badge state machine clone-detection feeds)
- ADR-0012 — Threat Feed License enterprise SKU (the funding engine that gates Phase C)
- ADR-0014 — Verified Directory primacy (the consumer surface clone-detection feeds)
- Issue #376 — Phase A scanner (corpus-only)
- `packages/scam-engine/src/inngest/ct-monitor.ts` — the EXISTING CT monitor (AU govt / bank / telco, every 12h via crt.sh) that this ADR explicitly does NOT replace
- `brand_impersonation_alerts` table — the existing 9-row table the existing CT monitor writes to
- `supabase/migration-v140-shopfront-init.sql` — the migration that creates `shopfront_clone_alerts` (planned, not yet applied; ships in S0E.1)
- CLAUDE.md → "Always do" → deletion test for new wrapper modules
