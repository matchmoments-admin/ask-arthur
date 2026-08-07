# Architectural seams are enforced by dependency-cruiser + ESLint, with a warn→error ratchet

The monorepo's dependency direction (apps depend on package entry points; packages stay framework-free; `@askarthur/types` is a leaf) existed only as convention in CLAUDE.md. We now enforce it mechanically, split by what each tool can see: **dependency-cruiser** (`pnpm boundaries`, `.dependency-cruiser.cjs`, a turbo root task in CI) checks the cross-workspace graph, and **ESLint `no-restricted-imports`** (in `@askarthur/eslint-config` base rules, now consumed by every workspace) checks import specifiers (`@askarthur/*/src/*` deep imports, the `@ask-arthur/*` scope typo, relative cross-workspace paths) — per-workspace ESLint cannot see the graph, and one graph cruise cannot ride lint-staged on every commit, so we need both.

**The sanctioned exception:** `packages/supabase` may import `next` — it is the runtime adapter whose whole job is bridging Next contexts (server/server-auth/middleware/browser). Every other `packages/*` → `next`/`next-axiom` edge is a violation.

**The ratchet:** rules with live violations start at `severity: "warn"` (depcruise exits 0 on warnings, CI stays green) and are listed in `docs/refactor-backlog.md`; the backlog item that clears a violation class flips its rule to `"error"` in the same PR. Currently at warn: `packages-no-next` (one file), `no-undeclared-deps`, `no-circular`. Zero-violation rules started at `error` directly.

Considered: `eslint-plugin-boundaries` (duplicates the graph check with per-workspace config and type-resolution cost in every lint run) and Turborepo's beta `turbo boundaries` (tag-based; cannot express file-level exceptions or a warn ratchet — worth revisiting once stable).
