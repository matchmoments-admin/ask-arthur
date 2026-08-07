---
name: software-architecture
description: Applies Fundamentals of Software Architecture (Richards & Ford) to Ask Arthur system decisions — prioritizing architecture characteristics, presenting trade-offs instead of one right answer, recording decisions as ADRs in docs/adr/, and governing with automated fitness functions (dependency-cruiser, CI gates, brakes). Use when designing a new surface or pipeline, choosing between structural options, documenting a significant decision, adding architectural governance, or when the user mentions trade-offs, ADRs, fitness functions, scalability, or coupling.
---

# Software Architecture (Ask Arthur)

System-level reasoning above individual modules. Where `clean-architecture`
governs seams inside the codebase, this skill governs _which_ structure to
choose, _why_, and how the choice stays honest over time.

## First law

"Everything in software architecture is a trade-off." Present realistic options
scored against the prioritized characteristics — never a single "best" answer
asserted without alternatives. (The `grilling` family of skills exists to
stress-test exactly these presentations.)

## This repo's standing characteristics

Rank per decision, but the platform's revealed priorities are stable:

1. **Cost-boundedness** — every paid path has a cap and a brake
   (`cost_telemetry`, `feature_brakes`, `*_CAP_USD`). A design without a brake
   is incomplete here, whatever its other merits.
2. **Operability** — observable (Axiom, cost tagging), watchdogged, chunked
   writes, defined failure modes. The 2026-05-09 and 2026-07-12 incidents made
   these load-bearing.
3. **Evolvability/testability** — deep modules at stable seams; ships dark
   behind default-OFF flags; activation beats construction (NORTH_STAR's build
   filter is the demand-side gate — check it before designing at all).

Classic "-ilities" (performance, availability, security, deployability) still
apply — state the driving top ~3 explicitly in any design discussion.

## Trade-off analysis

1. State the decision and its driving characteristics.
2. List realistic options (including "extend the existing brain" — the repo
   default per CLAUDE.md).
3. Pros/cons _in terms of those characteristics_, including cost cap and
   operational burden.
4. Note what each option does to seams and dependency direction
   (`clean-architecture`) and to data consistency (`data-intensive-design`).
5. Recommend; record per the ADR rules below if it qualifies.

## ADRs — defer to the house format

The format, numbering, and bar live in
`.claude/skills/grill-with-docs/ADR-FORMAT.md` — a title plus 1–3 sentences is
a complete ADR; optional Status/Considered-Options/Consequences only when they
earn their place. **Do not** use the long Nygard template from generic
guidance. Offer an ADR only when all three hold: hard to reverse, surprising
without context, a real trade-off. 23+ ADRs exist in `docs/adr/` — read the
ones touching your area before designing, and supersede rather than edit.

One addition this skill brings: when an ADR constrains structure (a dependency
direction, a sanctioned exception, a required pattern), state in the ADR how
it's verified — the fitness function, lint rule, or CI check that would catch a
violation. A constraint nobody can mechanically detect will drift.

## Fitness functions — automated governance

An objective, CI-run test of an architecture characteristic. Live examples in
this repo:

- **Dependency direction / framework-freedom**: `pnpm boundaries`
  (dependency-cruiser, `.dependency-cruiser.cjs`) — package graph rules with a
  warn→error ratchet (ADR-0024).
- **Interface discipline**: ESLint `no-restricted-imports` bans
  `@askarthur/*/src/*` deep imports and the `@ask-arthur/*` scope typo.
- **Cost**: brakes and caps enforced at runtime; `cost_telemetry` reviewed in
  ops rituals.
- **Schema/code skew**: the CI migration-number guard.

When you add an architectural rule, add its fitness function in the same PR —
convention without enforcement erodes silently. New graph rules with existing
violations start at `warn` with the violations recorded in
`docs/refactor-backlog.md`; the item that clears them flips the rule to
`error` in the same PR (the ratchet).

## Checklist

- [ ] NORTH_STAR build filter passed before designing anything new
- [ ] Top ~3 characteristics stated; options presented as trade-offs against them
- [ ] Cost cap/brake and failure mode included in the design, not bolted on
- [ ] ADR offered iff hard-to-reverse + surprising + real trade-off (house format)
- [ ] Structural rules got a fitness function in the same PR (or a warn-level ratchet entry)
- [ ] Simplest structure that meets the drivers — no speculative decomposition
