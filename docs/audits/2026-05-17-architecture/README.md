# Architecture audit — 2026-05-17

Point-in-time snapshot of the Ask Arthur surface area, plus a set of P-level issue drafts derived from gaps observed during the audit. Not a living document — see [docs/system-map/](../../system-map/README.md) for the authoritative, continuously-maintained inventory.

## Artefacts

### Diagrams (open in a browser)

| File                                                                             | What it shows                                                                                                                                  |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| [`arch-ask-arthur-system.html`](./arch-ask-arthur-system.html)                   | 6 layered surfaces — Clients → Web → Auth → Scam Engine → Postgres → Workers — with feature-completion state per surface and P0–P3 issue chips |
| [`arch-ask-arthur-db-schema.html`](./arch-ask-arthur-db-schema.html)             | 14 domain cells + foreign-key arrows + RPC / trigger / hygiene panel + sibling-index compliance verdicts                                       |
| [`arch-ask-arthur-ingestion-flows.html`](./arch-ask-arthur-ingestion-flows.html) | 7 horizontal lanes — Sonnet-vs-Voyage stage callout + cost-telemetry-gap panel                                                                 |

Each is a self-contained light-theme HTML/SVG file; no build step, no external assets.

### Issue drafts → [`issues/`](./issues/)

Nine numbered drafts, severity P1–P3. Each file contains a complete issue body plus the `gh issue create --body-file` command used to publish it. See [`issues/README.md`](./issues/README.md) for the master index and label scheme.

## How this relates to `docs/system-map/`

The diagrams pull from `docs/system-map/*` but add three things the system map doesn't carry:

1. **Feature-completion state per surface** (shipped vs. flag-gated vs. paused)
2. **P0–P3 issue chips inline on affected cells** — visual link between architecture and the issue tracker
3. **Sibling-index compliance verdicts** — which write-frequent tables comply with the "no large indexes on hot tables" rule and which don't

These are stakeholder / onboarding artefacts. `docs/system-map/` remains the single source of truth — if a diagram disagrees with the system map, the system map wins.

## Regeneration

These won't be regenerated automatically. When the system map changes materially (new surface, new domain cell, new ingestion lane), copy this folder to a fresh `docs/audits/<date>-architecture/` and re-derive — preserves the historical snapshot.
