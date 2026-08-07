---
name: pragmatic-programmer
description: Applies The Pragmatic Programmer (Hunt & Thomas) meta-principles to Ask Arthur work — DRY as single-source-of-knowledge, orthogonality/decoupling, tracer bullets, "no broken windows," fail-fast contracts, and automation. Use for design decisions, when evaluating coupling or duplication, planning an end-to-end slice, deciding what to automate, or when the user mentions DRY, coupling, technical debt, tracer bullets, or pragmatic trade-offs.
---

# Pragmatic Programmer (Ask Arthur)

Meta-principles above any single file. Where `clean-code` governs lines and
`clean-architecture` governs modules and seams, this skill supplies judgment.

## DRY — single source of knowledge

"Every piece of **knowledge** must have a single, unambiguous, authoritative
representation." DRY is about knowledge, not text — two similar-looking
snippets that change for _different reasons_ are not duplication; two
different-looking pieces encoding the _same rule_ are.

- This repo's standing rule is the same idea: before adding a parallel module,
  check whether an existing routing brain / RPC / view / event store already
  does the job and **extend it** (the `get_onward_destinations` RPC is the
  canonical example; the F3 weaponisation-risk scorer is "the ONE formula").
- National destination constants, tier limits, flag names: reference the
  existing declaration (`destinations.ts`, `TIER_LIMITS`, `readBoolEnv`),
  never re-declare.
- Don't over-DRY: two adapters at a real seam (the `format-*.ts` family) look
  similar _by design_ — merging them couples what must vary independently.
  When unsure, wait for the Rule of Three (see `refactoring`).

## Orthogonality (decoupling)

Changing one thing shouldn't ripple. Ask: "if the requirement behind this
module changes, how many packages are affected?" The answer should be ~1.

- Write shy code: talk to a module's interface, don't reach through it
  (`order.getCustomer().getAddress().zip` is a train wreck — in LANGUAGE.md
  terms, you're bypassing the seam and coupling to the implementation).
- Depth gives orthogonality for free: a deep module concentrates change behind
  a small interface (leverage for callers, locality for maintainers).
- Global mutable state couples every consumer — here that includes ambient env
  reads scattered through logic; go through `readBoolEnv`/`featureFlags` so
  the knowledge stays in one place.

## Tracer bullets vs prototypes

- **Tracer bullet**: a thin, _real_, end-to-end slice (route → package module →
  RPC → response) that ships dark behind a default-OFF flag — this repo's
  standard rollout shape. It is production code you keep and grow. Build the
  slice first, then breadth: it gives verifiable feedback and avoids large
  unverifiable diffs.
- **Prototype**: throwaway code to answer one question — use the global
  `prototype` skill and never let it drift into production.

## No Broken Windows

Don't leave bad code unrepaired — rot compounds, and unhealthy code measurably
raises agent token cost and error rates on every later change. Fix small
problems immediately (Boy Scout Rule, separate commit) or track them
explicitly: a GitHub issue via the triage flow, or a line in the refactor
backlog (`docs/refactor-backlog.md`). "I noticed but didn't record" is the
failure mode.

## Contracts & pragmatic paranoia

- Validate at the seam: external input crosses a Zod schema at the route/event
  adapter; internal modules then trust their inputs.
- Crash early and visibly on impossible states. But match the repo's defined
  failure modes for _expected_ faults: auth timeouts degrade to anonymous or
  503+`Retry-After`; a 429 from an external API is quota, not death — never
  bump a failure streak on it.
- Promise little: rate limiters fail closed in production; brakes
  (`feature_brakes`, cost caps) exist so a runaway path stops itself.

## Automation

If you did it twice by hand, script it: the repo's shape for this is npm
scripts, Inngest crons with brakes, and CI gates (`pnpm check`, `pnpm
boundaries`). Debugging follows the global `diagnosing-bugs` skill — reproduce,
read the actual error, one change at a time, fix the root cause, then add the
test that would have caught it.

## Guardrails checklist

- [ ] No duplicated knowledge — extended the existing brain/RPC/constant instead of forking it
- [ ] Change ripples to ~1 package; no reach-through past a seam; no new ambient state
- [ ] End-to-end slice (behind a default-OFF flag) before breadth
- [ ] Broken windows fixed in a separate commit or recorded (issue / refactor backlog)
- [ ] Zod at the seam; finite timeouts; defined failure mode; fail closed where money/safety is involved
- [ ] Repetitive steps became a script, cron (with brake), or CI gate
