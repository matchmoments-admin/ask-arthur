---
name: clean-architecture
description: Applies Clean Architecture (Robert C. Martin) to the Ask Arthur monorepo using the repo's Module/Interface/Seam/Adapter vocabulary — the Dependency Rule (packages stay framework-free, apps depend on package entry points), where logic belongs (route vs package vs RPC), and keeping domain modules testable without infrastructure. Use when designing modules, deciding where logic belongs, introducing an interface at a seam, reviewing coupling to Next/Inngest/Supabase, or when the user mentions SOLID, layers, dependency direction, or use cases.
---

# Clean Architecture (Ask Arthur)

Keep the domain independent of frameworks so the things that change most often
(web framework, job runner, vendors) can't drag down the things that matter
most (scam analysis, routing brains, evidence handling).

Vocabulary comes from `.claude/skills/improve-codebase-architecture/LANGUAGE.md`
— Module / Interface / Seam / Adapter / Depth. Say **seam**, not "boundary".

## Relationship to other skills

- System-level trade-offs, ADRs, fitness functions → `software-architecture`.
- Data modeling, migrations, consistency → `data-intensive-design`.
- Finding deepening opportunities retrospectively → `/improve-codebase-architecture`.
- Interface design for a specific module → the global `codebase-design` skill.

## The Dependency Rule, as this repo enforces it

Source dependencies point from adapters toward domain modules, never the other
way:

- **`packages/*` are the domain modules.** They stay framework-free: no `next`,
  no framework globals. The sanctioned exception is `packages/supabase` — the
  runtime adapter whose whole job is bridging Next runtimes (see ADR-0024).
- **`apps/*` hold the adapters.** A `route.ts` is an adapter at the HTTP seam:
  parse/auth (Zod, `requireAuth`) → call a package module through its interface
  → shape the response. An Inngest function is an adapter at the event seam:
  the event payload schema is its interface, and function IDs are durable.
  Adapters translate; they do not accumulate domain logic.
- **Interfaces are the package entry points** — `src/index.ts` or the explicit
  subpath exports in `package.json`. Apps import `@askarthur/<pkg>/<subpath>`,
  never `@askarthur/*/src/*` internals. Deep imports bypass the seam and are
  lint-erred.
- **`packages/types` is the leaf.** It imports from no other package.
- **The SQL side can be the real interface.** Migrations define the data-layer
  interface (RLS, triggers, RPC signatures included). A thin TS wrapper over a
  deep RPC is a legitimate adapter — apply the deletion test before inlining
  it, and ask whether logic should move _into_ the RPC (deeper) or _out_
  (up into a package), not just "remove the wrapper."

These rules are mechanically enforced: dependency-cruiser (`pnpm boundaries`)
for the package graph, ESLint `no-restricted-imports` for deep imports. If a
design fights the fitness functions, the design conversation comes first — not
a rule exception.

## Where does this logic belong?

1. Pure domain rule (scoring, matching, formatting)? → the owning package,
   behind its existing interface. Extend the existing brain before creating a
   parallel one.
2. Translation between the outside and a module (parse, auth, response shape,
   event glue)? → the adapter in `apps/*`.
3. Data invariant (idempotency, uniqueness, cross-row consistency)? → the
   database interface (RPC/constraint), with a thin TS adapter.
4. Genuinely new capability with no owning module? → design the interface
   first (`codebase-design`), then place the module in the package layer.

## SOLID, translated

- **SRP** — one reason to change per module. An 850-line utils file mixing flag
  registry + env reading + per-feature policy has several.
- **OCP** — extend by adding an adapter at an existing seam (a new `format-*.ts`
  platform, a new onward destination = enum + worker + key) rather than editing
  stable dispatch code.
- **LSP** — every adapter honors the seam's full interface: invariants, error
  modes, and timing, not just the type signature.
- **ISP** — subpath exports are the house mechanism: consumers depend on
  `@askarthur/utils/rate-limit`, not all of utils.
- **DIP** — domain modules must not import infrastructure. Where a domain
  module needs an outer capability, the interface lives with the domain and
  the adapter satisfies it from outside.

## Pragmatic cautions

- One adapter = hypothetical seam; two = real. Don't scaffold interfaces for
  things that don't vary (no speculative repositories over Supabase).
- Don't map DTOs through layers for a simple read path; depth, not ceremony.
- Match existing conventions — this repo already has its architecture; new
  features join it rather than importing a rival style.

## Design checklist

- [ ] No framework imports in `packages/*` (except the sanctioned `packages/supabase` adapter)
- [ ] Apps call package entry points; no `@askarthur/*/src/*` deep imports
- [ ] Route/Inngest files are thin adapters; domain logic lives in the owning package
- [ ] Extended an existing module/brain instead of creating a parallel one
- [ ] New seam justified by ≥2 real adapters (or an imminent second)
- [ ] Domain modules unit-testable with fakes — no DB/HTTP needed at test time
- [ ] `pnpm boundaries` green (or the violation is a recorded, warn-level known debt)
