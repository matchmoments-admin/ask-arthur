# Implementation Plan — Canonical Brand-Key Seam Across the Three Brand Streams

## 1. Problem statement

Ask Arthur has three "brand" intelligence streams — **reported-scams** (`scam_reports.impersonated_brand`, plus `verified_scams`/`feed_items`), **Reddit-intel** (`reddit_post_intel.brands_impersonated[]`), and **clone-watch** (`shopfront_clone_alerts`, keyed by `inferred_target_domain`) — that today cannot join, because each stores brand identity under a different, disagreeing key. Reported-scams and Reddit store **raw free-text brand names** ("National Australia Bank", "NAB", "nab") never canonicalised on write; clone-watch stores a **legitimate domain** (`nab.com.au`) and keeps the brand name only inside a `signals` JSONB. Three separate key functions encode this fragmentation: `brandNormalize()`/`brand_normalize()` (strip to `[a-z0-9]`), `deriveBrandKey()` (underscore-separated, `known_brands.brand_key`), and clone-watch's `inferred_target_domain`. The result: a brand under active impersonation surfaces in three places under three keys and reinforces itself nowhere. A canonical layer already exists (`brand_aliases` + `brand_normalize()` + `resolve_brand()`, v174/v175) but has **zero code callers** outside one default-OFF monthly job. This plan wires the three streams onto that single canonical Seam so they reinforce each other — driving watchlist curation, clone-alert triage priority, and a per-brand "brand 360" rollup.

### 1a. Before / after

```
BEFORE — three brand streams, three disagreeing keys, nobody talks

  (1) REPORTED SCAMS            (2) REDDIT INTEL           (3) CLONE-WATCH
  scam_reports /                reddit_post_intel          shopfront_clone_alerts
  verified_scams /               .brands_impersonated[]     key = inferred_target_
  feed_items.impersonated_brand  (free-text array)          DOMAIN (nab.com.au);
  (raw free-text: "NAB","nab",         |                    brand only in signals JSON
   "National Aust...")                 v                          |    ct-monitor(12h)
        |                    reddit-brands-discover               v
        v                       (weekly cron)          brand_impersonation_alerts
  brand_impersonation_alerts    reddit_watchlist_         .brand_name (crt.sh kw)
   .brand_name EXACT-match       candidates ---> Telegram ---> human edits TS array
   -> known_brands               (source='reddit' only)
   ("nab" != "NAB"  X)

  [ DORMANT: brand_aliases + brand_normalize() + resolve_brand() (v174/v175) ]
  [ the canonical layer that COULD join them - only 2 callers, resolve_brand() 0 ]

  THREE KEYS, NO JOINS:  brandNormalize("nab") . deriveBrandKey("n_a_b") . domain
  A brand under attack surfaces in 3 places under 3 keys -> reinforces itself NOWHERE.


AFTER — one canonical brand key = the Seam every stream joins on (read-side only)

  (1) scam_reports        (2) reddit_post_intel     (3) shopfront_clone_alerts
   .impersonated_brand      .brands_impersonated[]     + NEW .target_brand_normalized
        |  (raw)                 |  (raw)                   |  (written at match-time)
        +-----------+------------+-------------+------------+
                    v                          v
        ##################################################   <- Phase 0
        #  THE SEAM: resolveCanonical(raw | domain)       #      one resolver Module,
        #  brand_normalize -> brand_aliases -> canonical  #      raw columns untouched
        ##########+###############+###############+########      (read-side, rebuildable)
                  |               |               |
        Phase 1   v      Phase 2  v      Phase 2b  v
   watchlist_candidates   clone triage queue   /api/analyze verdict
   + source_counts{}      + corroboration as   lookupCloneAlert(host) by
   reddit:N + scam:M      separate ORDER-BY    url_hash -> push redFlag
   (ONE row/brand,        term (severity       "known clone of <brand>"
    FOLDED into the       NEVER mutated)       -> USER sees it at check time
    EXISTING weekly            ^                     ^
    reddit cron -              | scams+Reddit lift   | clone-watch pays off
    NO new automation)         | a live clone up     | in a real user check
        |                      | the operator queue  |
        v
   Telegram digest + admin review --> human-gated PR --> AU_BRAND_WATCHLIST
   (still NO auto-promote - legitimate_domains stays a human call)

   Phase 3 (GATED on deletion test - only if a "brand 360" consumer appears):
     brand_register(canonical_brand PK, scam_30d, reddit_30d, clone_open,
                    on_watchlist, curation_status)  <- nightly rollup, all 3 converge

   DISCRIMINATOR HELD (ADR-0016): brand_impersonation_alerts (govt/bank/telco) and
   shopfront_clone_alerts (merchant clones) stay SEPARATE - joined, never merged.
```

---

## 2. The decision — the canonical brand-key Seam

**The Seam is the canonical brand key contract:** `brand_normalize(raw_text) → resolve via brand_aliases → canonical_brand`, with the normalized value as the fallback when no alias row matches.

- **Data home:** the live `brand_aliases` table (`alias_normalized` PK → `canonical_brand`, v174) plus the `brand_normalize()` / `resolve_brand()` SQL functions. No new abstraction is invented over it — the feature's job is to **wire the three streams into the existing Seam**, not wrap it.
- **Code home:** one shared **brand-resolver Module** in `packages/shopfront-glue/src/brand-resolver.ts`, co-located with the `brandNormalize` twin so all keying primitives stay under the one parity harness. It exposes two **Adapters**:
  - `resolveCanonical(rawBrandText)` — the alias-Record lookup currently **copy-pasted verbatim** in `reddit-brands-discover.ts:143` and `report-brand-stewardship.ts:566`.
  - `resolveCanonicalFromDomain(domain)` — **new** bridging logic mapping a legitimate domain → canonical brand, built from `brand_contact_directory.legitimate_domain` + `known_brands.brand_domain`, returning `null` on miss (with a raw-domain fallback facet so unresolved clones still surface for curation).
- **Write-side vs read-side:** **canonicalisation is read-side only.** No canonical value is ever written back onto a hot free-text column. All three raw columns remain the source of truth; every canonical projection is derived in nightly/weekly crons and is fully rebuildable. This is the maximal-reversibility choice and it keeps the hot `scam_reports` write path pristine (no column, no index, no RPC change).
- **How the three key functions reconcile (promotion, not unification):**
  1. `brand_normalize()`/`brandNormalize()` is **promoted to the one join/lookup key** — it produces `alias_normalized`, the key into `brand_aliases`. Its three byte-identical copies (`.ts` / `.mjs` / SQL) stay pinned by `gen-brand-aliases-seed.test.ts`.
  2. `deriveBrandKey()` (underscore form) is **frozen as a display/report-ref slug only** (the `BSR-…` refs). An invariant is asserted in tests: it is derived from the canonical brand, never re-used as a join key, so it can never re-fragment the join.
  3. `inferred_target_domain` **stays** as the clone alert's native discriminator (a domain is the semantically correct key there, per ADR-0016). It gains a **sibling** `target_brand_normalized` column resolved via `resolveCanonicalFromDomain`; it is never replaced.

---

## 3. Phased build sequence

Ordered smallest-self-contained-win first. Every phase is independently reversible and ships behind a default-OFF flag.

### Phase 0 — Seam consolidation (foundation, no user-visible surface)

- **Deliverable:** Extract the duplicated `resolveCanonical` closure into `packages/shopfront-glue/src/brand-resolver.ts` (`loadAliasRecord` + `resolveCanonical`); add `resolveCanonicalFromDomain`. Point `reddit-brands-discover.ts` and `report-brand-stewardship.ts` at the Module (behaviour-preserving). Seed `known_brands` into `brand_aliases` (one-time `INSERT … ON CONFLICT (alias_normalized) DO NOTHING`, `deriveBrandKey(brand_name)→canonical`), closing the read-time-only `matchKnownBrand` gap for all consumers.
- **Files/tables/migrations/flags:** new `packages/shopfront-glue/src/brand-resolver.ts` + unit test; edits to `reddit-brands-discover.ts`, `report-brand-stewardship.ts`; migration **v195** (`known_brands`→`brand_aliases` seed). No flag (pure refactor + idempotent seed).
- **Effort:** ~1 day. **Reversible:** yes (refactor is behaviour-preserving; seed is `ON CONFLICT DO NOTHING`).
- **Reinforcement unlocked:** none yet — this concentrates the canonical vocabulary in one data home + one Module so Phases 1-3 build on a single owner.

### Phase 1 — Multi-source `watchlist_candidates` (reported-scams reinforces Reddit curation) — **folded into the existing weekly cron, NO new automation**

- **Deliverable:** Make the human review queue genuinely multi-source. Add `source_counts JSONB` to `reddit_watchlist_candidates` while **keeping `UNIQUE(brand_normalized)`** (one row per canonical brand). Replace the source-blind RPC with `upsert_watchlist_candidate(p_brand_normalized, p_raw_brand, p_source, p_source_count, p_resolved_canonical)` that merges `source_counts[p_source] = p_source_count`, recomputes `mention_count = sum(source_counts)`, and **preserves `status`**. Add a **windowed-only** `SECURITY DEFINER` aggregate RPC `aggregate_scam_report_brands(p_since timestamptz, p_min_count int)` that does `GROUP BY brand_normalize(impersonated_brand)` server-side over a 30-day `created_at` window (served by `idx_scam_reports_created`; no all-time count).
  - **Fold-in, not a sibling fn:** rather than a new `scam-brands-discover` cron, **add a second source to the EXISTING `redditBrandsDiscover` weekly fn** (`apps/web/app/api/inngest/functions/reddit-brands-discover.ts`, cron `0 7 * * 1`). After the Reddit aggregation steps, add one step `aggregate-scam-brands` that calls `aggregate_scam_report_brands`, runs the results through the same `CANDIDATE_DENYLIST` + `MENTION_THRESHOLD=3` + `buildWatchedKeySet(AU_BRAND_WATCHLIST)` filters, and upserts with `p_source='scam_reports'`. The Reddit steps switch to the new RPC with `p_source='reddit'`. **Keep the Inngest fn id `reddit-brands-discover`** (do not rename the id — it would fork Inngest run history); only the human-facing digest header changes to "Brands discover". **Zero new Inngest functions, zero new crons.**
- **Files/tables/migrations/flags:** migration **v196** (`source_counts` column + backfill `jsonb_build_object('reddit', mention_count)`; new `upsert_watchlist_candidate` + `aggregate_scam_report_brands` RPCs); edit `reddit-brands-discover.ts` (add the scam-source step + repoint the Reddit upsert); flag `FF_SCAM_BRANDS_SOURCE` via `readBoolEnv()`, default OFF, gating **only the new scam-source step** (Reddit source runs exactly as today when OFF).
- **Effort:** ~1.5-2 days. **Reversible:** yes (RPC bodies re-creatable; `source_counts` is additive; the new step is flag-gated and self-contained).
- **Reinforcement unlocked:** **reported-scams now reinforces Reddit** — a brand seen in both lands in the _same_ candidate row with `source_counts={reddit:N, scam_reports:M}`, so the pending-review queue (`ORDER BY mention_count DESC`) floats cross-stream-corroborated brands to the top. Delivers **BACKLOG #32** into the existing curation workflow with **no new scheduled job**.
- **Trade-off noted:** folding-in means the two sources share one weekly slot and cannot be independently scheduled; the flag still lets the scam source be toggled without touching the Reddit path. A separate `scam-brands-discover` fn (own cadence + own failure isolation, at the cost of one new watched cron) remains a future option if the sources ever need to diverge.

### Phase 2 — Cross-stream corroboration → clone-alert triage priority (Reddit + scams reinforce clone-watch)

- **Deliverable:** Add `target_brand_normalized TEXT` (nullable) to `shopfront_clone_alerts`, written **at NRD-match time** (the matcher already holds the brand — free) via `brandNormalize(matchedBrand)`, and backfilled via `resolveCanonicalFromDomain` over `inferred_target_domain`. Add partial btree `idx_clone_alerts_target_brand ON (target_brand_normalized) WHERE target_brand_normalized IS NOT NULL`. `DROP+CREATE list_clone_alerts_pending_triage` to LEFT JOIN `watchlist_candidates ON brand_normalized = target_brand_normalized`, returning **separate named columns** `cross_stream_corroborated boolean` + `corroboration_mention_count int`, and adding corroboration as an **additive `ORDER BY` term only**. Add an "Also impersonated: Reddit ×N / scams ×M" chip to the admin triage UI. Optionally close the loop: emit a `source='clone_watch'` upsert into `watchlist_candidates` from open alerts.
- **Files/tables/migrations/flags:** migration **v197** (column + index + triage RPC redefine); edits to `packages/shopfront-glue/src/canonicalise.ts`, `packages/scam-engine/src/inngest/shopfront-nrd-daily-ingest.ts`, and the clone-alert upsert RPC (v141 lineage); admin triage UI edit; flag `FF_CLONE_TRIAGE_CORROBORATION` (`readBoolEnv`, default OFF) gates the **ordering** — the columns are always exposed.
- **Effort:** ~3-4 days. **Reversible:** yes (column additive; RPC re-creatable to prior body).
- **Reinforcement unlocked:** **Reddit + reported-scams now reinforce clone-watch** — a live merchant clone of a brand being actively impersonated jumps the operator triage queue. `severity` (the deterministic clone signal) is **never mutated**.

### Phase 2b — clone-watch reinforces the live analyze verdict (optional, high user-visible value)

- **Deliverable:** Today `/api/analyze` only ever **writes** to the alert tables — the verdict merge (`route.ts:308-317`) and response assembly (`route.ts:632-654`) never read `shopfront_clone_alerts` or `brand_impersonation_alerts`, so a user pasting a URL that clone-watch already flagged gets **no** citation. Add a new `lookupCloneAlert(hosts)` Adapter in `packages/scam-engine` (alongside `brand-alerts.ts`, same `createServiceClient()` pattern) that resolves the checked host(s) against `shopfront_clone_alerts`. **Query by `url_hash`** (compute the same hash the ingest uses) so it rides the existing `idx_clone_alerts_url_hash` index — do **NOT** add a `candidate_domain` btree; that table is write-hot (`v157:13`). On a hit, push a red flag (`"This domain is a known clone of <canonical brand> (first flagged <date>)"`) onto `aiResult.redFlags` at the injection point **`route.ts:318`** (right after the `mergeVerdict` block, where `allUrls`/`urlResults` are already in scope and downstream Twilio/enrichment code already uses the `aiResult.redFlags.push(...)` pattern). It flows automatically into the response (`route.ts:637`) and onward-report payloads.
- **Files/tables/migrations/flags:** new `packages/scam-engine/src/clone-alert-lookup.ts`; edit `apps/web/app/api/analyze/route.ts` (~line 318, ideally awaited inside the existing `Promise.all` at 257-266 to avoid added latency); flag `FF_ANALYZE_CLONE_CITATION` (`readBoolEnv`, default OFF). **No migration** — read-only against an existing index.
- **Effort:** ~1-2 days. **Reversible:** yes (flag-gated additive red flag; no schema change).
- **Reinforcement unlocked:** **clone-watch now reinforces the reported-scam verdict** — the background NRD/CT sweep pays off in a real user check. Closes the loop the other direction from Phase 2. Keep this behind its own flag and canary — it's the only phase that changes what an end user sees.

### Phase 3 — `brand_register` nightly rollup + brand-360 (GATED on the deletion test)

- **Deliverable:** Build the per-brand rollup **only when a concrete third consumer exists** (a per-brand admin/B2B "brand 360" surface) that needs cached per-brand identity a read-time join cannot cheaply serve. If built: `brand_register(canonical_brand PK, display_name, first_seen_at, scam_30d, reddit_30d, clone_open_alerts, on_au_watchlist, curation_status, cross_stream_priority, updated_at)` — a nightly-refreshed **table** (not VIEW/MV), UPSERTed by Inngest fn `brand-register-refresh` (cron `30 3 * * *`, <5 min, bounded windowed reads, TS/RPC aggregation keyed on `resolve_brand()`). `cross_stream_priority` is an **additive triage-ordering term only** — it never mutates or blends into the deterministic clone severity, and the constituent stream counts are exposed individually so operators see disagreement. First consumer is an **admin** page; any public surface is deferred behind Phase 4 gating.
- **Files/tables/migrations/flags:** migration **v198** (`brand_register`, deny-all RLS + service_role); new `apps/web/app/api/inngest/functions/brand-register-refresh.ts`; `/admin/brand-register` page; flag `FF_BRAND_REGISTER` (`readBoolEnv`, default OFF).
- **Effort:** ~4-6 days **if triggered**; otherwise 0.
- **Reversible:** yes (pure-derived, `DROP TABLE` lossless — rebuilds on next run).
- **Reinforcement unlocked:** **all three streams converge** into one queryable per-brand row for the brand-360 surface.

> **Phase 4 (public brand-360) is explicitly out of this plan** — see §6.

---

## 4. Schema changes & hot-table-risk handling

| Migration                 | Table                                                                | Change                                                                                                                | Hot-table risk & handling (per CLAUDE.md rules)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **v195**                  | `brand_aliases` (not hot)                                            | Seed `known_brands` rows (`deriveBrandKey(brand_name)→canonical`)                                                     | One-time `INSERT … ON CONFLICT (alias_normalized) DO NOTHING`; same shape as the v174 directory seed. No hot table touched.                                                                                                                                                                                                                                                                                                                                                                                                               |
| **v196**                  | `reddit_watchlist_candidates` (not hot, ~hundreds of rows)           | Add `source_counts JSONB`; keep `UNIQUE(brand_normalized)`; new source-aware `upsert_watchlist_candidate` RPC         | Small review-queue table, not on the hot list. Additive column + RPC redefine; no index on any hot table.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **v196**                  | `scam_reports` (**HOT — read only**)                                 | New `aggregate_scam_report_brands(p_since,p_min_count)` `SECURITY DEFINER` aggregate RPC                              | **No column, no index, no write.** `GROUP BY brand_normalize(impersonated_brand)` bounded by `created_at >= p_since` (30d), served by the existing `idx_scam_reports_created` range scan → in-memory GROUP BY. **No all-time count is computed** (neutralises adversarial HIGH #1 — see §4a). Aggregation runs server-side so no hot rows ship to TS. `REVOKE EXECUTE FROM PUBLIC/anon/authenticated; GRANT service_role`. Run the `pg_stat_statements` shared_blks query + `get_advisors` **before** `FF_SCAM_BRANDS_DISCOVER` flips ON. |
| **v197**                  | `shopfront_clone_alerts` (not hot; v193: "a few hundred rows/month") | Add `target_brand_normalized TEXT` + partial btree `WHERE … IS NOT NULL`; redefine `list_clone_alerts_pending_triage` | Nullable no-default column = catalog-only, no rewrite. Small partial btree on a non-hot table is safe. `inferred_target_domain` untouched (ADR-0016 discriminator preserved). `severity` untouched (ADR-0015).                                                                                                                                                                                                                                                                                                                            |
| **v198** (Phase 3, gated) | `brand_register` (NEW, not hot)                                      | Create nightly-UPSERTed rollup keyed `canonical_brand`; deny-all RLS + service_role                                   | Follows `brand_stewardship_reports` (v166) / `clone_watch_monthly_brand_stats` (v193) precedent. Any future heavy index (trigram on `display_name`) lands **here**, never on `scam_reports`.                                                                                                                                                                                                                                                                                                                                              |

### 4a. Neutralisation of every HIGH-severity adversarial finding

1. **[A — HIGH] Nightly aggregate did a full-table seqscan via an all-time `cnt_all`.** _Neutralised:_ the aggregate RPC (`aggregate_scam_report_brands`) computes **only the 30-day windowed count**, served by `idx_scam_reports_created`. No all-time column is derived from a live scan; if an all-time figure is ever wanted it comes from a maintained counter, not a heap scan. The pre-flag Disk-IO check is mandatory.
2. **[B — HIGH] Write-side `canonical_brand` column + partial btree directly on hot `scam_reports`.** _Neutralised by architecture choice:_ this plan is **read-side only** — no column, no index, and no RPC redefinition on `scam_reports` or on the `create_scam_report` write path. The cross-stream join is achieved entirely through the read-side aggregate + `brand_aliases`.
3. **[B — HIGH] Public per-brand page publishing impersonation/clone claims from unscrubbed free-text = defamation.** _Neutralised:_ the only Phase-3 consumer is an **admin** surface. Any public brand-facing page is **out of scope** (§6) and, if ever built, is gated on the **#371 lawyer-vetted language pack applied to the publication itself** (not just outbound comms), requires human-reviewed `curation_status`, and **never renders `raw_brand`** — only canonical brands that resolved through the curated `brand_aliases` map.
4. **[B — HIGH] `active_impersonation_score` blends `clone_alert_count` into the composite that reorders clone triage (hides signal disagreement, ADR-0015).** _Neutralised:_ corroboration is exposed as **separate named columns** (`cross_stream_corroborated`, `corroboration_mention_count`) that add an `ORDER BY` term **only**; the deterministic clone `severity` is never mutated or folded into a composite. Phase 3's `cross_stream_priority` carries the same explicit invariant, and the constituent stream counts are surfaced individually so an operator always sees the disagreement.

Additionally (non-HIGH, addressed): C's inaccurate `idx_scam_reports_brand` justification is dropped — we rely solely on `idx_scam_reports_created` for the 30d range and run the Disk-IO query pre-flag. C's table **rename is dropped** (see §6). B's `UNIQUE(brand_normalized, source)` row-split is rejected in favour of C's single-row `source_counts` model.

---

## 5. Tests & docs to update

**Tests (vitest):**

- `packages/shopfront-glue/src/__tests__/gen-brand-aliases-seed.test.ts` — extend to cover the new `brand-resolver.ts` Adapters and assert the invariant that `deriveBrandKey` is derived from the canonical brand, not raw free-text. Keep `.ts`/`.mjs`/SQL `brand_normalize` byte-identical.
- `apps/web/__tests__/redditBrandsDiscover.test.ts` — repoint to the shared resolver; assert Reddit path calls `upsert_watchlist_candidate` with `p_source='reddit'`.
- `apps/web/__tests__/redditBrandsDiscover.test.ts` — **extend in place** (the scam source is folded into the same fn): cover the new `aggregate-scam-brands` step, the `p_source='scam_reports'` upsert, and the `source_counts` merge (asserting the scam source never clobbers Reddit counts). No separate `scamBrandsDiscover.test.ts` file.
- `apps/web/__tests__/brandStewardship.test.ts` + `brandStewardshipEmail.test.ts` — update fixtures for the shared resolver; assert `BSR-…` report-ref still derives from canonical.
- `apps/web/__tests__/cloneWatchFollowups.test.ts` — add `target_brand_normalized` backfill + triage-corroboration column assertions.
- `packages/scam-engine/src/__tests__/rpcs.smoke.test.ts` — run against a Supabase preview branch after v196/v197 to catch PL/pgSQL `search_path` / `#variable_conflict` bites in the new RPCs.

**Docs:**

- `docs/system-map/background-workers.md` — **update the existing `reddit-brands-discover` row** to note it now aggregates a second source (`scam_reports`) in the same weekly run; add (Phase 3) `brand-register-refresh` cron row. No new Phase-1 cron row.
- `docs/system-map/feature-flags.md` — add `FF_SCAM_BRANDS_SOURCE`, `FF_ANALYZE_CLONE_CITATION`, `FF_CLONE_TRIAGE_CORROBORATION`, `FF_BRAND_REGISTER`.
- `docs/system-map/database.md` — migration ledger v195–v198; `source_counts`, `target_brand_normalized`, `brand_register`.
- `docs/system-map/data-flows.md` — new cross-stream reinforcement flow.
- `docs/adr/0016-clone-detection-source-layering.md` — reconcile: canonical key is a shared **discriminator/join column**, not an alert-table union.
- `docs/adr/0015-clone-detection-signal-model.md` — note corroboration is a separate ordering term, severity untouched.
- `docs/adr/0018-proactive-onward-reporting.md` + `docs/plans/contact-feedback-and-onward-reporting.md` — canonical layer now consumed beyond the monthly POC.
- `ROADMAP.md` (line ~226 brand monitoring), `BACKLOG.md` — fold/supersede **#26, #31, #32**.
- **New** `docs/adr/0019-canonical-brand-key-seam.md` — the ADR in §7.
- **`CONTEXT.md` (was omitted — now required).** CONTEXT.md has **no glossary entry** for the canonical brand key; the nearest terms (`Brand Match` = a Clone Signal type; `AU Brand Watchlist` = the static array) are already bound to other concepts, so do **not** overload them. Add entries for: **canonical brand** (the `brand_normalize()` → `brand_aliases` → `canonical_brand` key, v174/v175); **brand register** (the `brand_register` rollup — explicitly contrasted against _Scam Cluster_ and ADR-0018's _Brand Stewardship ledger_, both rollups with different keys); **watchlist candidate** (a **brand pending curation review** — must be disambiguated from the existing _candidate domain_, which means a possible clone); **cross-stream corroboration** (the additive-ordering-term-only invariant, tied to ADR-0015). **Reuse the existing inline phrase "impersonated brand"** for the brand-being-impersonated concept (already settled across _Scam Report_ / _Scam Cluster_) — do not coin "targeted"/"victim" brand — and consider promoting it to a defined term while touching the file.

### 5a. Vocabulary reconciliation (reuse, do not re-coin)

| Concept in this plan                              | CONTEXT.md status                                       | Action                                             |
| ------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------- |
| the brand being impersonated                      | inline "impersonated brand" (Scam Report, Scam Cluster) | **Reuse** verbatim; optionally promote to glossary |
| clone-watch stream / `shopfront_clone_alerts`     | defined: _Clone Alert_, _Layer 0 / Clone-watch_         | **Reuse**                                          |
| static curated brand list                         | defined: _AU Brand Watchlist_                           | **Reuse** (do not alias to "canonical brand")      |
| canonical brand key (`canonical_brand`)           | **none**                                                | **NEW entry**                                      |
| per-brand rollup (`brand_register` / "brand 360") | none (nearest: Scam Cluster, Brand Stewardship ledger)  | **NEW entry**, contrasted against both             |
| watchlist candidate (brand pending review)        | collides with "candidate domain"                        | **NEW entry** + explicit disambiguation            |
| cross-stream corroboration                        | **none**                                                | **NEW entry** with the ADR-0015 invariant          |

---

## 6. NOT doing / out of scope

- **No merging of alert tables.** `brand_impersonation_alerts` (govt/bank/telco onward-report surface) and `shopfront_clone_alerts` (merchant clones) stay separate concerns per **ADR-0016**; overlap is expressed as the `target_brand_normalized` **discriminator column**, never a union table.
- **No write-side canonical column on any hot table.** No `canonical_brand` on `scam_reports`, no index on `scam_reports`, no `create_scam_report` RPC change. (Neutralises adversarial B-HIGH #2/#6.)
- **No blending of corroboration into deterministic clone severity** (ADR-0015).
- **No auto-promotion into `AU_BRAND_WATCHLIST`.** `legitimate_domains` correctness is a human judgment; promotion stays a human-gated PR. The candidate queue only _surfaces_ brands with `status='pending'`.
- **No table rename.** `reddit_watchlist_candidates` keeps its name (cosmetic-only; renaming a table read by live admin/Telegram surfaces mid-deploy is the DB-ahead-of-code skew the ship-order rule guards against). `brand_register`, not the candidate table, is the cross-source rollup, so the misnomer is harmless.
- **No public brand-360 page.** Any public brand-facing surface is deferred and, if ever built, must clear the **#371 lawyer-vetted publication** gate, require human-reviewed status, and never render raw brand text.
- **Defer `brand_register` if the deletion test fails.** Build it only when a concrete third consumer needs cached per-brand identity a read-time join on hot `scam_reports` cannot cheaply serve. Phases 1–2 already deliver watchlist curation and clone triage with no register.
- **No new normaliser / no pass-through wrapper.** The existing `brand_normalize` + `brand_aliases` layer _is_ the Seam; the resolver Module concentrates duplicated logic (passes the deletion test) rather than wrapping the Seam.

---

## 7. ADR skeleton — `docs/adr/0019-canonical-brand-key-seam.md`

```markdown
# 19. Canonical brand-key Seam across the three brand streams

- Status: proposed
- Date: 2026-07-06
- Deciders: <owner>

## Context

Ask Arthur has three brand-intelligence streams — reported-scams
(scam_reports.impersonated_brand), Reddit-intel
(reddit_post_intel.brands_impersonated[]), and clone-watch
(shopfront_clone_alerts.inferred_target_domain). Each stores brand identity
under a different key: two use raw free-text names, one uses a legitimate
domain. Three key functions (brand_normalize strip-to-[a-z0-9],
deriveBrandKey underscore form, inferred_target_domain) encode this
fragmentation, so a brand under active impersonation reinforces itself
nowhere. A canonical layer (brand_aliases + brand_normalize() +
resolve_brand(), v174/v175) exists but has zero code callers. scam_reports
is a designated hot write-frequent table; impersonated_brand and
brands_impersonated[] are un-scrubbed Claude/Sonnet output; ADR-0015 forbids
blending signals that hide disagreement; ADR-0016 requires discriminating,
not parallelising, the two alert surfaces.

## Decision

Adopt the existing canonical key — brand_normalize(raw) → resolve via
brand_aliases → canonical_brand — as the single join Seam, wired in
**read-side only**. A shared brand-resolver Module
(packages/shopfront-glue/src/brand-resolver.ts) owns resolveCanonical and a
new resolveCanonicalFromDomain Adapter that bridges the domain-keyed clone
stream onto the name key. The three key functions are reconciled by
promotion, not unification: brand_normalize becomes the join key,
deriveBrandKey is frozen as a display/report-ref slug, inferred_target_domain
stays the clone discriminator and gains a sibling target_brand_normalized
column. No canonical value is written onto any hot free-text column; all
canonical projections are derived by crons and are fully rebuildable.
Cross-stream reinforcement lands as: (1) multi-source watchlist_candidates via
source_counts JSONB on a single-row-per-brand key; (2) clone-alert triage
corroboration as a separate named ORDER-BY term that never mutates the
deterministic severity; (3) an optional, deletion-test-gated brand_register
rollup for a per-brand "brand 360" surface.

## Consequences

- The canonical vocabulary lives in one Module + one data home; the
  copy-pasted resolveCanonical closure is concentrated, not scattered.
- scam_reports write path is untouched; the only hot-table exposure is a
  nightly bounded, windowed, indexed read via a SECURITY DEFINER aggregate
  RPC — advisors + the Disk-IO query run before any consumer flag flips ON.
- Un-scrubbed brand text is gated behind brandNormalize + denylist +
  threshold≥3 + human status='pending'; nothing brand-facing publishes
  without the #371 language gate.
- brand_stewardship_reports (v166) is superseded as the canonical POC; the
  register (if built) folds BACKLOG #26/#31/#32.

## Alternatives considered

- Write-side canonical column on all three streams (rejected): adds a
  column+index+backfill and an RPC change to the hot scam_reports write path,
  splits each brand into two candidate rows, and creates a write-side
  staleness problem — all for value derivable read-side.
- Live VIEW / MATERIALIZED VIEW over scam_reports (rejected): re-scans the hot
  table per pageview / cannot carry human-curation state.
- Merging the two alert tables (rejected): violates ADR-0016.
```

---

## 8. Open questions for the user

1. **Register trigger:** is there a concrete near-term consumer for a per-brand "brand 360" surface (admin page or B2B API)? If not, Phase 3 stays deferred and Phases 1–2 ship the whole win. Which is it?
2. **Scam-source cadence (resolved by fold-in):** the `scam_reports` aggregation now rides the existing `reddit-brands-discover` weekly slot (`0 7 * * 1`), so no separate cadence decision is needed. Revisit only if the sources ever need to diverge (then split into a sibling fn).
3. **Clone→candidate loopback:** should open clone alerts also upsert `source='clone_watch'` rows into `watchlist_candidates` (fully bidirectional reinforcement), or keep clone-watch read-only against the queue for now?
4. **Unmerged worktree branches:** `partner-data/brand-alias-layer` and `partner-data/brand-stewardship-summary` are 2 commits ahead of `main` and hold unmerged canonical-layer wiring. Should this plan reconcile/rebase those first, or explicitly supersede them?
5. **known_brands RLS:** `known_brands` appears to have no RLS policy (created pre-rule in v49). Fold a policy into v195 while we touch it, or leave as a separate hygiene item?
6. **Breach Defence coordination:** the paused Phase-16 suite reuses `brand_impersonation_alerts` with all flags OFF. Confirm the canonical-key work should treat that schema as frozen (no key changes) so it isn't stranded on resume?
