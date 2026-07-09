# Arthur's Watch — ultrareview remediation plan

> Fixes for the 2026-07-09 5-lens local ultrareview of the competitor-newsletter
> intelligence feature (branch `reddit-intel/arthurs-watch-plan`, target
> `6159334`). Ordered so the feature is best-practice + correct before the PR
> merges. 0 blockers; 4 HIGH, 6 MEDIUM, 5 LOW + a docs-drift batch.
>
> **Nothing is live yet** (branch unmerged, flag on but code not deployed), so
> none of these have caused harm — but H1–H4 must land before merge.

## A. Schema — migration v214 (attempt marker)

**Fixes H2** (zero-yield re-extraction leak). Mirror the `feed-items-embed`
done-marker pattern: put the marker on the row itself.

- `ALTER TABLE public.feed_items ADD COLUMN IF NOT EXISTS competitor_extracted_at timestamptz;`
- Partial index for the cron's candidate scan (small — competitor rows only):
  `CREATE INDEX ... ON feed_items (created_at DESC) WHERE category='competitor_intel' AND competitor_extracted_at IS NULL;`
- Nullable, no backfill, no hot-table rewrite. Apply to prod.

## B. scam-engine fixes

| #   | Finding                                | File                               | Fix                                                                                                                                                                                                                                                          |
| --- | -------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H2  | zero-yield re-extraction               | `competitor-intel-extract.ts`      | Idempotency check → `competitor_extracted_at IS NOT NULL` (skip). At the **end of every** extraction (success **and** zero-yield), `UPDATE feed_items SET competitor_extracted_at = now()`. Do **not** set it on upsert failure (so genuine failures retry). |
| H2  | candidate loader                       | `competitor-intel-extract-cron.ts` | Load candidates with `.is("competitor_extracted_at", null)` on the `feed_items` query; drop the separate observations-dedup query (no longer needed).                                                                                                        |
| M5  | duplicate `scam_title` → PG 21000      | `competitor-intel-extract.ts`      | Dedupe `rows` by `scam_title` (keep first) before the upsert.                                                                                                                                                                                                |
| M6  | double-spend on DB failure             | `competitor-intel-extract.ts`      | Wrap the `cost_telemetry` insert in try/catch (best-effort). On `upsertErr`, **don't throw** — log + return a soft error (leaves the row unmarked → retried, but no crash).                                                                                  |
| M11 | invalid enum/country fails whole parse | `competitor-intel-extract.ts`      | `scamType: z.enum(...).catch("other")`, `countryCode`: uppercase-normalize + regex + `.catch(null)`, `novelty: z.enum(...).catch(null)`.                                                                                                                     |
| L12 | error-sink insert unguarded            | `competitor-intel-extract-cron.ts` | try/catch the `reddit-intel-error` diagnostic insert (best-effort).                                                                                                                                                                                          |
| M7  | all-fail invisible in Axiom            | `competitor-intel-extract-cron.ts` | Import `getLogger`; destructure `runId`; when `failures > 0`, emit an always-ship Axiom `warn("competitor-intel-extract.failures", {failures, processed, totalObservations})` + flush.                                                                       |
| L16 | no function-level ceiling              | `competitor-intel-extract-cron.ts` | Add `timeouts: { finish: "6m" }` to `createFunction` (matches `feed-items-embed`).                                                                                                                                                                           |

## C. Web fixes

| #   | Finding                            | File                                                  | Fix                                                                                                                                                                                   |
| --- | ---------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | scam domains auto-linkify in email | `apps/web/lib/clone-watch/weekly-clone-watch.ts`      | Defang `fakeDomain` **and** `realDomain` (`.` → `[.]`) before returning, so no mail client can linkify them. Template already renders plain text; defanging at source makes it inert. |
| H3  | brake never trips on this spend    | `apps/web/app/api/cron/cost-daily-check/route.ts:174` | Add `                                                                                                                                                                                 |     | t.feature === "competitor-intel-extract"`to the`redditIntelCost`sum → the shared`reddit_intel`brake actually caps it under`REDDIT_INTEL_CAP_USD`. |
| M10 | dead "Promote" on competitor rows  | `apps/web/lib/dashboard/inbound-quarantine.ts`        | Exclude competitor rows from the list via `.or("category.is.null,category.neq.competitor_intel")` (the NULL-safe form — a bare `.neq` would wrongly drop legit NULL-category rows).   |
| L13 | one stream throw kills the send    | `apps/web/app/api/cron/weekly-email/route.ts`         | `Promise.allSettled` for `[regulatorAlerts, cloneWatch]`, coalesce rejections to `[]` — enforces "never depends on the fresh streams" at the wiring level.                            |

## D. Docs (hand to a docs-update agent — no code)

- `docs/plans/arthurs-watch-newsletter.md` — status header ("no code shipped" is false); add the shipped extraction sub-step + `FF_COMPETITOR_INTEL_EXTRACT` to §2b/§4.
- `docs/adr/0021-competitor-intel-source-class.md` — `proposed` → `accepted`; add SPF/DKIM (M9) + the full slug-sync-point list (M8/arch-2) to the threat model / consequences.
- `docs/plans/arthurs-watch-phase1-ingest-runbook.md` — CF-rules count, add v213 sources to the subscribe table + verify SQL.
- `docs/system-map/feature-flags.md` — add `FF_COMPETITOR_INTEL_EXTRACT` (+ the absent `FF_REDDIT_INTEL_WEEKLY_SYNTHESIS`).
- `docs/system-map/database.md` — add `competitor_intel_observations` + `competitor_extracted_at`; extend migration timeline v192–v214.
- `docs/system-map/background-workers.md` — add the `competitor-intel-extract` cron + the Clone Watch section note.
- `CLAUDE.md` Quick Reference — an Arthur's Watch row; name `feature='competitor-intel-extract'`.

## E. Documented deferrals (NOT fixed now — deliberate)

- **M8 PII scrub / 45k raw store** — the body is third-party _published_ editorial (not user PII); document the exemption in ADR-0021. Revisit if a source proves PII-heavy.
- **M9 SPF/DKIM sender verification** — pre-existing inbound-pipeline gap; record in ADR-0021's threat model and make it a hard gate for Phase 3 (public blend). Not this PR.
- **L15 `createServiceClient` in `lib/`** — technically the forbidden tier, but cron-only and matches `reddit-intel-weekly.ts`/`regulator-alerts-weekly.ts` siblings exactly. Accept; optionally allowlist in the advisory reviewer.
- **H4** — closed by merging the branch (deploys the promote-guard that's already-stamped rows need). Do the fixes, then merge promptly.
- **Phase 2b / 3 / 4 + per-country feed promotion** — separate future slices; observations table shape already supports them.

## F. Sequence

1. Apply **v214** migration to prod (attempt marker).
2. **B** scam-engine fixes → `pnpm --filter @askarthur/scam-engine` tsc.
3. **C** web fixes → `pnpm --filter @askarthur/web typecheck`.
4. **D** docs-update agent (parallel with 2–3).
5. Regenerate `db.generated.ts` (competitor_intel_observations, reddit_intel_weekly_digest, competitor_extracted_at).
6. Commit; re-run `get_advisors`.
7. Open the PR (closes **H4**) → Vercel preview green → merge → deploy.
8. First 6h cron run extracts the ~4 real newsletters already queued → end-to-end proof.
