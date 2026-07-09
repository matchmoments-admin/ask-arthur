# Clone-Watch Netcraft Issue Reporter — PR2 Fix Plan

> Source: ultracode workflow `wf_300bd165-f03` (5 analysts + synthesis), 2026-07-10.
> Reconciled with the live dry-run smoke test (14 in-window batches: 15 malicious / 225 no-threats / 110 unavailable; 0 archived).

# PR2 Fix Plan — Clone-Watch Netcraft False-Negative Issue Reporter

_Reconciles 5 analyst reports (correctness / netcraft-empirical / efficiency-scale / ops-safety / adversary) against the shipped code in `clone-watch-netcraft-issue.ts`, `netcraft-urls.ts`, `netcraft-issue-report.ts`, `migration-v215`. Feature is dark (dry-run, 0 filed)._

---

## 1. Executive Summary

**Safe to leave dark as-is: yes.** In dry-run the fn does zero POSTs and zero DB writes — it only fetches keyless GETs and logs would-be payloads. The only cost of leaving it is that the same ≤14 oldest uuids get re-fetched and re-logged every day (bounded, $0, keyless) and the founder's log never converges. Nothing about the current state erodes reporter standing or writes bad data. **Do NOT flip `NETCRAFT_ISSUE_DRY_RUN=false` until the must-fix list below lands.**

**Single most important empirical finding — the archival window (R1) is REFUTED, and inverted.** All four analysts that probed prod agree: Netcraft does **not** archive declined submissions in <1 day. The oldest live submission (`Sedez1jE…`, submitted 2026-06-15) is **24.5 days old and still `is_archived=0`, readable, escalatable**. The real archival horizon is >24.5 d (unobservable — the feature only began 2026-06-15). Consequence: the shipped fear ("archive-before-we-look race") never fires, but the `p_max_age_days=14` guard built to defend against it is now the binding constraint — it **silently excludes ~150 of 164 uuids (~91% of the backlog)** that Netcraft would still accept. The window is too tight, not too loose. The correctness analyst's proposed fix ("raise cron frequency to shrink the archival race") is refuted by the probes; the correct fix is to **widen the window to ~30 d (or drop it and rely on the authoritative `is_archived` per-fetch skip)**.

**Confirmed real vs refuted:**

| Risk                                                             | Verdict                               | Note                                                                                                                              |
| ---------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **R4 body contract** (`filename_misclassifications:[]` rejected) | **CONFIRMED (highest go-live risk)**  | akacdev reference client throws on empty array; if server mirrors it, _every_ live POST 4xx's → files zero while looking healthy. |
| **R2** persistent 4xx retries forever, no dead-letter            | **CONFIRMED** (unanimous)             | Erodes shared standing; head-of-line starvation once backlog > cap.                                                               |
| **R3** `has_issues` fetched but never gates POST                 | **CONFIRMED** (unanimous)             | Late-settling sibling → 2nd `report_issue` on same uuid.                                                                          |
| **NEW archived-200-body-ignored**                                | **CONFIRMED** (adversary)             | `is_archived` from a 200 body is only honored on the 404 branch → POST to archived submission 404s forever, feeds R2. Clean bug.  |
| **NEW drain-non-escalatable / starvation**                       | **CONFIRMED**                         | Matched-but-terminal alerts never stamped → re-GET forever, starve newer uuids.                                                   |
| **NEW limit-splits-uuid** (`LIMIT 500` on alerts)                | **CONFIRMED, latent** (350<500 today) | Fires ~6 days out at current growth.                                                                                              |
| **NEW autobrake absent**                                         | **CONFIRMED** (ops-safety)            | No circuit breaker on a standing-erosion reject spike.                                                                            |
| **R1 archival <1-day fear**                                      | **REFUTED**                           | Inverse is the real bug (window too tight).                                                                                       |
| **R4 admin PostgREST arrow filter/order**                        | **REFUTED / non-issue**               | Runtime-verified valid (200 vs control 400); ISO stamp ⇒ lexical == chronological. Verify-only once a row exists.                 |
| **Timezone cap-reset bug**                                       | **REFUTED**                           | UTC-consistent; 11:00 UTC cron never straddles the 00:00 reset.                                                                   |
| **cross-uuid / per-domain double-file**                          | **latent, 0 today**                   | Document assumption; low.                                                                                                         |

---

## 2. Confirmed Fixes (ranked by severity × confidence)

### BLOCK-1 — R4 body contract: `filename_misclassifications:[]` is likely server-rejected

- **Problem:** akacdev throws on an empty filename array; if Netcraft mirrors that, every live POST returns 4xx → `ok:false` → no stamp → retried forever, feature files **zero** while dry-run looks healthy.
- **Fix:** Do **not** flip the flag blind. Resolve empirically via BLOCK-0 harness (§5). Based on the result, either (a) confirm `[]` is accepted (keep as-is) or (b) omit the key entirely / send a minimal non-empty payload. Add a distinct always-ship log + brake path for the _first_ live 4xx so it isn't swallowed by "retry next run."
- **File:** `apps/web/lib/clone-watch/netcraft-issue-report.ts` (line 61 `filename_misclassifications: []`).
- **Effort:** S · **BLOCKS go-live.**

### BLOCK-2 — NEW archived-200-body-ignored: hoist the archival check above the `ok` gate

- **Problem:** `netcraft-urls.ts:205` computes `isArchived` from the 200 body, but `clone-watch-netcraft-issue.ts:159-177` only consults `fetched.isArchived` **inside** `if (!fetched.ok)`. A 200 with `is_archived=1` therefore builds candidates and POSTs → `/report_issue` 404s → no stamp → re-attempted every run (feeds R2).
- **Fix:** In the loop, move the archival short-circuit before the `!fetched.ok` branch:
  ```ts
  if (fetched.isArchived) { archived++; if (!dryRun) await step.run(`stamp-archived-${uuid}`, …{ skipped: "archived" }); continue; }
  if (!fetched.ok) { errors++; …; continue; }
  ```
- **File:** `clone-watch-netcraft-issue.ts` ~159-177.
- **Effort:** S · **BLOCKS go-live** (cheap, do it regardless).

### BLOCK-3 — R3 has_issues gate: prevent a 2nd `report_issue` on the same uuid

- **Problem:** `fetched.hasIssues` (netcraft-urls.ts:206) is only stuffed into `summary` (line 210); the POST at 229 is unconditional. A late-settling sibling alert (or a POST-succeeded-but-stamp-failed rerun) files a second issue on a uuid that already has one — unknown, possibly standing-eroding Netcraft behaviour, and a 4xx on it feeds R2's loop.
- **Fix:** Gate the POST on `!fetched.hasIssues`. When `hasIssues` is true, skip the POST and stamp candidates terminal `{ skipped: "submission_has_issue" }` so they drain. This is the conservative standing choice (all first-time submissions probed at `has_issues=0`, so legit first files are unaffected) **and** it closes the stamp-failure double-file window — a rerun sees our own `has_issues=1` and skips.
- **File:** `clone-watch-netcraft-issue.ts` ~226-231.
- **Effort:** S · **BLOCKS go-live.**

### BLOCK-4 — R2 dead-letter / attempt-cap (+ worklist RPC filter change)

- **Problem:** `clone-watch-netcraft-issue.ts:232-239` — on any non-2xx it `errors++/continue`s with **no stamp**, so the uuid re-enters the `ORDER BY submitted_at ASC` worklist and is re-POSTed every day, forever, from the _front_ of the list. No transient-vs-permanent split. Once backlog > cap (20), stuck 4xx uuids starve newer filable ones.
- **Fix (three parts):**
  1. New atomic incrementer RPC `bump_clone_alert_netcraft_issue_attempt(p_alert_id, p_status, p_error)` doing a read-modify-write `jsonb` `attempts = COALESCE(existing+1,1)` — required because `merge_clone_alert_submission` **replaces** the whole key, so a naive stamp can't increment.
  2. In the fn: distinguish transient (`status 0` / `429` / `5xx`) from permanent (other `4xx`). On permanent 4xx → stamp terminal `{ skipped: "post_4xx", status }`. On transient → bump attempts; at N=3 → stamp `{ failed: true, last_status, last_error }`.
  3. Change the worklist RPC filter from `AND NOT (submitted_to ? 'netcraft_issue')` to allow attempts-only rows to re-enter but drain terminal ones:
     ```sql
     AND NOT (sca.submitted_to->'netcraft_issue' ? 'issue_reported_at')
     AND NOT (sca.submitted_to->'netcraft_issue' ? 'skipped')
     AND NOT (sca.submitted_to->'netcraft_issue' ? 'failed')
     AND COALESCE((sca.submitted_to->'netcraft_issue'->>'attempts')::int,0) < 3
     ```
- **Files:** `clone-watch-netcraft-issue.ts` (post-result branch) + **v216 migration**.
- **Effort:** M · **BLOCKS go-live.**

### BLOCK-5 — NEW autobrake: circuit-break on a 4xx reject spike

- **Problem:** Reporter standing is a shared finite resource; nothing auto-halts outbound flow if Netcraft starts rejecting. All static guardrails (FF, dry-run, cap, no-threats-only, FP denylist) are inert to Netcraft pushing back. `feature_brakes.clone_netcraft_issue` row does **not exist yet** — `isFeatureBraked` returns false when absent (default-open), so an auto-trip must **UPSERT**, not UPDATE (an UPDATE on a missing row is a silent no-op).
- **Fix:** Per-run reject counter split 4xx (400/401/403/422) from transient (0/429/5xx). If 4xx rejects in a run ≥ threshold (3, or >50% of live POST attempts), UPSERT `feature_brakes.clone_netcraft_issue = engaged` and Telegram-page. Route each reject through `logEnforcementEvent('rejected', …)` (reuse the existing enum member) for a queryable history. Pairs with BLOCK-4: dead-letter drains individual bad uuids, the brake halts a _systemic_ standing problem.
- **Files:** `clone-watch-netcraft-issue.ts` + `enforcement-telemetry.ts` (already has `rejected` in enum).
- **Effort:** M · **BLOCKS go-live** (this is the standing safety net for a live POST feature).

### BLOCK-6 — R1 + NEW drain-non-escalatable: widen the window _and_ make the tail drain (must land together)

- **Problem (R1):** `migration-v215:74-75` `p_max_age_days=14` excludes ~150 still-filable uuids. **Problem (drain):** `netcraft-urls.ts:155` drops matched-but-terminal alerts (malicious/suspicious/processing, or unavailable-in-live) without adding them to `candidates` _or_ `notInUrls`, so `clone-watch-netcraft-issue.ts:242-255` never stamps them → they re-GET forever and sit at the front of the oldest-first slice, starving newer uuids.
- **Why coupled:** widening to 30 d without the drain fix just enlarges the set of never-draining permanent residents.
- **Fix:** (a) Widen `p_max_age_days` default to **30** (empirically archival >24.5 d) in v216, keeping `is_archived` as the authoritative per-fetch skip. (b) After a successful fetch, terminally stamp **every** fetched alert not filed this run with a skip reason (`no_escalatable_state`, `unavailable_live`). For genuinely transient states (`processing`), stamp with a short `recheck_after` timestamp the worklist RPC honours rather than leaving the key absent — **absence of the key must never be the "try tomorrow" signal, because it is unbounded.**
- **Files:** `clone-watch-netcraft-issue.ts` (stamp all non-filed) + `netcraft-urls.ts` (surface _why_ no candidate: terminal vs transient) + **v216**.
- **Effort:** M · **BLOCKS go-live** (widening) — ship drain in the same PR.

### FIX-7 — NEW limit-splits-uuid: make the worklist unit = the cap unit (uuid-atomic)

- **Problem:** `migration-v215:79` `LIMIT 500` is on **alerts**; grouping happens app-side (`clone-watch-netcraft-issue.ts:123-136`). Once backlog > 500 rows (~6 days out), a uuid straddling row 500 is filed partially now and files a **second** issue next run (feeds R3). Also under-uses the daily cap (500 alerts ≈ 10 uuids at 50/batch even when cap=20).
- **Fix:** Rewrite the RPC to `GROUP BY uuid`, `array_agg` the alert rows, `ORDER BY min(submitted_at) ASC`, `LIMIT p_uuid_limit`; pass the already-computed `remaining` as `p_uuid_limit` so exactly the needed whole uuids come back. Eliminates split, starvation, and over-the-wire waste in one move.
- **File:** **v216** + `clone-watch-netcraft-issue.ts` load-pending (drop app-side slice).
- **Effort:** M · **must-fix before go-live** (latent but trivially reachable, and folds cleanly into the same RPC rewrite as BLOCK-4/6).

### FIX-8 — NEW notinurls-premature-drain: don't drain mid-ingestion / paginated-tail hosts

- **Problem:** `netcraft-urls.ts:146-152` stamps `not_in_urls` and the RPC drops it permanently, but absence isn't terminal: (1) a submission ingested just before the 11:00 UTC cron may have an incomplete `/urls` list; (2) if `total_count > URLS_PAGE_COUNT(500)` the tail is silently missing. `totalCount` is captured (line 233) but **never compared** to `urls.length`.
- **Fix:** Guard the drain: only stamp `not_in_urls` when `fetched.totalCount <= fetched.urls.length` (complete page) **and** the submission is >~24 h old. Otherwise leave unstamped to retry.
- **File:** `clone-watch-netcraft-issue.ts` (notInUrls stamp branch).
- **Effort:** S · **nice-to-have** (edge case; ship if in the neighbourhood).

### FIX-9 — NEW post-ok-stamp-fails: atomic bulk stamp to shrink the file-without-stamp window

- **Problem:** POST is memoised in its own step (correct), but if the separate `stamp-${uuid}` step exhausts its 2 retries, the issue is filed at Netcraft with **no** alert stamped → next cron re-files. `stampAlerts` also loops one RPC per alert and throws on first error (line 330-334).
- **Fix:** Add `merge_clone_alert_submission_bulk(p_alert_ids bigint[], p_key, p_value)` to stamp a uuid's whole candidate set atomically in one call. Note BLOCK-3 (has_issues gate) already largely closes this window — a rerun sees `has_issues=1` and skips.
- **File:** **v216** + `stampAlerts` in `clone-watch-netcraft-issue.ts`.
- **Effort:** S/M · **nice-to-have** (BLOCK-3 mitigates the sharp edge).

### FIX-10 — NEW finish-budget / timeout: worst-case sequential time can exceed 5m / trip the watchdog

- **Problem:** `timeouts.finish:'5m'` (line 86) vs per-uuid worst case = 12s GET + 12s GET + 20s POST = 44s sequential; cap 20 ⇒ ~14.7 m under Netcraft slowness — over the 5m finish and near the 10-min pg-stuck-query-watchdog the header claims to stay under.
- **Fix:** Combine with the state_counts pre-filter (§3, removes one 12s GET for most uuids) + lower timeouts (GET 8s, POST 12s). Update the header comment's "a few GET+POST pairs" with the real worst case.
- **Files:** `netcraft-urls.ts` (`DEFAULT_TIMEOUT_MS`), `netcraft-issue-report.ts` (`timeoutMs`), fn header.
- **Effort:** S · **nice-to-have** (only bites under degradation, which is exactly when you want to bail early).

### FIX-11 — NEW observability: send drift + rejects to the always-ship sink

- **Problem:** `clone-watch-netcraft-issue.ts:172,185,234` use `logger.warn` for the two signals that predict go-live failure (a new `url_state` = vocabulary drift; a persistent reject = standing signal) — neither hits `cost_telemetry` nor un-sampled Axiom, violating the codebase telemetry principle.
- **Fix:** Emit `driftStates` and every non-2xx reject via `logEnforcementEvent` (reuse `rejected`; add a `drift`-tagged extra). This also gives the BLOCK-5 autobrake its queryable reject history — so **ship this with BLOCK-5.**
- **File:** `clone-watch-netcraft-issue.ts`.
- **Effort:** S · **ship with BLOCK-5** (coupled).

### LOW — verify-only / defer

- **R4 admin arrow filter/order** — non-issue; **verify** once the first row is filed (§5). No code change.
- **cross-uuid / per-domain double-file** — latent (0 today); document "alert-level idempotency assumes ≤1 live netcraft uuid per domain," add per-domain guard only if upstream dedup changes.
- **normHost subdomain/IDN-fail** — low, unconfirmed (all live domains are bare ASCII); when `domainToASCII` returns `''`, keep the alert unstamped rather than matching on raw. Defer.
- **dry-run has no memory marker** — low; optional `dryrun_seen_at` so the log surfaces _new_ false negatives. Defer.

---

## 3. Efficiencies

| Efficiency                                                 | Current                                                                                                                | Proposed                                                                                                                                                                                                                                                                       | Saving                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`state_counts.urls` pre-filter** (empirically confirmed) | 2 keyless GETs per uuid every run (`/submission/{uuid}` then `/urls`).                                                 | `state_counts.urls` is already in the first GET body (live: `{"no threats":8,"unavailable":4}`). If it has no `no threats` (live) — or no `no threats`/`unavailable` (dry-run) with count>0, return `{ok:true, urls:[]}` **without** the 2nd GET, and terminal-stamp to drain. | ~10% of `/urls` GETs skipped at go-live in the 10-uuid sample; **free** (state_counts in hand); also trims the FIX-10 worst-case per-uuid time. Keep the full `/urls` read whenever a count is present (state_counts is batch-wide, can't identify _which_ URL is ours). |
| **RPC group-by-uuid + LIMIT-by-uuid**                      | `LIMIT 500` alerts, then JS group + `slice(0, remaining)`; fetches up to 500 rows to use ~20 uuids; 2 RPC round-trips. | `GROUP BY uuid`, `array_agg`, `LIMIT p_uuid_limit=remaining`. Optionally fold `count_todays` into the same call.                                                                                                                                                               | Eliminates the 500-alert starvation + mid-uuid split; materialises only the day's worklist; −1 round-trip. (Same change as FIX-7.)                                                                                                                                       |
| **Bulk stamp RPC**                                         | `stampAlerts` = one `merge_clone_alert_submission` per alert (~25 sequential RPCs/uuid).                               | `merge_clone_alert_submission_bulk(ids[], key, value)`.                                                                                                                                                                                                                        | ~25→1 round-trips/uuid; atomic (tightens FIX-9).                                                                                                                                                                                                                         |
| **GIN index on `submitted_to`** (adversary)                | Worklist + counter + admin read all seq-scan `shopfront_clone_alerts` on `?` operators.                                | `CREATE INDEX … USING gin (submitted_to jsonb_path_ops)` (or partial expression index on `(submitted_to ? 'netcraft_issue')`).                                                                                                                                                 | Modest now; grows daily. **Note:** `shopfront_clone_alerts` is not on the hot-table list, but check the index footprint per CLAUDE.md before adding. Low priority.                                                                                                       |

---

## 4. Refuted / Non-Issues (analyst disagreements resolved)

1. **Archival window <1-day fear (R1).** **Refuted** by all four probing analysts. The _correctness_ analyst kept R1 as "high — alert expires before filed" and proposed "raise cron frequency to shrink the archival race" — that half is **wrong** (empirically nothing archives at 24.5 d). The _efficiency-scale / ops-safety / adversary_ framing is right: the window is too **tight**, fix = widen to 30 (BLOCK-6), not raise cadence.
2. **Admin filed-list PostgREST arrow filter/order (the _other_ R4).** **Non-issue.** _efficiency-scale_ runtime-verified acceptance (200 for the real filter, control 400 for malformed → genuine acceptance, not RLS masking); _adversary_ confirmed `issue_reported_at` is fixed-width UTC ISO so `->>` lexical order == chronological. The _correctness_ / _ops-safety_ "unexercised, low risk" caveat collapses to a one-line verification (§5), no code change. Do **not** conflate with the netcraft-empirical **R4 body contract** (`filename_misclassifications:[]`), which is the real HIGH blocker.
3. **Timezone cap-reset.** **Refuted** unanimously — `date_trunc('day', now())` UTC + `0 11 * * *` cron never straddles the 00:00 UTC reset; two scheduled runs are always in different UTC days. No change (optionally document "today = UTC-day" if the cap is ever tightened near the real uuid count).
4. **Per-domain / cross-uuid double-file.** Latent, 0 live (double-file-by-domain query returned empty). Structural only; document the assumption, defer the guard.
5. **normHost punycode/subdomain mismatch.** Unconfirmed; all live `candidate_domain` values are bare ASCII registrable domains. Defer.

---

## 5. PR2 Build Plan

**One migration: `supabase/migration-v216-clone-netcraft-issue-dead-letter.sql`** (idempotent `CREATE OR REPLACE`; no table rewrite; safe to auto-apply via MCP on `rquomhcgnodxzkhokwni`).

### Must-fix **before** `NETCRAFT_ISSUE_DRY_RUN=false`

**BLOCK-0 — the validation harness (do this first; it settles R4 + R3 empirically).**

- Ship a **one-shot, admin-gated `tsx`/node script** (NOT an Inngest fn, so it can't be cron-scheduled): pick one live uuid → `fetchNetcraftSubmissionUrls` → `selectFalseNegativeCandidates(alerts, urls, {allowUnavailable:false})` → `buildIssuePayload` → **print the payload** → single `fetch` POST to `/submission/{uuid}/report_issue` → dump raw `{status, headers, body}`. Run once by hand; eyeball the 2xx + body. Then **re-run against the same uuid** to capture the 2nd-issue (`has_issues=1`) response — this empirically settles R3's "unknown behaviour" and R4's `filename_misclassifications:[]` acceptance.
- **File:** `apps/web/scripts/netcraft-issue-probe.ts` (or `scripts/`), gated behind an explicit env/arg, kept off the Inngest surface.

**Code (`apps/web/app/api/inngest/functions/clone-watch-netcraft-issue.ts`):**

1. BLOCK-2 — hoist `if (fetched.isArchived) …` above the `!fetched.ok` branch.
2. BLOCK-3 — gate POST on `!fetched.hasIssues`; stamp `submission_has_issue` otherwise.
3. BLOCK-4 — transient-vs-permanent split on `!result.ok`; call `bump_…_attempt` (transient) or terminal-stamp `post_4xx` (permanent).
4. BLOCK-5 — per-run 4xx reject counter → UPSERT `feature_brakes.clone_netcraft_issue` + Telegram page.
5. BLOCK-6 — terminal/`recheck_after` stamp for **every** fetched-but-not-filed alert.
6. FIX-11 — route drift + rejects through `logEnforcementEvent` (ships with BLOCK-5).
7. Drop the app-side group/slice in `load-pending` in favour of the uuid-limited RPC (FIX-7).

**Payload (`netcraft-issue-report.ts`):** 8. BLOCK-1 — adjust `filename_misclassifications` per the BLOCK-0 result (omit key or non-empty).

**Migration `v216`:** 9. Rewrite `list_clone_alerts_pending_netcraft_issue`: `GROUP BY uuid` + `array_agg` + `LIMIT p_uuid_limit` (FIX-7); new drain-aware filter (BLOCK-4); default `p_max_age_days = 30` (BLOCK-6). 10. `bump_clone_alert_netcraft_issue_attempt(p_alert_id, p_status, p_error)` — atomic jsonb increment (BLOCK-4). `SECURITY DEFINER`, `SET search_path = ''`, fully-qualified, EXECUTE revoked from PUBLIC/anon/authenticated (mirror v215). 11. `merge_clone_alert_submission_bulk(p_alert_ids bigint[], p_key, p_value)` — atomic bulk stamp (FIX-9). 12. (optional) GIN index on `submitted_to` — check footprint first; low priority.

- **After apply:** run `packages/scam-engine/src/__tests__/rpcs.smoke.test.ts` against a preview branch (function-body change), `get_advisors` (security+perf), regen `packages/types/src/db.generated.ts`.

**Archival cadence decision (from the empirical finding):** keep the **once-daily 11:00 UTC cron** — archival is >24.5 d, so daily easily beats it. **Widen** `p_max_age_days` to 30 (do not raise cron frequency — the correctness analyst's cadence proposal is refuted). `is_archived` (BLOCK-2) remains the authoritative per-fetch skip.

**`advance_clone_lifecycle` wiring:** the task brief lists this — it is **not referenced** in any of the four grounding files or the five reports. Treat as out-of-scope for PR2 unless the founder confirms an intended hook; if there is a lifecycle stage that should advance on a successful filed issue, wire it in the `stamp-${uuid}` step alongside the `issue_reported_at` stamp (open question below).

### Nice-to-have (post-flip, or same PR if cheap)

- FIX-8 (notinurls drain guard — `totalCount <= urls.length` + age), FIX-10 (timeout tuning + header comment), state_counts pre-filter (§3 — pairs with FIX-10), dry-run memory marker, R4 admin verification.
- **R4 admin verification:** after the first live filing (or a seeded `netcraft_issue.issue_reported_at` row on a preview branch), load `/admin/netcraft-results` and confirm the "recently filed" panel renders newest-first. Bake into the PR2 manual checklist.

---

## 6. Open Questions for the Founder

1. **`filename_misclassifications` (BLOCK-1):** after the BLOCK-0 probe, if the server rejects `[]`, do you want to omit the key entirely, or send a placeholder? (We have no genuine filename misclassifications — url-only is the honest payload.)
2. **`has_issues=1` policy (BLOCK-3):** confirm the conservative default — **skip + drain** a late-settling sibling (accepting the occasional lost late false-negative) rather than filing a 2nd issue and risking standing. Agree?
3. **Archival window (BLOCK-6):** widen `p_max_age_days` to **30**, or **drop the soft window entirely** and rely solely on `is_archived`? (Dropping is simplest and the probes justify it, but keeps ~150 old uuids permanently on the worklist until they finally archive — fine once the drain/dead-letter fixes land.)
4. **Backlog drain rate:** widening exposes ~150 uuids against a cap of 20/day (~8 days to clear the first pass). Raise `NETCRAFT_ISSUE_DAILY_CAP` for an initial catch-up, or let it bleed off at 20/day?
5. **Autobrake threshold (BLOCK-5):** trip at **≥3** 4xx rejects/run, or **>50%** of live POST attempts, or both? And Telegram-page + halt, or halt-only?
6. **`advance_clone_lifecycle`:** the brief mentions wiring it, but it appears in none of the grounding files/reports — is there a specific lifecycle stage a successfully-filed issue should advance, and where does that RPC live?
7. **Go-live sequencing:** flip to live for a **single uuid** first (harness), watch one real filing land + verify the admin panel (R4), _then_ let the cron run live? Or flip the cron straight after the harness passes?
