# Breach Defence Suite — Implementation Plan

> **Source spec:** the implementation-ready Breach Defence Suite spec (F1–F11, §1–§12) attached at project kickoff. That document is the **detailed reference** for every PR. This plan is the **delta** between that spec and the codebase as it exists today, plus the sequenced build order. The spec itself is preserved in the PR description history of #46.

---

## 1. Context

**Why.** Ask Arthur today is a scam-detection product (URLs / SMS / image scans) but holds no durable position on what happens _after_ a breach occurs — second-wave phishing, identity recovery, brand impersonation, class-action awareness, B2B exposure intel. The Breach Defence Suite covers that white space with 11 connected features built around a public Australian Breach Index spine.

**Outcome.** A monetisable pillar that complements the existing scam-engine: free consumer surfaces (Breach Index, recovery wizards, password-rotate deep links) drive top-of-funnel; B2B endpoints (`/api/v1/breach/exposure`, embeddable Breach Score badge, brand watch dashboards) drive revenue. ~8–12 weeks single-engineer effort across 19 PRs.

**Source of truth.** The spec attached at project kickoff is the per-feature reference (data models, route shapes, code stubs, definition-of-done). This plan adjusts that spec for codebase reality and locks the sequence.

---

## 1a. Build status (live)

> **🛑 Work paused 2026-04-29 after PR 2.** User decision before starting PR 3 — see "Pause notes" below. Schema is live in prod; nothing else has shipped. Resume by re-reading the pause notes and §1b "Open question that triggered the pause" first.

| PR  | Title                                         | Status                                          | Merge commit    |
| --- | --------------------------------------------- | ----------------------------------------------- | --------------- |
| 1   | scaffold breach-defence + cross-cutting setup | ✅ shipped 2026-04-29                           | `5da00e0` (#46) |
| 2   | migration v80 — breach index spine            | ✅ shipped 2026-04-29                           | `10cc7a5` (#47) |
| 3   | OAIC NDB scraper                              | ⏸ paused (data-availability question — see §1b) | —               |
| 4   | hashBreachIdentifier + lookup RPC client      | ⏸ paused                                        | —               |
| 5   | admin UI for editing breaches                 | ⏸ paused                                        | —               |
| 6   | public /breach + /breach/[slug] pages         | ⏸ paused                                        | —               |
| 7   | /api/breach/lookup + 30-breach backfill       | ⏸ paused                                        | —               |
| 8   | F2 — extension breach warning                 | ⏸ paused                                        | —               |
| 9   | F3 — auto-rotate deep links                   | ⏸ paused                                        | —               |
| 10  | F5 — B2B exposure endpoint                    | ⏸ paused                                        | —               |
| 11  | F1 — DNS drift                                | ⏸ paused                                        | —               |
| 12  | F8 — typosquat                                | ⏸ paused                                        | —               |
| 13  | F9 — Breach Score                             | ⏸ paused                                        | —               |
| 14  | F6 — class actions                            | ⏸ paused                                        | —               |
| 15  | F10 — recovery playbooks                      | ⏸ paused                                        | —               |
| 16  | F11 — second-wave correlation                 | ⏸ paused                                        | —               |
| 17  | F7 — Aftermath companion page                 | ⏸ paused                                        | —               |
| 18  | ransomware DLS scrapers                       | ⏸ paused (was already Tor-decision-blocked)     | —               |
| 19  | docs pages                                    | ⏸ paused                                        | —               |

## 1b. Pause notes (read this before resuming)

**What is shipped:**

- PR 1 (`5da00e0`, #46): `@askarthur/breach-defence` package, 11 `NEXT_PUBLIC_FF_BD_*` flags (all default OFF), `checkBreachDefenceRateLimit` with 3 buckets, `turbo.json` env vars, scraper subdir convention in `CONVENTIONS.md`, plan pointer in `CLAUDE.md`.
- PR 2 (`10cc7a5`, #47): migration v80 + v80 search-path fix applied to prod project `rquomhcgnodxzkhokwni`. Tables `breaches`, `breach_victims_index`, `breach_sources_raw` live with RLS, indexes, trigger fn. RPC `check_breach_exposure(p_identifier_type TEXT, p_identifier_hash BYTEA)` granted to `authenticated, anon`.
- All flags default OFF — no consumer-visible surfaces are exposed.

**State of the database:** Schema only, zero rows. The `breaches` table is empty. `check_breach_exposure` returns no rows for any input. Nothing breaks if this stays paused indefinitely.

**Open question that triggered the pause — OAIC NDB data availability:**
The plan and spec assumed PR 3's OAIC NDB Python scraper would backfill ~30 historical AU breaches (Optus, Medibank, Latitude, Genea, Gelatissimo, etc.) into the `breaches` table for the public `/breach` index. After investigation: **the OAIC does not publish per-incident NDB filings publicly** — those are confidential between the regulated entity and the regulator. What OAIC publishes is aggregate 6-monthly statistical reports (sector breakdowns, root causes, data-class counts) at oaic.gov.au. Useful for dashboards/advisors, but won't yield per-breach records.

This invalidates the user's earlier choice ("scrape OAIC NDB first to backfill") in the plan-time decision. Three paths forward when resuming, presented to the user:

1. Build OAIC NDB scraper anyway for aggregate stats + add a separate seed-breaches script with curated 10–30 well-known cases.
2. Build OAIC NDB scraper now (aggregate only), defer 30-breach backfill until admin UI (PR 5) lets editors hand-curate.
3. Skip OAIC NDB entirely for now, jump straight to the curated seed file.

User opted to stop and revisit later rather than pick one. Plan stays mid-flight; no PR 3 branch was created.

**To resume:** re-read this section + §1c "Lessons learned" + the source spec's F1–F11 catalogue (PR #46 description). Decide on one of the three paths above. Then continue from PR 3 (or jump if path 3 is chosen).

**To abandon entirely:** the schema is already in prod and harmless. To unship: drop the four objects per the rollback block in v80's commit message (`DROP FUNCTION check_breach_exposure ...; DROP TABLE breach_sources_raw, breach_victims_index, breaches CASCADE; DROP FUNCTION update_breaches_updated_at`). The 11 feature flags are dormant — leave them or remove via a small follow-up to `feature-flags.ts`/`turbo.json`/`rate-limit.ts`.

## 1c. Lessons learned (apply on resume)

### Lessons from PRs 1–2 — apply on every subsequent PR

- **Single-file commits avoid lint-staged contamination.** PR 1's first commit pulled 4 untracked SPF-campaign image files into the diff via lint-staged's internal stash mechanism, despite explicit `git add <path>`. The fix-up commit (1 file) had no recurrence. Strategy: **stage the smallest viable file set per commit**; for migrations especially, isolate the SQL into its own commit.
- **`autofix.ci` is failing on every PR.** Pre-existing config issue — the action errors with `not allowed to modify the .github directory`. Confirmed red on PRs #43, #44, #45, #46. Until someone fixes the workflow, every PR must be merged via `gh pr merge --squash --admin` with the autofix red flagged in the PR body. Track a separate one-line PR to fix the workflow's `.github` exclusion.
- **Concurrent agents touch the working tree.** During PR 1 a parallel agent moved HEAD from `breach-defence/scaffold-package` to `content/spf-illustrations-embed` mid-session. Before any branch operation: run `git branch --show-current` AND `ls .git/index.lock`. If lock exists, another agent is operating — wait, don't force.
- **Pnpm-lock.yaml has a pending one-time reformat.** Project declares `packageManager: "pnpm@10.5.2"` but lockfile was emitted by older pnpm. PR 1 absorbed the cosmetic reformat (~14k lines), so PR 2+ should see only functional lockfile changes.
- **Stashes on other agents' branches stay in `git stash list`.** Two stashes I created during PR 1 (`wip-content-spf-claudemd`, `wip-spf-illustrations-embed-other-agent`) belong to other agents' branches. Don't `git stash pop` them — those agents need to recover them on their own branches.
- **Concurrent agents move HEAD between `checkout -b` and `commit`.** During PR 2 a parallel agent moved HEAD from `breach-defence/migration-v80` to `main` between my `git checkout -b` and `git commit`. The commit landed on local `main` instead of the feature branch. Recovery: `git update-ref refs/heads/<feature> <my-commit>` to relocate, then `git update-ref refs/heads/main <origin-main-sha>` to clean up. Non-destructive. Verify via `git branch --show-current` AND check the `[branch hash]` line of `git commit` output — if the bracket says `[main ...]` instead of `[breach-defence/... ...]`, recover before pushing.
- **Migration applied via MCP creates a `supabase_migrations` row even on idempotent re-runs.** Each `mcp__supabase__apply_migration` call adds a record. For follow-up DDL fixes (like the search_path patch in PR 2), use a distinct migration name (`v80_breach_index_search_path_fix`) and update the source-of-truth `.sql` file in git so a fresh DB rebuild from git arrives at the final state in one apply.
- **Use distinct ERROR-level filtering on advisors.** PR 2's advisor output was 164k chars (security) + 385k chars (performance). Pipe through `python3 -c "import json; ..."` to grep for `breach`-related items + count by level. Zero new ERROR-level items = clear to merge per CLAUDE.md. WARN/INFO that match pre-existing project patterns (`auth_rls_initplan`, `multiple_permissive_policies`, `unused_index` on day-zero indexes) are deferred to BACKLOG.md "Database Hygiene".

---

## 2. Codebase reality vs spec — corrections to apply

The spec was written from research; verified against the repo on 2026-04-28. These are the **deltas every PR must respect**:

| #   | Spec claim                                                                                                 | Reality                                                                                                                                      | Action                                                                                                                                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | "current migration is v55–v56, new ones are v60+"                                                          | Latest is **v79** (`supabase/migration-v79-onboarding-rpc.sql`)                                                                              | Renumber: v60→**v80**, v61→v81, v62→v82, v63→v83, v64→v84, v65→v85, v66→v86. See §3.                                                                                                                              |
| 2   | New `breach-defence` package gets its own Inngest client (`packages/breach-defence/src/inngest/client.ts`) | Shared client already at `packages/scam-engine/src/inngest/client.ts:1-3`; route at `apps/web/app/api/inngest/route.ts:2` already imports it | **Reuse** existing client — `import { inngest } from "@askarthur/scam-engine/inngest/client"`. Do not create a new one.                                                                                           |
| 3   | `checkFormRateLimit(ip, { key, max, windowSeconds })`                                                      | Actual signature at `packages/utils/src/rate-limit.ts:189`: `checkFormRateLimit(ip, failMode)` — fixed `slidingWindow(5, "1 h")`             | The spec's per-endpoint custom limits won't compile. **Either** (a) extend `rate-limit.ts` to accept a named bucket spec, **or** (b) inline an Upstash `Ratelimit` for the new endpoints. Recommend (a) — see §5. |
| 4   | Production rate limit "fails open"                                                                         | Reality at `rate-limit.ts:98` — defaults to **fail-closed in production**, fail-open in dev. CLAUDE.md is wrong.                             | No code change; cross out the risk in spec §10.                                                                                                                                                                   |
| 5   | `scrubPII` is at `packages/scam-engine/src/pii.ts`                                                         | Actually at `packages/scam-engine/src/pipeline.ts:43-52`                                                                                     | Update imports to `@askarthur/scam-engine/pipeline` (or re-export from `pii.ts` shim if cleaner).                                                                                                                 |
| 6   | New helper `hashIdentifier(type, raw)` in `packages/breach-defence/src/breach-index.ts`                    | Name collision: `packages/utils/src/hash.ts:5-11` already exports `hashIdentifier(ip, ua)` for analytics                                     | **Rename to `hashBreachIdentifier`** (or scope: `breachIndex.hashIdentifier`). Plan-wide find/replace before implementation.                                                                                      |
| 7   | `set_updated_at()` is a global trigger function                                                            | Pattern is **per-table trigger fn** (e.g. `update_organizations_updated_at` in v55:399). No global helper.                                   | Each new table gets its own trigger function: `update_breaches_updated_at()`, `update_class_actions_updated_at()`, etc.                                                                                           |
| 8   | OpenAPI spec lives at `docs/openapi.yaml` and the route generates from it                                  | Route at `apps/web/app/api/v1/openapi.json/route.ts:18-197` returns a **hardcoded JS object**. YAML is stale doc-only.                       | Append `/api/v1/breach/exposure` schema **directly to the route file's hardcoded spec object**, then mirror into `docs/openapi.yaml` as docs.                                                                     |
| 9   | Python scrapers organized as flat top-level files                                                          | Confirmed flat: `pipeline/scrapers/crtsh.py`, `abuseipdb.py`, etc.                                                                           | **Decision (user-confirmed):** introduce subdirs for grouped scrapers (`ransomware_dls/`, `oaic_ndb/`, `class_actions/`) — invoke as `python -m ransomware_dls.dragonforce`. Update `CONVENTIONS.md` in PR 1.     |
| 10  | `verified_scams.metadata JSONB` exists                                                                     | Does **not** exist. v66 (renumbered v86) must `ADD COLUMN`.                                                                                  | Confirm — spec already does this; just renumber.                                                                                                                                                                  |
| 11  | Admin UI gate via `user_profiles.role='admin'` direct check                                                | Pattern is `requireAdmin()` from `@/lib/adminAuth` (used by `/admin/costs`, `/admin/brand-alerts`, etc.)                                     | All new admin pages use `await requireAdmin()` at the top. RLS policy can still reference `user_profiles.role` (that's how `requireAdmin` resolves).                                                              |
| 12  | Spec assumes `breaches`, `breach_*`, `class_actions`, `watched_*` tables don't exist                       | Confirmed clean — no collision.                                                                                                              | None.                                                                                                                                                                                                             |
| 13  | Spec mentions "F4 backfill: 30 historical breaches (you provide CSV)"                                      | **User decision at plan-time:** scrape OAIC NDB published reports first, then human-review/publish. **Invalidated 2026-04-29** — see §1b.    | OAIC publishes only aggregate stats, not per-incident filings. Three forward paths captured in §1b.                                                                                                               |

---

## 3. Migration renumbering map

The spec's migration numbers are off by 20. Use these throughout:

| Spec | New     | Subject                                                                          |
| ---- | ------- | -------------------------------------------------------------------------------- |
| v60  | **v80** | breaches + breach_victims_index + breach_sources_raw + check_breach_exposure RPC |
| v61  | **v81** | watched_domains + dns_snapshots + dns_drift_events                               |
| v62  | **v82** | watched_brands + typosquat_candidates                                            |
| v63  | **v83** | class_actions + class_action_subscriptions                                       |
| v64  | **v84** | recovery_playbooks + recovery_runs                                               |
| v65  | **v85** | breach_scores                                                                    |
| v66  | **v86** | `verified_scams.metadata JSONB` + index on `metadata->>'breach_slug'`            |

All migrations idempotent (`CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS … CREATE POLICY …`) per CLAUDE.md ship-workflow rule. Apply via `mcp__supabase__apply_migration` on project `rquomhcgnodxzkhokwni`. Run `mcp__supabase__get_advisors` after each.

---

## 4. Locked architectural decisions

These supersede any conflicting language in the spec:

1. **Inngest client** — single shared client at `packages/scam-engine/src/inngest/client.ts`. New package re-exports it for ergonomics: `packages/breach-defence/src/inngest/client.ts` is just `export { inngest } from "@askarthur/scam-engine/inngest/client";`.

2. **Identity-hash helper name** — `hashBreachIdentifier(type, raw)` in `packages/breach-defence/src/breach-index.ts`. Existing `hashIdentifier(ip, ua)` in `@askarthur/utils/hash` is unrelated and stays.

3. **Rate limiting for new endpoints** — extended `packages/utils/src/rate-limit.ts` with a `checkBreachDefenceRateLimit(bucket, identifier)` helper (added in PR 1) returning the same `RateLimitResult`. Existing `checkFormRateLimit` stays unchanged. Buckets: `bd_lookup` (5/hr), `bd_extension` (60/min), `bd_b2b` (30/min).

4. **OG images** — match `apps/web/app/api/og/scan/route.tsx` pattern (edge runtime, `ImageResponse` from `next/og`). New file at `apps/web/app/api/og/breach/[slug]/route.tsx` with the dynamic param.

5. **Admin pages** — every new page under `apps/web/app/admin/breaches/*` calls `await requireAdmin()` at the top of the server component. Mirrors `apps/web/app/admin/costs/page.tsx`.

6. **Scraper organization (user-confirmed)** — grouped scrapers go in subdirs:

   ```
   pipeline/scrapers/
     ransomware_dls/
       __init__.py
       common.py        # Tor circuit + AU-victim filter
       dragonforce.py
       akira.py
       …
     oaic_ndb/
       __init__.py
       oaic_ndb.py
     class_actions/
       __init__.py
       auslii.py
       oaic_complaints.py
       firms.py
   ```

   Existing flat scrapers (`crtsh.py`, `abuseipdb.py`, …) **stay flat** — only new groups go in subdirs. Convention documented in `CONVENTIONS.md` (PR 1).

7. **Backfill source (user-confirmed at plan-time, invalidated 2026-04-29)** — see §1b. The OAIC scraping path doesn't yield per-incident records. Pick one of the three paths in §1b before resuming.

8. **Tor scraping for ransomware DLS (PR 18)** — defer the VPS-vs-hosted-proxy decision until PR 18 is up. Plan assumes `RANSOMWARE_DLS_TOR_PROXY_URL` env var; PR 18 picks the provider. Block PR 18 on this resolution.

9. **F8 cost cap** — typosquat WHOIS calls hit the existing paid `WHOIS_API_KEY`. Add a per-customer daily-USD circuit breaker in `cost-telemetry.ts` (call it from the typosquat cron). Default cap **$5/customer/day**; pause the per-customer permutation cron when tripped. Logged via existing `logCost()` machinery.

10. **F1 DNS resolver** — Node `dns/promises` stdlib per spec. Vercel serverless can be flaky on UDP DNS, so wrap in a try/catch + retry with the second resolver in the rotation list. Defer DNS-as-a-service (Cloudflare DoH) until measured pain.

---

## 5. Critical files (where new code lands or which existing files get touched)

**New package (PR 1, shipped):**

- `packages/breach-defence/package.json` — matches `packages/scam-engine/package.json` style
- `packages/breach-defence/src/{index.ts, inngest/client.ts}` — placeholder + Inngest re-export
- Future PRs will add: `breach-index.ts`, `dns-drift.ts`, `typosquat.ts`, `auda-takedown.ts`, `class-actions.ts`, `recovery-engine.ts`, `breach-score.ts`, `one-pwd-rotate.ts`, `exposure-api.ts`
- Future Inngest functions: `dns-drift-cron.ts`, `typosquat-cron.ts`, `breach-index-sync.ts`, `class-actions-sync.ts`, `breach-score-compute.ts`, `second-wave-correlate.ts`
- `packages/breach-defence/tests/*.test.ts` — vitest scripted with `--passWithNoTests` until tests exist

**Existing files modified in PR 1:**

- `packages/utils/src/rate-limit.ts` — added `checkBreachDefenceRateLimit` + `BdBucket` type
- `packages/utils/src/feature-flags.ts` — added 11 `bdXxx` flags
- `turbo.json` `globalEnv` — added 11 `NEXT_PUBLIC_FF_BD_*` + 4 server-only env vars
- `CLAUDE.md` — Quick Reference row pointing to this plan + breach-defence row in Project Structure tree
- `CONVENTIONS.md` — Python scrapers layout subsection

**Files awaiting modification in later PRs:**

- `apps/web/app/api/inngest/route.ts` — concat new functions into `serve()` array
- `apps/web/vercel.json` — append cron entries for `/api/cron/breach-score-recompute` and `/api/cron/breach-index-publish`
- `apps/web/app/api/v1/openapi.json/route.ts` — append `/api/v1/breach/exposure` path schema
- `apps/web/app/api/breach-check/route.ts` (PR 9) — extend response with `rotateActions` array
- `pipeline/scrapers/requirements.txt` — add `pdfplumber` + Tor + dnstwist deps as PRs land

**Existing utilities to reuse (do NOT reinvent):**

- `validateApiKey` from `apps/web/lib/apiAuth.ts:98-196` (B2B auth — F5)
- `requireAdmin` from `apps/web/lib/adminAuth.ts:74-80` (admin pages)
- `scrubPII` from `packages/scam-engine/src/pipeline.ts:43-52` (pre-store hygiene)
- `extractDomain` from `packages/scam-engine/src/url-normalize.ts:95-104` (extension lookup)
- HIBP graceful-degradation pattern from `packages/scam-engine/src/hibp.ts:35-39, 47-51`
- `logCost` from `apps/web/lib/cost-telemetry.ts:51-81`
- `bulk_upsert_urls` RPC pattern from `pipeline/scrapers/common/db.py:39-100` for new scrapers
- `showWarningOverlay` shadow-DOM ribbon pattern from `apps/extension/src/entrypoints/url-guard.content.ts:18-50` (F2 ribbon)
- `ImageResponse` OG pattern from `apps/web/app/api/og/scan/route.tsx`

---

## 6. Build sequence — 19 PRs

Each row = one PR. Migration numbers updated. Spec section in column 3 = where to read for the per-PR detail.

| PR  | Title                                                                                     | Spec ref       | Critical adjustments                                                                                                                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | feat(bd): scaffold breach-defence package + scraper subdir convention                     | §3, §9         | New package.json copying scam-engine layout. Re-export Inngest client. Update CONVENTIONS.md to bless `pipeline/scrapers/<group>/` subdirs. Empty placeholder `index.ts`.                                                                                                                     |
| 2   | feat(bd): migration v80 — breach index spine                                              | §2.1, §2.2, F4 | Renumber v60→**v80**. Per-table `update_breaches_updated_at()` trigger fn. RPC `check_breach_exposure(p_identifier_type TEXT, p_identifier_hash BYTEA)`. RLS as spec. Apply via MCP; run advisors.                                                                                            |
| 3   | feat(bd): OAIC NDB scraper                                                                | F4 backfill    | New `pipeline/scrapers/oaic_ndb/oaic_ndb.py`. Inserts into `breach_sources_raw` (unverified) — does **not** publish. Workflow `.github/workflows/scrape-oaic-ndb.yml` weekly. Adds `pdfplumber` to requirements.txt. **Note: aggregate stats only — see §1b for backfill strategy decision.** |
| 4   | feat(bd): hashBreachIdentifier helper + lookup RPC client                                 | §2.2, F4       | `packages/breach-defence/src/breach-index.ts`. Test against the v80 RPC. Note rename from spec's `hashIdentifier`.                                                                                                                                                                            |
| 5   | feat(bd): admin UI for editing breaches                                                   | §10 risk #2    | `/admin/breaches/list`, `/admin/breaches/[id]/edit`, `/admin/breaches/sources/review` (verify raw → publish). `requireAdmin()` gate. Includes `is_redacted` toggle for court-suppressed cases (Genea precedent).                                                                              |
| 6   | feat(bd): public /breach + /breach/[slug] pages with ISR                                  | F4             | `revalidate = 60` for index, 300 for detail. `generateStaticParams` from published rows. JSON-LD Article schema. Sitemap.xml entry.                                                                                                                                                           |
| 7   | feat(bd): /api/breach/lookup endpoint + 30-breach backfill review                         | F4             | Calls `check_breach_exposure` RPC. Uses `checkBreachDefenceRateLimit` `bd_lookup` (5/hr/IP). Admin reviews scraper output, hand-augments well-known cases (Optus/Medibank/Latitude/Genea), flips `is_published=true`.                                                                         |
| 8   | feat(bd): F2 — extension breach warning ribbon                                            | F2             | New WXT entrypoint `breach-warning.content.ts` + `wxt.config.ts` flag. Reuses URL Guard shadow-DOM pattern. CORS-enabled `/api/breach-extension` endpoint, 60 rpm/IP via `checkBreachDefenceRateLimit` `bd_extension`.                                                                        |
| 9   | feat(bd): F3 — auto-rotate deep links                                                     | F3             | Extend `apps/web/app/api/breach-check/route.ts` response with `rotateActions: [{manager, domain, deepLink}]`. UI button list on existing breach-check page. `buildRotateLink` in `one-pwd-rotate.ts`.                                                                                         |
| 10  | feat(bd): F5 — B2B exposure endpoint + OpenAPI update                                     | F5             | `/api/v1/breach/exposure` POST, `validateApiKey` gate, max 500 items, 32-byte b64 SHA-256 hashes. **Append schema directly to** `apps/web/app/api/v1/openapi.json/route.ts` (hardcoded — see correction #8). Customer doc page at `/docs/api/breach-exposure`.                                |
| 11  | feat(bd): F1 — DNS drift (migration v81 + Inngest cron + dashboard UI)                    | F1             | Migration v81. Inngest function uses shared client, 6h cron, concurrency 5. `/dashboard/domains` page. Email template `DomainWatchAlert.tsx`. Webhook fanout via existing pg_net pattern (CLAUDE.md).                                                                                         |
| 12  | feat(bd): F8 — typosquat (migration v82 + Inngest + /dashboard/brands UI + auDA template) | F8             | Migration v82. Permutation engine port of dnstwist (TS). Cost cap circuit breaker calling `logCost` — pause per-brand cron at $5/day. WHOIS enrichment via existing paid key. auDA complaint generator.                                                                                       |
| 13  | feat(bd): F9 — Breach Score (migration v85 + Inngest + SVG endpoint + embed bootstrapper) | F9             | Migration v85 (renumbered). Score factors pull from F4/F1/F8 tables — depends on PRs 2/11/12. SVG endpoint at `/api/breach-score/[domain]`. Embed JS at `apps/web/public/scripts/breach-badge.js`. Public landing `/breach-score`.                                                            |
| 14  | feat(bd): F6 — class actions (migration v83 + AusLII scraper + subscribe flow)            | F6             | Migration v83. Python scrapers in `pipeline/scrapers/class_actions/` subdir (auslii, oaic_complaints, 5 firm portals). Daily GH workflow. Anonymous-subscribe via SHA-256 email + double opt-in. Affiliate `?ref=arthur` on registration links.                                               |
| 15  | feat(bd): F10 — recovery playbooks (migration v84 + 15 playbooks + wizard UI)             | F10            | Migration v84. 15 playbook JSON files in `packages/breach-defence/playbooks/`. Seed at deploy via admin script. Wizard UI components. State persistence in `recovery_runs`. Anonymous + auth flows.                                                                                           |
| 16  | feat(bd): F11 — second-wave correlation (migration v86 + Inngest cron)                    | F11            | Migration v86 — `verified_scams.metadata JSONB` + GIN index on `metadata->>'breach_slug'`. 15-min cron correlates last 200 verified scams against active breaches by entity_name + domain + 2nd-wave keywords.                                                                                |
| 17  | feat(bd): F7 — Aftermath companion page wiring                                            | F7             | Pure UI wiring: `BreachHero`, `BreachLookupForm`, `RecoveryCTA`, `SecondWaveFeed`, `ClassActionCard`, `BreachSubscribeForm` components on `/breach/[slug]`. Depends on PRs 14/15/16 being live. OG image route at `/api/og/breach/[slug]`.                                                    |
| 18  | feat(bd): GitHub Actions for ransomware DLS scraping                                      | §7, risk #1    | 15+ scrapers in `pipeline/scrapers/ransomware_dls/`. **Blocked on Tor proxy decision** — VPS vs hosted (`Tor.taxi`/`Onion.live`). 30-min cron, gated by `vars.ENABLE_DLS_SCRAPER`.                                                                                                            |
| 19  | feat(bd): documentation pages                                                             | F5, F9         | `/docs/api/breach-exposure`, `/breach-score` landing, sitemap updates, R&D documentation in CHANGELOG.                                                                                                                                                                                        |

**Sequencing notes:**

- PRs 1–7 = "spine sprint" — no other feature unblocks until v80 + lookup endpoint exist.
- PRs 8/9/10 = parallel after spine (all depend only on v80).
- PRs 11/12 = parallel — independent of each other.
- PR 13 (Breach Score) depends on 2/11/12 (joins their tables for factor inputs).
- PRs 14/15/16 = parallel after spine.
- PR 17 (Aftermath UI) is the integration PR — wait for 14/15/16.
- PR 18 has external blocker (Tor decision) — pull forward only when resolved.
- PR 19 = docs cleanup at the end.

---

## 7. Cross-cutting work to do once

These show up in multiple PRs but only need doing once:

- **`turbo.json` globalEnv additions** (PR 1, ✅ done): all 11 `NEXT_PUBLIC_FF_BD_*` flags + 4 server-only env vars in one diff. Subsequent PRs just consume them.
- **`packages/utils/src/feature-flags.ts`** (PR 1, ✅ done): all 11 typed flags added.
- **`packages/utils/src/rate-limit.ts`** (PR 1, ✅ done): `checkBreachDefenceRateLimit(bucket, identifier)` added with three buckets.
- **`CONVENTIONS.md`** (PR 1, ✅ done): documented `pipeline/scrapers/<group>/` subdir convention.
- **CLAUDE.md** (PR 1, ✅ done): Quick Reference row added pointing to this plan.

---

## 8. Open items requiring user decision before specific PRs land

| Item                                                                                                                                                     | Blocks PR                                         | When to decide                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **F4 backfill source — three paths in §1b**                                                                                                              | PR 3 onward                                       | **Now (the pause-trigger)** — see §1b.                                                                                   |
| Tor scraping infra: VPS vs hosted proxy                                                                                                                  | PR 18                                             | When PR 17 is mergeable.                                                                                                 |
| Privacy-impact assessment for AU document hashing (Medicare/TFN/passport)                                                                                | PR 7 (`/api/breach/lookup` accepts identity docs) | **Before PR 7 launch** — block PR 7 launch behind email-only lookup until counsel signs off, then enable identity types. |
| Recovery playbook editorial review (IDCare partnership?)                                                                                                 | PR 15                                             | Engineer-drafts first; flag IDCare review as post-launch task.                                                           |
| F5 B2B pricing tier — keep existing Free/Pro/Enterprise call counts?                                                                                     | PR 10                                             | Confirm before building docs page. Current default in `validateApiKey`: 25/100/5000.                                     |
| Court-suppression-order admin UX (Genea precedent — `is_redacted=true` flip path)                                                                        | PR 5                                              | Already required by spec; surface as a top-level "Suppress" button on the edit page.                                     |
| Class-action firm-portal scrapers — which 5 firms? Spec lists Slater & Gordon, Maurice Blackburn, Phi Finney McDonald, Quinn Emanuel, Centennial Lawyers | PR 14                                             | Confirm list during PR 14; check ToS first.                                                                              |

---

## 9. Per-PR ship checklist (every PR follows CLAUDE.md "Standard ship workflow")

Per CLAUDE.md §"Standard ship workflow (code + schema)":

1. Branch off `main` — `git fetch origin && git checkout main && git pull --ff-only && git checkout -b breach-defence/<pr-name>`
2. `pnpm turbo typecheck` (and `pytest pipeline/scrapers/` if Python touched)
3. Stage explicit files (never `git add -A` — there are in-progress trees per `git status`)
4. HEREDOC commit message with WHY + migration version + Co-Authored-By trailer
5. Push to feature branch (rebase-merge if behind main)
6. Apply migration via `mcp__supabase__apply_migration` on project `rquomhcgnodxzkhokwni` (idempotent SQL only)
7. Run `mcp__supabase__get_advisors` (security + performance) — fix new ERRORs, document pre-existing
8. `gh pr create` with body listing migration versions + post-merge verification checklist
9. Wait for green Vercel preview
10. `gh pr merge --squash --delete-branch=false` (no `--admin` unless CI flake demonstrably unrelated — currently `autofix.ci` is permanently red, so all PRs need `--admin` until that workflow is fixed)
11. Verify production deploy via `gh run list --branch main --limit 1`; smoke-test touched surface

---

## 10. End-to-end verification

**After spine sprint (post-PR 7):**

```bash
# Typecheck whole monorepo
pnpm turbo typecheck

# Unit tests
pnpm --filter @askarthur/breach-defence test
pnpm --filter @askarthur/web test

# Spine smoke test
curl -X POST https://askarthur.au/api/breach/lookup \
  -H 'content-type: application/json' \
  -d '{"identifier":"known-seeded@example.com","type":"email"}'
# expect: { matches: [{ breach_slug: "...", ... }] }

# Public page
curl https://askarthur.au/breach          # 200, lists ≥30 published breaches
curl https://askarthur.au/breach/optus-2022-09  # 200, structured page

# Advisors
mcp__supabase__get_advisors --project rquomhcgnodxzkhokwni --type security
mcp__supabase__get_advisors --project rquomhcgnodxzkhokwni --type performance
```

**Per-feature smoke after each PR:** see "Definition of done" in the source spec for the corresponding F#.

**Full integration check (post-PR 17):**

- Visit `/breach/medibank-2022-10` — page renders with hero, lookup form, recovery CTA, second-wave feed, class action card, subscribe form
- All Plausible events fire (check live site)
- Embed `breach-badge.js` on a test domain — SVG renders A+→F grade
- B2B partner integration via `/api/v1/breach/exposure` returns expected shape

**Cost monitoring:** watch `cost_telemetry` daily for `feature='breach_defence'` rows; ensure typosquat/WHOIS spend stays under per-customer cap; weekly digest goes to `TELEGRAM_ADMIN_CHAT_ID`.

---

## 11. What's deliberately out of scope (per spec §12)

- Stealer-log monitoring (Hudson Rock partnership)
- IAB chatter monitoring (partner-only)
- Honeytoken-as-a-service (separate spec)
- Breach Inbox (large SMTP infra)
- AU ID Watch (needs legal review first)
- Family-protection mode (orthogonal — already in v33)
- Help-desk vishing simulation (Apate.ai partnership)

These get separate scoping docs when prioritised.
