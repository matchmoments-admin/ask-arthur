---
name: refactoring
description: Guides safe, incremental, test-protected refactoring (Martin Fowler) in the Ask Arthur monorepo — recognize a smell, pick the named refactoring, change structure in tiny steps without altering behavior, and keep refactoring commits separate from feature commits. Use whenever restructuring or cleaning up existing code, extracting functions, renaming, removing duplication, taming a large file, or when the user says "refactor," "clean this up," "reduce technical debt," or "improve this code."
---

# Refactoring (Ask Arthur)

Changing internal structure **without changing observable behavior**, in tiny
steps, each protected by tests. This skill owns the _mechanics and process_ of
safe change.

## Relationship to other skills

- _Finding_ what's worth restructuring → `/improve-codebase-architecture`
  (the deepening survey; its `PROJECT-NOTES.md` lists known shallow areas and
  seams that must NOT be collapsed). This skill takes over once a target is
  chosen.
- What "good" looks like at line level → `clean-code`. Where interfaces and
  seams go → `clean-architecture`.
- The global `tdd` skill deliberately excludes refactoring from its red-green
  loop ("it belongs to the review stage") — this skill is that stage.

## The core discipline (non-negotiable)

1. **Green tests first.** If the target isn't covered, write characterization
   tests before touching it. `pnpm --filter <pkg> test` scoped to the package;
   `tsc --noEmit` via `pnpm --filter <pkg> typecheck` is the second net.
2. **Tiny steps.** Every step compiles and passes tests. If red, revert the
   step — don't debug forward.
3. **Two Hats.** Either refactoring (no behavior change) or adding behavior —
   never both in one commit. Empirically, agents tangle most refactorings into
   feature commits, which inflates review burden. Here it also muddies the
   RDTI narrative: a refactoring commit's WHY is "structure", a feature
   commit's WHY is "capability". Label refactoring commits `refactor(scope):`.
4. **Refactor in service of a goal** — comprehension, or "make the change easy,
   then make the easy change." Don't rename or reshuffle code unrelated to the
   task, and don't cosmetically churn generated files (`db.generated.ts`) or
   data-as-code files (`disposable-domains.ts`).

## Repo-specific safety rails

- **Respect real seams.** The bot-formatter, Supabase-client, and scanner seams
  each have ≥2 adapters — consolidating "duplicate-looking" adapters at a real
  seam is a regression, not a cleanup. Check
  `improve-codebase-architecture/PROJECT-NOTES.md` before merging near-twins.
- **Deletion test before inlining a wrapper.** Some thin TypeScript wrappers
  here are deliberate adapters over a Postgres-side interface (RPC + `ON
CONFLICT` idempotency; `feature_flags` table + helper). If deleting the
  wrapper would scatter idempotency-key or flag plumbing across callers, it is
  earning its keep — leave it.
- **Inngest function IDs are durable.** Renaming or moving an Inngest function
  is NOT behavior-preserving unless the ID is kept stable or migrated behind a
  flag. Treat any refactor under `*/inngest/` as an interface change at the
  event seam.
- **Migrations are immutable.** Never "refactor" an applied `supabase/migration-v*.sql`;
  structure changes go in a new migration (see `data-intensive-design`).
- **Route files are adapters.** When splitting a giant `route.ts`, move logic
  _down_ into the owning package behind its existing entry points — don't
  create parallel helper files beside the route.

## Common smells → named refactorings

- Mysterious Name → Rename (use IDE rename; verify with tests).
- Long Function / 900-line route → Extract Function; move extracted behavior to
  the package whose interface it belongs behind.
- Duplicated Code → Extract Function; or consolidate to the module that owns
  the knowledge (after the seam check above).
- Long Parameter List → Introduce Parameter Object (a typed options object).
- Repeated Switches → Replace Conditional with Polymorphism — but only where a
  real seam exists (the per-platform `format-*.ts` adapters are the house
  pattern).
- Divergent Change (one file, many reasons to change) → Split by reason;
  `feature-flags.ts` and `rate-limit.ts` are the standing examples.

## Workflow checklist

- [ ] Target behavior covered by passing tests (or characterization tests added first)
- [ ] Named refactoring chosen for a recognized smell
- [ ] Each step: edit → `pnpm --filter <pkg> typecheck && pnpm --filter <pkg> test` → green
- [ ] Seam check done — not collapsing a ≥2-adapter seam; deletion test applied to wrappers
- [ ] No behavior change mixed in; commit is `refactor(scope):` with WHY in the body
- [ ] Cross-package impact verified at the end (`pnpm check`) if any package interface moved
