# Clone-detection signal model — deterministic-first, with embeddings primary at Phase C for the visually-divergent attack class

**Status:** accepted (2026-05-24)

Shopfront clone-detection layers signals in three taxonomic groups —
**deterministic-string** (Aho-Corasick + Levenshtein + confusables +
punycode), **deterministic-visual** (perceptual hash + TLSH), and
**embedding** (Voyage page-content similarity vs the verified merchant's
homepage). Per-phase application is strict: Phase A (issue #376) uses
deterministic-only signals; Phase B adds string deterministic-matchers
over a CT firehose; Phase C adds Voyage embeddings as the **primary
verdict** for the "logo-swap, copy-preserved" attack class.

## Context

A web-only Claude session on 2026-05-23 drafted an unreviewed
"Proactive Domain Monitor" plan that proposed shipping embeddings,
deterministic visual hashes, and certstream ingestion in a single
omnibus PR. Local-ultrareview returned 9 BLOCKER + 14 HIGH findings.
The signal-model concern in particular: the plan over-weighted
embeddings as a confidence-booster across the board, which is both
expensive (Voyage tokens per candidate × per merchant × daily) and
gives the wrong answer on the easy cases (most clones share enough
exact-string brand DNA — domain, product titles, JSON-LD structured
data — that a deterministic matcher classifies them confidently in
milliseconds).

The right framing came out of the user's nuance during the rework:
deterministic signals catch roughly the easy 70% of clones — domain
permutations, copied product copy, logo pHash collisions. The harder
30% is the "scammer swapped the logo (so pHash misses) but kept all
the product copy and page structure (so the verbatim-text match
misses too)". For that attack class, embedding the candidate page's
content and computing cosine similarity against the verified
merchant's homepage embedding **is** the primary verdict, not a
confidence-booster on top of deterministic signals.

Plan inputs:

- `docs/plans/shopify-shopfront.md` Decision #2 — clone-detection-with-takedown-commitment is the merchant install hook.
- Decision #11 + ADR-0012 — the Layer 4 Ask Arthur Network — Threat Feed License enterprise SKU funds the free tier; advanced detection capability lives here, not in the Shopify merchant tier.
- ADR-0014 — the Verified Directory at `askarthur.au/verified` is the primary moat; clone-detection feeds the Directory's "this domain is impersonating a verified merchant" surface.
- CLAUDE.md Critical Rules — never put a large index on a write-frequent table; embedding columns go on 1:1 sibling tables (the `acnc_charity_embeddings` precedent + the `verified_scams`/`scam_reports` split in v87–v89).
- ADR-0003 + ADR-0004 — every embedding column ships with `<col>_embedding_model_version TEXT` so re-embed sweeps can detect stale vectors.
- ADR-0005 — HNSW is the default pgvector index for read-heavy similarity surfaces; build cost is real but amortises.

## Decision

**Signal taxonomy + per-phase application.**

| Group                | Signals                                                                                                                | Phase A (#376)                                  | Phase B                                                                                                   | Phase C                                                                                                                                                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deterministic-string | Aho-Corasick over brand-name corpus, Levenshtein over domain permutations, Unicode confusables, punycode normalisation | TLD watchlist matching + JSON-LD product clone  | Adds Aho-Corasick + Levenshtein over a Calidog CT firehose with `shopfront_shop_permutations` precomputed | (inherited from Phase B)                                                                                                                                                                                                                            |
| Deterministic-visual | Perceptual hash (pHash) over logos / hero images, TLSH over rendered HTML                                              | Logo pHash + Shopify theme fingerprint per #376 | (inherited from Phase A)                                                                                  | (inherited)                                                                                                                                                                                                                                         |
| Embedding            | Voyage `voyage-3` page-content embedding cosine similarity vs the verified merchant's homepage embedding               | NOT USED                                        | NOT USED                                                                                                  | **Primary verdict for the "logo-swap, copy-preserved" attack class.** Catches the harder ~30% where deterministic-visual misses (new logo) AND deterministic-string misses (rephrased copy) but the page semantically mirrors the verified merchant |

**The Phase C embedding nuance is load-bearing.** Embeddings are not a
universal confidence-booster bolted on top of deterministic signals.
They are the _primary_ signal for the specific attack class where
deterministic signals are structurally blind. For the easy 70%, the
deterministic signals are cheaper, faster, and more confident — adding
an embedding cosine similarity check on top is expensive overhead that
doesn't change the verdict. For the hard 30%, the deterministic signals
score near-zero and the embedding similarity is the only signal that
correctly classifies. The Phase C scanner must therefore branch on
"deterministic verdict ≥ threshold → ship, skip embedding" vs
"deterministic verdict < threshold → run embedding check, treat as
primary verdict".

**Embedding column placement is non-negotiable.** Per CLAUDE.md
Critical Rules + ADR-0005, the Voyage embedding column lives on a 1:1
sibling table — `shopfront_clone_alerts_embeddings` — with HNSW on the
read-only sibling side. `shopfront_clone_alerts` itself stays lean and
write-frequent (daily cron, on-trigger downgrades). The sibling pattern
is the `acnc_charity_embeddings` precedent from BACKLOG.md → Charity
Legitimacy Check.

**Embedding model version stamp is mandatory.** Per ADR-0003 + ADR-0004,
the sibling table ships with a `<col>_embedding_model_version TEXT`
column populated atomically on every row. Re-embed sweeps detect stale
vectors via `WHERE embedding_model_version != <current>`.

## Consequences

- **Phase A build cost stays small** — deterministic signals only, no
  Voyage API line item, no HNSW index, no sibling table. Lives entirely
  in `packages/shopfront-glue/` per ADR-0016.
- **Phase B costs scale with CT firehose volume × brand-name corpus
  size** — Aho-Corasick over a Calidog stream at ~5K certs/sec is CPU
  cheap once the corpus is compiled but the matcher needs daily corpus
  refresh as new merchants install. NO Voyage cost yet.
- **Phase C is where Voyage cost enters the picture.** Embedding cost
  is bounded by: (a) only candidates that the deterministic layer
  scored below the ship-threshold get embedded, (b) per-merchant
  homepage embedding is computed once and cached until the verified
  merchant's homepage materially changes, (c) the `feature_brakes`
  pattern caps daily spend. Tagged via `logCost({ feature:
'shopfront_clone_embed', provider: 'voyage', ... })`.
- **The "we ranked X higher because their pHash collided" failure mode
  is avoided** — deterministic-string + deterministic-visual signals
  combined produce a severity score; embeddings only adjudicate the
  Phase C hard cases. The scoring function does not blend embedding
  similarity into the easy-case score, because doing so would hide
  signal disagreement.
- **Eng cost order-of-magnitude:** Phase A ~2 eng-weeks (per #376),
  Phase B ~1–2 eng-weeks add (Calidog WSS + Aho-Corasick + corpus
  refresh job), Phase C ~3–4 eng-weeks add (Voyage adapter + sibling
  table + HNSW + reindex policy + cost-telemetry surface). The phasing
  matches the funding-engine gates in ADR-0012.

## Alternatives considered

1. **Embeddings everywhere from Phase A.** Rejected — the Voyage cost
   for daily embedding of every candidate domain across every installed
   merchant blows the `feature_brakes.shopfront_clone_scan` A$15/day cap
   before useful signal arrives. Also delivers worse precision on the
   easy 70% than the deterministic matchers.
2. **Embeddings as a uniform confidence-booster on top of deterministic
   signals.** Rejected — this is what the unreviewed Proactive Monitor
   draft proposed. Hides signal disagreement (the cases where
   deterministic says clone, embedding says no — usually the
   deterministic signal is correct and the merchant's homepage simply
   doesn't embed well due to thin copy). Wastes Voyage tokens on the
   easy cases.
3. **Embeddings only, skip deterministic.** Rejected — the easy 70% is
   correctly classified by deterministic signals at sub-millisecond
   per-candidate latency. Throwing those signals out and embedding
   everything is both more expensive and gives worse latency at the
   merchant-dashboard surface.
4. **TLSH-only for the visual layer, skip pHash.** Considered. TLSH is
   stronger on rendered-HTML similarity but weaker on isolated
   image-asset comparison. Phase A keeps pHash for logo / hero-image
   comparison; Phase C may add TLSH over rendered HTML alongside the
   embedding check.

## Reversal trigger

If Phase B's Aho-Corasick + Levenshtein over Calidog produces enough
high-confidence verdicts to drive merchant value WITHOUT the Phase C
embedding layer ever needing to ship (i.e. the "logo-swap,
copy-preserved" attack class is rare enough in real Shopfront merchant
data that the embedding layer's ROI is negative), Phase C is deferred
indefinitely. The reversal is the Layer-4 enterprise SKU shipping
without embeddings as a capability, which only makes sense if the
hard-case attack class is empirically absent.

Conversely, if Phase A's deterministic-only output produces a
significant false-negative rate on the "logo-swap, copy-preserved"
attack class within the first 90 days of design-partner cohort
operation, Phase C is pulled forward and the Phase B gating is
relaxed.

## Related

- `docs/plans/shopify-shopfront.md` §2 Layer 1 (Phase A) + §5 Stage 2 (Phase B/C)
- ADR-0016 — clone-detection source layering (corpus vs CT firehose vs NRD)
- ADR-0003 — embedding model versioning convention
- ADR-0004 — multi-domain embedding model selection
- ADR-0005 — pgvector HNSW vs IVFFlat policy
- ADR-0011 — continuous re-verification (the badge state machine clone-detection feeds)
- ADR-0012 — Threat Feed License enterprise SKU (the funding engine for Phase C)
- ADR-0014 — Verified Directory primacy (the consumer surface clone-detection feeds)
- Issue #376 — Phase A scanner (deterministic-only)
- CLAUDE.md Critical Rules — sibling-table pattern for embedding columns on write-frequent tables
