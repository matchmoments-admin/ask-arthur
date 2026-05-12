# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the domain glossary.
- **`docs/adr/`** — architectural decision records. Read ADRs that touch the area you're about to work in.
- **`docs/system-map/`** — the deployed-surface inventory (web routes, database tables, background workers, feature flags, canonical data flows). Project-specific addition for Ask Arthur. Always check this before designing a new feature so you know what already exists. Start at `docs/system-map/README.md`.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The producer skill (`/grill-with-docs`) creates `CONTEXT.md` entries and ADRs lazily when terms or decisions actually get resolved.

## File structure

Single-context repo (this one):

```
/
├── CONTEXT.md
├── docs/
│   ├── adr/
│   │   ├── 0001-bot-queue-via-pg-net.md
│   │   ├── 0002-multi-pillar-verification-module.md
│   │   ├── 0003-embedding-model-versioning.md
│   │   ├── 0004-multi-domain-embedding-model-selection.md
│   │   ├── 0005-pgvector-index-policy.md
│   │   └── 0006-query-vector-retention.md
│   └── system-map/
│       ├── README.md
│       ├── web-surface.md
│       ├── database.md
│       ├── background-workers.md
│       ├── feature-flags.md
│       └── data-flows.md
└── (apps/, packages/, supabase/, pipeline/, …)
```

(For reference — multi-context repos use a `CONTEXT-MAP.md` at the root pointing at per-context `CONTEXT.md` files under `src/<context>/`. Ask Arthur is not currently structured that way.)

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/grill-with-docs`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0005 (pgvector index policy) — but worth reopening because…_

Examples: ADR-0001 forbids polling for bot dispatch; ADR-0005 forbids HNSW indexes on hot write-frequent tables; ADR-0006 governs query-vector retention. The full set is in `docs/adr/`.
