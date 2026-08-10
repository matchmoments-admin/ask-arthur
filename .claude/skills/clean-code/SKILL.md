---
name: clean-code
description: Enforces Clean Code practices (Robert C. Martin) adapted to the Ask Arthur monorepo — intention-revealing names, small single-purpose functions, minimal comments, deliberate error handling, and honest unit tests. Use when writing new functions/classes, reviewing code, naming things, cleaning up messy code, or when the user mentions readability, code smells, naming, or "clean code." Apply proactively when generating any non-trivial TypeScript.
---

# Clean Code (Ask Arthur)

Write code optimized for the next reader — human or agent. Reduce the cost of
understanding; prefer clarity over cleverness.

## Relationship to other skills

- The _process_ of changing existing code safely → `refactoring`.
- Where a module's interface goes and how deep it should be → the
  Module / Interface / Seam / Adapter vocabulary in
  `.claude/skills/improve-codebase-architecture/LANGUAGE.md` and the
  `clean-architecture` skill.
- Test-first workflow and mocking rules → the global `tdd` skill (its
  `mocking.md` is the canonical over-mocking reference).
- Naming _domain_ concepts → `/CONTEXT.md` (the glossary). Never coin a fresh
  synonym for a term that already exists there.

## Naming

- Intention-revealing names: why it exists, what it does, how it is used. A name
  that needs a comment is the wrong name.
- Functions are verbs (`buildEvidenceBlock`), values are nouns
  (`activeWatchlist`), booleans read as predicates (`isWeaponised`, `hasLoss`).
- No single letters (except tiny loop indices), no abbreviations, no
  `data`/`info`/`temp`/`manager`.
- Match the codebase's existing vocabulary: check `/CONTEXT.md` for domain terms
  and the surrounding package for casing/idiom before inventing anything.

## Functions

- Small, ONE thing, ONE level of abstraction. Extract the moment a function does
  two things or mixes levels.
- Prefer 0–2 parameters; group related params into an object.
- No boolean flag arguments — split into two named functions.
- No hidden side effects: a function named `checkRateLimit` must not also log
  cost telemetry. Command/Query Separation: do something or answer something,
  not both.

## Comments — agent discipline

Do NOT add comments that restate the code — a common AI failure mode that
inflates diffs and review cost.

- Keep comments only for: intent code cannot express, warnings of consequences
  (this repo's expected-duration headers on long-running Inngest functions are
  the canonical example), TODOs, and public-API TSDoc.
- Never leave commented-out code; git remembers.
- Never write a comment narrating or apologising for a change you just made —
  that reasoning belongs in the commit message body (which doubles as RDTI
  documentation here).

## Error handling

- Typed errors with context (what operation, what inputs) — the
  `AuthUnavailableError` in `apps/web/lib/auth.ts` is the reference shape.
- No silent catches; API routes return structured JSON errors (CONVENTIONS.md).
- Don't return `null` where callers won't expect it; prefer explicit optionals,
  default objects, or a discriminated result type.
- External calls get finite timeouts (`Promise.race` — see the middleware
  `withTimeout` helper) and a defined failure mode. Fail fast on impossible
  states; don't limp on corrupting data.

## Unit tests

- One logical behavior per test; descriptive names; tests cross the module's
  interface, not its internals (the interface is the test surface).
- A test that mocks everything and asserts nothing proves nothing. Agents
  over-mock — before adding a mock, check `tdd`'s `mocking.md` rules.
- Run scoped: `pnpm --filter <pkg> test`. Three packages currently pass with
  `--passWithNoTests` — a test you add there is the first real one; make it count.

## The Boy Scout Rule

On any file you touch, make one small safe improvement — but as a _separate
commit_ from behavior changes (see `refactoring`, Two Hats). Don't churn files
unrelated to the task.

## Review checklist

- [ ] Names reveal intent and match /CONTEXT.md domain terms
- [ ] Each function does one thing at one abstraction level
- [ ] ≤2 params; no boolean flags; no hidden side effects
- [ ] No redundant comments; no commented-out code; reasoning in commit body
- [ ] Errors typed + contextual; timeouts on external calls; no silent catches
- [ ] Tests assert real behavior through the interface (not over-mocked)
- [ ] No duplicated knowledge (see `pragmatic-programmer` DRY)
