# Ask Arthur

Domain glossary for the Ask Arthur scam-detection platform. Used by the `improve-codebase-architecture` and `grill-with-docs` skills to ground suggestions in the project's language.

This file is **opinionated and tight**. When two words exist for the same concept, pick one and list the others as aliases to avoid. When a new term emerges in conversation that belongs in this glossary, add it inline — don't batch.

## Language

**Verdict**:
One of `SAFE | UNCERTAIN | SUSPICIOUS | HIGH_RISK` — the safety classification we return for any submitted content.
_Avoid_: result, classification, score, rating.
_Storage quirk:_ `scam_reports.verdict` allows only the three legacy values (`SAFE`, `SUSPICIOUS`, `HIGH_RISK`) — the column predates `UNCERTAIN`. New tables (`charity_checks`, planned `shop_checks`) carry the full four. Cross-table linkage from a 4-value verdict back to a Scam Report only fires for the three legacy values; widening the column is a separate cross-table migration touching every read/write site of `scam_reports.verdict`, deliberately deferred.

**Analysis Result**:
Complete output from the Claude analyzer: a Verdict plus confidence, red flags, and optional Phone Lookup Result / Redirect Chain enrichment.
_Avoid_: response, output, analysis (bare).

**Phone Lookup Result**:
Phone-number enrichment: carrier, VOIP status, risk score, caller name. Produced by the Twilio Lookup adapter, joined into an Analysis Result when the input contains a phone number.
_Avoid_: phone info, lookup, phone metadata.

**Redirect Chain**:
URL redirect trace: hop count, shortener detection, open-redirect flags. Joined into an Analysis Result when the input contains a URL.
_Avoid_: URL trace, hop trace.

**Scam Report**:
A user-submitted suspicious item plus its Verdict, channel of origin, impersonated brand (if any), and Scam Cluster linkage. The unit of record in `scam_reports`.
_Avoid_: submission, ticket, case, incident.

**Scam Entity**:
A phone, email, URL, domain, or IP extracted from a Scam Report. Carries first-seen/last-seen timeline and a risk score that updates as new Scam Reports reference it.
_Naming note:_ the `/api/scam-contacts/*` routes + the `scamContactReporting` feature flag are the legacy surface name for the phone/email subset of Scam Entities (public reporting + reputation lookup) — "contact" here is not a separate concept; it's a Scam Entity. (The routes/flag keep the legacy name; no code rename — see migration v170 which re-wired them onto the unified `scam_entities` model via `report_scam_entity`.)
_Avoid_: indicator, IOC, observable, artifact.

**Scam Cluster**:
A group of Scam Reports linked by shared Scam Entities, text similarity, or a common impersonated brand. Tracks aggregate member count and total reported loss.
_Avoid_: group, campaign, ring.

**Unified Scan Result**:
Output of a security audit (websites / Chrome extensions / MCP servers / AI skills): a letter grade `A+ → F` plus per-check severity. Distinct from a Verdict — Verdicts classify content; Unified Scan Results audit installable software.
_Avoid_: audit, scan, scan output.

**Pillar**:
A single external-source contribution to a multi-pillar verification result, exposed as `{ id, score, confidence, available, reason?, detail? }`. Score is `0..100` where higher = more risk (matches the Phone Footprint convention). When `available: false` the scorer redistributes the pillar's weight pro-rata across the available pillars — this is the "graceful degradation" rule that lets a verdict render meaningfully when one upstream is down. Used by Phone Footprint and Charity Check; see ADR-0002 for the shared shape.
_Avoid_: provider, signal, source, factor.

**Charity Check Result**:
Output of the `/charity-check` engine: a Verdict (canonical 4-level), a 0-100 composite score, the per-Pillar payloads (`acnc_registration`, `abr_dgr`, plus `donation_url` reserved for v0.2), a coverage map for UI hints, the official donation URL pulled from the ACNC register (so the verdict CTA never deep-links a fundraiser-supplied URL), and a plain-English explanation. Distinct from an Analysis Result — Analysis Results classify arbitrary user-submitted content; Charity Check Results verify a specific named-entity claim against authoritative registers.
_Avoid_: charity result, charity score, charity verdict, "case".

**Shop Signal**:
A small optional payload attached to an **Analysis Result** when the input looks commerce-shaped (URL with shopping TLD / cart-or-checkout path / Shopify-style platform hint, OR text with commerce verbs). Carries `{ isCommerce: true, commerceFlags: string[], generatedAt }` — `commerceFlags` is a deduplicated set of normalised tags (`payid-scam`, `relative-will-collect`, `fake-payment-confirmation`, etc.) extracted from the analyser's existing red-flag list. Stage 0 ships free-only and never writes back to `scam_reports`. Stage 1+ extends the payload with optional `domainAge`, `abnPresence`, `paidProviderVerdict` (APIVoid). See `docs/plans/shop-guard-v2.md`. Distinct from a **Pillar**-typed result — Shop Signal is a single field on Analysis Result, not its own multi-pillar engine.
_Avoid_: shop result, shop verdict, "Shop Guard pillar" (it isn't one — Shop Guard is the user-facing capability name; the engineering Module is `shop-signal`).

**ABN Status** (Deep Shop Check):
The outcome of verifying an Australian Business Number displayed on a shop page — `ShopCheckAbn.status`, produced by `verifyShopAbn`. Six values, and the distinction between three of them is load-bearing: `verified` (ABN on the ABR register, holder name matches the shop), `name-mismatch` (registered, but the holder name doesn't match), `unregistered` (an ABN is displayed but the ABR register has no active record — a real scam signal, +30), `no-abn` (an `.au` shop displays no ABN at all), `unverified` (the check could not run — the page was unreadable, or the ABR lookup itself failed — a neutral non-signal, +6, **never** an accusation), `not-applicable` (non-AU host, no ABN expected). Treating a failed _lookup_ as `unregistered` was the F-A bug (GitHub #349, ADR 0009); `unverified` exists precisely so a transient ABR outage is not reported as a fake ABN. The same `unregistered`-vs-`lookup-failed` distinction lives one layer down in `lookupABN`'s discriminated `AbnLookupFailure.reason`.
_Avoid_: conflating `unverified` with `unregistered` — "we could not check" is not "we checked and it is fake".

**Referrer Source**:
The in-app browser the user arrived from when redirected via the Web Share Target route. A finite enum: `instagram-inapp`, `tiktok-inapp`, `facebook-inapp`, `whatsapp-inapp`. Detected server-side in `apps/web/app/share-target/route.ts` via UA fingerprint + Referer header. Optional — only set when the request originated from a share-sheet redirect; absent on direct visits. Used by **Shop Signal** Stage 0 (`shopSignal.referrerSource`) as the mobile-share axis in measurement Q3, and reusable by future Pillars (Phone Footprint mobile-share rollout).
_Avoid_: "share source", "inapp browser tag", "UA tag".

**Editorial Briefing layout**:
The shared chrome for Ask Arthur outbound emails (Reddit Intel weekly digest + the 6-step SPF nurture series). Defined in `apps/web/emails/_layout/EditorialBriefingLayout.tsx`: navy header bar with the Ask Arthur wordmark + an uppercase right-aligned label pill, a white content card on a tinted page background with rounded corners, and a navy footer bar with brand block, ABN, signed-token unsubscribe link, and an optional operator-only debug stripe. Per-email content slots into briefing fields (eyebrow, H1, dek, optional stats card, sections, CTA, sign-off) so all Ask Arthur emails read as one publication.
_Avoid_: "email template" (overloaded), "newsletter shell", "briefing chrome".

**Verified Shop**:
A merchant store that installed `apps/shopfront-shopify` and passed the continuous-verification pipeline (ADR-0011 badge state machine). Stored in `shopfront_shops` + `shopfront_verifications`. The unit of record for the merchant-side of clone-detection — Clone Signals are computed _for_ a Verified Shop. The Verified Directory at `askarthur.au/verified/{shop-handle}` publishes the per-shop provenance page (ADR-0014). Contrast with the cold-outreach target (a Clone Alert with `target_shop_id IS NULL`): an AU store that the matcher landed on but isn't an installed Verified Shop yet.
_Avoid_: "installed shop" (overloaded — Shopify's own term), bare "merchant" (overloaded — refers to any Shopify-side or matcher-detected entity).

**Brand Match** (Clone Signal — deterministic-string):
A candidate domain _appears to be_ a permutation / typo / confusable / punycode rendering of a Verified Shop's brand. One of three Clone Signal types alongside **Visual Match** and **Semantic Match**. Phase A scans against the existing scam corpus (`scam_reports.url` + `reddit_post_intel.url` + brand-mention scrape output); Phase B adds the Calidog certstream firehose; Phase C adds the whoisds NRD daily zip. Signal name is invariant across phases; only the candidate-domain population changes.
_Avoid_: "TLD watchlist match" (misleading — implies new-registration awareness that only Phases B+C deliver), "permutation hit".

**Scam-context token** (Brand Match sub-concept):
A short keyword (`bank`, `login`, `shop`, `pay`, `au`, etc.) whose presence in a candidate domain's brand-stripped residue is required for a Layer 0 **substring** Brand Match to fire. Gates only the substring signal type; **confusable** and **Levenshtein** signals are ungated (different threat shapes). List lives in `SCAM_CONTEXT_TOKENS` in `packages/shopfront-glue/src/lexical-match.ts`. Two-character ccTLDs (`.com.au`, `.co.uk`) are dropped from the residue before checking so `au` / `uk` don't leak universally from the TLD. The bare-brand-on-wrong-TLD exception (e.g. `westpac.com`) fires without context. Per ADR-0017.
_Avoid_: "context word" (overloaded), "scam keyword" (clashes with the analyser's red-flag vocabulary).

**Visual Match** (Clone Signal — deterministic-visual):
A candidate page's rendered assets collide with a Verified Shop's — same logo (pHash on logo / hero images), same Shopify theme fingerprint, or same rendered-HTML structure (TLSH; Phase C optional). Live at Phase A onward.
_Avoid_: "logo hit", "pHash collision".

**Semantic Match** (Clone Signal — embedding):
A candidate page's content reads like a Verified Shop's homepage — quantified by Voyage `voyage-3` page-content embedding cosine similarity above threshold. **Primary verdict for the "logo-swap, copy-preserved" attack class** per ADR-0015 — only fires for candidates whose deterministic verdict (Brand Match + Visual Match) scored below ship-threshold, NOT a uniform confidence-booster across the board. Phase C only. Per CLAUDE.md Critical Rules + ADR-0005, the embedding column lives on the `shopfront_clone_alerts_embeddings` sibling table with HNSW on the read-only side; the parent `shopfront_clone_alerts` row stays lean and write-frequent (the `acnc_charity_embeddings` precedent).
_Avoid_: "embedding match" (overloaded — embeddings are also used for Reddit Intel narrative clustering and the Verified Directory semantic-search bar), "cosine hit".

**Clone Alert**:
The composite unit of record in `shopfront_clone_alerts`. One row per (Verified Shop, candidate domain) pair where at least one Clone Signal fired above threshold. Carries a severity score combining the firing signals, a JSONB array of per-signal evidence, and a `source` discriminator. The `source` enum (locked v140): `'corpus'` (Phase A — installed-merchant corpus match), `'certstream_calidog'` + `'lexical_pattern'` (Phase B — CT firehose + pattern-matcher), `'nrd'` (Layer 0 + Phase C — whoisds daily zip), `'hetzner_certstream'` (Phase C conditional). A Clone Alert with `target_shop_id IS NULL` represents a hit on an AU shop that isn't a Verified Shop yet — the inbound queue for the cold-outreach pipeline (#385) AND the rows that render on the public `/clone-watch` page. Distinct from the existing `brand_impersonation_alerts` table (AU govt / bank / telco surface via crt.sh, per ADR-0016 — kept separate; cross-overlap modelled via a discriminator column rather than a third parallel table).
_Avoid_: "clone hit", "clone finding" (the rejected parallel-table name from the Proactive Monitor draft), bare "match" (reserve for the signal types).

**Layer 0 / Clone-watch**:
The pre-Stage-1 MVP layer pulled forward from ADR-0016 Phase C in the 2026-05-24 amendment. Runs the whoisds NRD daily zip against the static `AU_BRAND_WATCHLIST` (~50 retail/bank/telco/post brands) at 08:30 UTC. Writes hits into `shopfront_clone_alerts` with `target_shop_id IS NULL`, `source = 'nrd'`, `severity_tier = 'low'` (matcher caps score < 0.95 → severity ≤ 38). Surfaces on the public `askarthur.au/clone-watch` page (`noindex` for the first 7 days while #371 v1 copy is pending). Plan: `docs/plans/clone-watch-mvp.md`. Lives in `packages/shopfront-glue/` (same package as Phase A/B; deletion test passes from Layer 0 onward).
_Avoid_: "Stage 0E" (the issue-ticket stage label, not user-facing), "NRD sweep" without the "Layer 0" framing (loses the source-layering context).

**AU Brand Watchlist**:
The static `BrandEntry[]` array at `packages/shopfront-glue/src/au-brand-watchlist.ts` — ~50 Australian retail, bank, telco, and logistics brand names + their `legitimate_domains` exclusion lists. Per-entry: `{ brand: string, legitimate_domains: string[] }`. Used by Layer 0 (`lexicalMatch()` runs every newly-registered domain against the full list) and reused by Phase A (unioned with installed `shopfront_shops` brand names) and Phase B (corpus-mining adds dynamic patterns to the same matcher). The file IS the seam — opt-out and lawyer-vetting happen by editing this file, not by adding a feature flag.

## Relationships

- An **Analysis Result** produces exactly one **Verdict**.
- An **Analysis Result** may carry zero or one **Phone Lookup Result** and zero or one **Redirect Chain**, depending on what the input contained.
- A **Scam Report** has exactly one **Verdict** and references zero or more **Scam Entities**.
- A **Scam Entity** appears in one or more **Scam Reports**; its risk score is a function of how many.
- A **Scam Cluster** groups two or more **Scam Reports** by overlapping **Scam Entities** or matching impersonated brand.
- A **Unified Scan Result** is independent of the Scam Report graph — different domain, same platform.
- A **Charity Check Result** is independent of the Scam Report graph — it carries a Verdict but doesn't itself become a Scam Report unless the user separately submits the underlying claim. Its pillars are not Scam Entities; they're external-register lookups.
- A **Pillar** belongs to exactly one multi-pillar result type (Phone Footprint or Charity Check). The id namespace is per-feature; pillar ids are not globally unique.
- A **Shop Signal** rides on an Analysis Result as an optional field — it is not its own result type and does not produce a separate Verdict. The Analysis Result's Verdict already incorporates whatever the analyser saw; Shop Signal exposes the commerce-shaped subset of that signal for surface-specific rendering.
- A **Brand Match**, **Visual Match**, or **Semantic Match** is a Clone Signal — one of three inputs that feed a Clone Alert.
- A **Clone Alert** is a composite — one alert may carry multiple Clone Signals (the JSONB evidence array records which signals fired, at what score, and from which population).
- A **Clone Alert** belongs to exactly one **Verified Shop** via `target_shop_id`, OR has `target_shop_id IS NULL` when the matcher landed on an AU shop that isn't a Verified Shop yet (the Phase B+ lexical-pattern surface — feeds #385 cold-outreach).
- A **Verified Shop** has continuous-verification state in `shopfront_verifications` (ADR-0011) and a public provenance page at `askarthur.au/verified/{shop-handle}` (ADR-0014).

## Example dialogue

> **Dev:** "When the analyzer flags a phone number as `HIGH_RISK`, do we automatically create a Scam Report?"
> **Domain expert:** "No — the Analysis Result is per-request. A Scam Report is created when the user explicitly submits the content for the corpus. The Verdict on the Analysis Result and the Verdict on the Scam Report can differ if the analyzer was re-run later."

> **Dev:** "If two Scam Reports both reference `+61400000000`, are they automatically in the same Scam Cluster?"
> **Domain expert:** "They share a Scam Entity, which is one of the cluster signals — but the cluster also weighs text similarity and brand. Sharing one entity is necessary, not sufficient."

## Flagged ambiguities

- **"case"** is used informally to mean both **Scam Report** (the user-submitted item) and a Breach Defence case (a separate Phase-1 commercial concept tracked in `BACKLOG.md → Database Hygiene & SPF Readiness`). Keep distinct: prefer **Scam Report** for the consumer-flow item; reserve "case" for Breach Defence work, and define it precisely if/when that surface ships.
- **"alert"** is still overloaded across the platform: brand alerts (the existing `brand_impersonation_alerts` table — AU govt/bank/telco surface), cost-telemetry alerts (Telegram digests), and oncall alerts (none yet) all live alongside the now-defined **Clone Alert** (clone-detection composite, in `shopfront_clone_alerts`). When the bare word "alert" appears in code or docs, prefer one of the specific terms.
- **"campaign"** is overloaded: marketing campaigns (the `docs/campaigns/` folder) and scam campaigns (a near-synonym for **Scam Cluster** with an impersonated-brand axis). Prefer **Scam Cluster** for the scam-side meaning.
