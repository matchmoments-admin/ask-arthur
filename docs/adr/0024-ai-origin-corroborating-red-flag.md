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
  watermark, SynthID-Text, etc.) — key-gated schemes with no public
  detector; any locally-computed result would be fabricated. Revisit only if
  a vendor ships a public detection API with published FPR and minimum-length
  bounds — then integrate as ONE probabilistic signal with "processed by, not
  authored by" copy (Tier-2 items tracked in BACKLOG).
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
