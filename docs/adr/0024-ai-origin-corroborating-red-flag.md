# AI Origin is a corroborating red flag, never a verdict

**Status:** accepted (2026-08-20)

## Decision

The **AI Origin** ladder (CONTEXT.md: `signed` — validated C2PA manifest /
`claimed` — forgeable XMP/EXIF tag / `none` — nothing found) is surfaced as
**information and, in exactly two situations, a non-escalating red-flag
line** — never as an "AI / not AI" verdict, never as a numeric weight in any
score, and never as an input to `mergeVerdict`'s escalation ladder.

The two flagging situations (`collectImageOriginRedFlags`,
`packages/scam-engine/src/image-origin-flags.ts`, gated
`FF_IMAGE_ORIGIN_RED_FLAGS`):

1. **Claimed-but-uncredentialed** — metadata claims AI origin
   (`DigitalSourceType=trainedAlgorithmicMedia` or a known generator in
   CreatorTool/Software) and no C2PA manifest backs the image.
2. **Tampered provenance** — a C2PA manifest is present but its signature
   fails validation (altered since signing). The copy blames the provenance
   record, never calls the image "fake".

Everything else is a no-op: **absence of provenance produces nothing** (most
platforms strip metadata on upload — absence is not evidence), and a
validly-signed AI image is transparent, properly-credentialed content —
deliberately not a flag.

### The asymmetry rule (load-bearing)

A detected mark means the content was **processed by** the named tool — not
authored by it, and not "fake". Absence of a mark means **nothing** — not
"human-made", not "no AI". Every user-facing string flows through
`IMAGE_CHECK_ORIGIN_COPY` (`packages/types/src/image-check-copy.ts`) and is
guarded by `apps/web/__tests__/imageCheckOriginCopy.test.ts`, which fails the
build if none-tier copy contains "human" / "no AI" / "not AI", or if
invalid-signature copy says "fake".

### Why red-flag-only (precedents)

- `mergeVerdict` already encodes this shape for Hive's `isAiGenerated`: "AI
  imagery is a red flag but does not by itself escalate the verdict (a
  legitimate artist may post AI images)" — AI Origin follows that precedent
  exactly.
- ADR-0015's doctrine: corroboration is exposed as separate named
  signals/columns and never folded into a deterministic score — "an operator
  always sees the disagreement". A provenance "weight ±small" (the shape the
  original external plan proposed) would hide disagreement inside a
  composite.
- The signal is weak on both sides: C2PA/metadata survive almost no social
  upload path (stripped in 5 of 6 platforms tested externally), and tags are
  trivially forgeable. A weak, strippable, forgeable signal cannot carry
  verdict weight.

## Won't do (recorded so future reviews don't re-suggest them)

- **Homegrown statistical text-watermark detection** (Claude's token
  watermark, SynthID-Text, etc.) — cannot meet the honest-verdict bar, for
  three reasons (revised 2026-08-21, see Amendment): (i) key-read
  _attribution_ ("this was Claude") requires the vendor's secret key, which
  is not published; (ii) presence-only statistical detection IS possible
  without the key (black-box detection + parameter estimation, ICLR 2025;
  ~$50 watermark stealing, ICML 2024) but is low-precision, unattributable
  to a specific vendor, and collapses under paraphrase (watermark TPR@1%FPR
  measured falling 99.8%→9.7% under recursive paraphrase), translation, and
  short/low-entropy text; (iii) a genuine positive means "processed by, not
  authored by" — Anthropic's own stated caveat. NOTE the prohibition covers
  statistical/key-inference detection only — deterministic character
  inspection (invisible-Unicode / bidi-control scanning, which is a
  manipulation signal, not AI detection) sits outside it. The vendor-API
  path is a Tier-2 BACKLOG item with a four-condition trigger (callable +
  published FPR/min-length + resale-permissive ToS + viable pricing).
- **An education / homework AI-detector product** — documented ESL bias
  (61% FPR on non-native essays in the Stanford study), minors' privacy
  exposure, TEQSA steers to assessment redesign, and accusation tooling is
  brand-damaging for a consumer-protection service.
- **Selling raw C2PA lookup** — `contentcredentials.org/verify` is free; the
  platform's value is fusion with scam intelligence, not the lookup.
- **Stable Diffusion `invisible-watermark` decode** — Python-only, disabled
  in most self-hosted forks, near-zero real-world yield.
- **A parallel `packages/ai-provenance` module / `/verify` route** — the
  capability lives inside the Image Check Module's existing seams
  (c2pa-detect / c2pa-verify / metadata-origin in scam-engine); "provenance"
  as a route/feature name is reserved by the Verified Directory (ADR-0014).

## Consequences

- New image surfaces that want provenance corroboration call
  `collectImageOriginRedFlags` (or render the ladder directly from
  `IMAGE_CHECK_ORIGIN_COPY`) — they do not invent new strings or weights.
  Currently wired: `analyze-ad` (flagged ads only, so clean-ad latency is
  unchanged). The web/extension image-check surfaces render the full ladder
  informationally.
- If a future case genuinely needs provenance to move a Verdict (e.g. a
  regulator-mandated treatment of signed content), that is a revision of
  THIS ADR, not a weight tweak.
- Tier-2 vendor detection APIs (Anthropic text detection, SynthID, OpenAI
  verify, ElevenLabs) plug in as additional `claimed`/`signed`-tier sources
  behind their own flags with `logCost()`, subject to the same asymmetry
  copy rules.

## Amendment — 2026-08-21: corrected rationale for the text-watermark won't-do

An external stress-test (2026-08-21) showed the original wording of the
text-watermark bullet — "key-gated schemes … any locally-computed result
would be fabricated", and the companion claim that reverse-engineering is
"effectively infeasible" — was technically false. Peer-reviewed work
demonstrates that a watermark's _presence and scheme parameters_ are
detectable from cheap black-box queries without the secret key (Gloaguen
et al., "Black-Box Detection of Language Model Watermarks", ICLR 2025), and
that schemes can be approximately reverse-engineered well enough to spoof
and scrub for under ~$50 (Jovanović et al., "Watermark Stealing in Large
Language Models", ICML 2024).

**The decision is unchanged.** What those results enable is attacks and
uncalibrated presence tests — not an honest, low-false-positive,
vendor-attributable authorship detector, which is the only thing a
consumer-protection verdict could ship. The bullet above now states the
accurate three-part basis (attribution-requires-key; presence-only is
unattributable/fragile; processed-by ≠ authored-by). Two consequences of
the correction:

1. Deterministic character inspection (zero-width/tag-block/bidi scanning)
   is NOT covered by the prohibition — it is an honest manipulation signal
   and lives in the injection detector, never labelled "AI detection".
2. The Tier-2 vendor trigger tightened (BACKLOG): callable endpoint AND
   published FPR (≤1%) with stated minimum input length AND ToS permitting
   third-party commercial resale of results AND viable pricing — reassessed
   quarterly. The resale-ToS condition is the expected blocker: a public
   detection endpoint doubles as an evasion oracle, so vendors have reason
   to restrict it. The EU AI Act Art. 50 interoperability mandate
   (2 Feb 2027) is the structural forcing function to watch.
