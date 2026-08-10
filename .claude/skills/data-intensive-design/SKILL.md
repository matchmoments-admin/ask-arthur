---
name: data-intensive-design
description: Applies Designing Data-Intensive Applications (Martin Kleppmann) to Ask Arthur's data layer — reliability/scalability/maintainability trade-offs, Supabase schema evolution (expand→migrate→contract), idempotent writes and at-least-once Inngest consumers, hot-table write discipline, consistency choices, and batch vs stream decisions. Use when designing schemas or migrations, API payloads and event formats, background jobs, caching or search, or when the user mentions consistency, data modeling, migrations, embeddings, event streaming, or replication.
---

# Data-Intensive Design (Ask Arthur)

Reasoning for the data and distributed layer. Pairs with
`software-architecture` (system trade-offs) and `clean-architecture` (the SQL
side is often the real interface; keep vendors behind adapters).

## Three pillars (evaluate every data decision against these)

- **Reliability** — works under faults, including _human_ error (the biggest
  cause of outages; both major incidents here were config/code, not hardware).
  Defined failure modes, watchdogs, brakes, idempotent re-runs.
- **Scalability** — describe load with real parameters (rows/day, read:write
  ratio, fan-out per event) and latency with **percentiles, not averages**.
  Supabase compute has a Disk IO budget: index-page dirties on write-heavy
  tables are the scarce resource here, not CPU.
- **Maintainability** — operability (every background fn in
  `docs/inngest-brakes.md`), simplicity, evolvability (migrations follow the
  rules below).

## Schema evolution — the house rules

Data outlives code, and deploys are rolling: old and new code run against the
same schema simultaneously. Applied migrations are immutable; `docs/adr/` and
the migration-number CI guard govern the mechanics. When changing schemas, API
payloads, or event formats:

- **Backward + forward compatible by default**: add optional/defaulted columns
  and fields; never remove, rename, or change the meaning of an existing one
  in place.
- **Destructive changes are multi-step**: expand (new column/table, dual-read)
  → migrate (backfilled, chunked ≤5K rows, `'300s'` timeout cap, per-chunk
  commit) → contract (drop old, separate later migration). Never one edit.
- **Migrations are idempotent** (`IF NOT EXISTS`, `DROP POLICY IF EXISTS …
CREATE POLICY`) so re-running is safe — that's the repo's rollback posture.
- **Event schemas are versioned** (`analyze.completed.v1`); consumers tolerate
  unknown fields; a new required field means a new version, not a mutation.
- The full data-layer interface includes RLS, triggers, and RPC signatures —
  changing a check constraint is an interface change even though no TS changed.

## Idempotency & delivery (Inngest, webhooks, retries)

Everything here is **at-least-once**. A retry must be safe:

- Writes carry an idempotency key and land via `ON CONFLICT` (the
  `create_scam_report` RPC + `Idempotency-Key`→`scam_reports.idempotency_key`
  chain is the reference shape).
- **A re-submit path must move the row back across the exact predicate its
  retrieve/consume stage filters on** — the 81%-inert recheck loop (v224/PR
  #715) is the canonical counter-example. Grep the downstream read-gate
  against the upstream write before calling a pipeline done.
- A 429 is quota exhaustion, not failure — never bump a death streak on it.
- Bounded batches run inline with one `step.run` per item; don't fan out N
  single-item events (invocation cost + operator-override semantics).

## Consistency & data models

- Postgres is the source of truth; strong consistency inside a transaction/RPC.
  Cross-system flows (Redis rate counts, queued bot messages, Inngest state)
  are eventually consistent — design read-your-writes only where users expect
  it (their own report status), and say so explicitly when eventual is fine.
- Relational by default; jsonb for genuinely open metadata
  (`analytics_events.event_props` — additive, no migration); pgvector for
  similarity — **on a 1:1 sibling table, never on a write-hot parent** (the
  `verified_scams`/embeddings split; index-to-data ratio ≤ ~5:1, <100 MB, or
  sibling it).
- Hot tables (`acnc_charities`, `scam_reports`, `verified_scams`,
  `feed_items`, …): chunked writes only, no single-statement >5K-row mutations,
  no new large indexes without the IO-budget check.

## Batch vs stream

- **Batch** (bounded, periodic): scrapers, retention sweeps, backfills — GitHub
  Actions or cron Inngest fns, chunked, <5 min per run on a healthy DB.
- **Stream** (unbounded, low-latency): analyze events, webhook-driven queue
  dispatch (pg_net on INSERT — event-driven beats polling on cost).
- At-least-once + idempotent consumers is the house guarantee; don't design
  anything that needs exactly-once.
- Multi-stage pipelines (submit → poll → act) get an **operational review**
  against live telemetry, distinct from the correctness review.

## Checklist

- [ ] Reliability/scalability/maintainability implications stated; load in parameters, latency in percentiles
- [ ] Schema/payload/event change is backward AND forward compatible; destructive = expand→migrate→contract
- [ ] Migration idempotent; chunked ≤5K with capped timeout for any backfill; hot-table rules respected
- [ ] Every write/consumer retry-safe; re-submit crosses the consumer's read predicate
- [ ] Consistency level chosen explicitly (transactional vs eventual) — not assumed
- [ ] Batch/stream choice justified; new background fn registered in docs/inngest-brakes.md with a brake
