# Inngest fleet operational review — 2026-07-12

> **All 7 fix PRs (#717–#723) MERGED 2026-07-12.** Cleanups **A + B shipped in
> #725**. **C shipped in #727** (onward micro-question). **D2 shipped in #726**
> (report_count 3→2). **D1 resolved in #728** (keep separate + documented
> convention — the telco compliance pager is the decisive factor). **D3 is the
> only remaining item — a documented, ready-to-build deferred optimisation**
> (see D3 below). Everything else from this review is now in production.

## Untouched items — decision plan

### A. Delete `meta-brp-report` (the unregistered stub) — ✅ DONE (#725) — LOW effort, reversible

- **Decision needed:** is deepfake→Meta Brand-Rights-Protection reporting on the roadmap in the next ~2 quarters?
- **Evidence:** `deepfake_detections` = 0 rows all-time; fn unregistered since #552; `metaBrpReporter` flag OFF + token unset; the state-advancing UPDATE is commented out (footgun #519). It has never run once.
- **Recommend:** **DELETE.** ADR-0019/#552 kept it "for future re-registration," but it saves 0 step-runs and carries a documented footgun; resurrection is one `git revert`. Keeping dead code costs review-surface each time someone audits the fleet.
- **If approved:** `rm packages/scam-engine/src/inngest/meta-brp-report.ts`; drop `metaBrpReporter` from `feature-flags.ts`; update ADR-0019, `background-workers.md`, `inngest-brakes.md`, `feature-flags.md`, `cost-reduction.md`, `inngest-cron-hardening.md` to say "removed" not "kept as stub". No migration. ~30 min.

### B. Retire `pipeline-ct-monitor` — ✅ DONE (#725) — LOW effort, small step-run saving

- **Decision needed:** retire, or try to repair crt.sh access?
- **Evidence:** 0 `crtsh_monitor` rows all-time; Python `crtsh` scraper already has ~4,970; crt.sh JSON 502s this access pattern (reproduced). Now logs loud (#720). ADR-0016's "distinct surface writing brand_impersonation_alerts" rationale is FALSE (it writes `scam_urls`, same as the Python scraper) — so the ADR reason to keep it doesn't hold.
- **Recommend:** **RETIRE** in favour of the Python scraper. Saves ~18–36 wasted step-runs/day (9 keywords × up to 3 retries × 2 runs, all hammering a 502).
- **If approved:** remove `ctMonitor` from `inngest/functions.ts`; `rm ct-monitor.ts`; **first check `getCtMonitorConfig` has no other consumer** in `@askarthur/shopfront-glue` before removing it; update ADR-0016 + `background-workers.md`. No migration. ~30 min.

### C. Onward producer wiring (`hasFinancialLoss` / `hasPiiCompromise`) — ✅ DONE (#727)

- **Was:** `get_onward_destinations` only surfaces ReportCyber + IDCARE when financial loss / PII is present, but **no code path produced those signals**, so they could never appear.
- **Done:** `OnwardReportPicker` now self-collects them via a two-checkbox micro-question as its first step, feeding `/api/report/destinations`. No producer/ResultCard change needed. Prod HTTP smoke test confirmed loss+pii=true adds `[reportcyber, idcare]`. Behind the unlaunched onward flag — launch-ready wiring.

### D. Design decisions

1. **Retention-bundling convention — ✅ RESOLVED (#728).** Decided **keep separate + documented** (in `feed-retention.ts`, the bundling exemplar). The decisive factor found on full read: `telco-events-retention` carries a forensic-compliance `onFailure` **pager** (#522) that bundling would dilute; the ~60 invocations/mo saving does not justify coupling failure domains a verification pass already refuted. Bundle only same-feature + shared-failure-semantics prunes (feed-retention); keep cross-feature/compliance-distinct prunes separate.
2. **`report_count >= 3` gate — ✅ DONE (#726).** Lowered both enrichment gates to `>= 2`. Verified negligible cost (+7 entities corpus-wide) — unblocks the data-starved intelligence-core stages. Bounded by flags + caps + throttle; reversible.
3. **On-demand enrichment — DEFERRED (ready-to-build plan, recommend hold).** The narrow remaining case after #723 + D2.
   - **Why mostly-covered:** #723 made `enrichment-fanout` newest-first, so freshly-ingested feed URLs enrich promptly; D2 lowered the entity gate to `>=2`, so **reported** URLs already enrich via `entity-enrichment` → `urlscan-enrichment`. The ONLY uncovered case is a user **checking** (not reporting) an **old** feed URL — and analyze does not currently write `scam_urls` on a check, so there is no existing signal linking "checked" → the `scam_urls` row.
   - **Build plan when wanted:** in the analyze URL path, on a check, look up the URL in `scam_urls`; if `enrichment_status='pending'`, emit a fire-and-forget targeted-enrich event (async — NO added analyze latency) consumed by a small per-domain enrich fn (or extend `enrichment-fanout` to accept a single domain). ~½ day + 1 new fn.
   - **Recommendation: HOLD.** It touches the latency-sensitive analyze hot path and adds fleet surface (against this review's own surface-reduction goal) for a narrow case the acute harm of which #723 already fixed. Build only if telemetry later shows users frequently checking stale-pending feed URLs.

**Status:** A, B, C, D1, D2 all shipped to production (#725–#728). D3 is the sole open item — a documented, deliberately-deferred optimisation.

> **Fixes shipped (2026-07-12)** — one PR per item, each on a fresh branch off `main`:
> | Finding | PR | Verification |
> | --- | --- | --- |
> | P1 reddit-intel-cluster mega-theme collapse | **#717** | New unit test reproduces collapse + proves guards (freeze + join ceiling + alarm); 603 tests green |
> | P2 enrichment-fanout starvation | **#723** | Newest-first; `EXPLAIN` confirms backward index scan (no new index) + backlog `.warn` |
> | P2 verified_scams unembedded (61%) | **#721** | Daily cron delta + brake; idempotent `IS NULL` gate |
> | P2 onward queued-row convergence gap | **#722** | Mark `failed` + re-drive on resubmit; enum contract confirmed |
> | P2 ct-monitor 0-rows / false effect claim | **#720** | Header corrected; zero-cert `.warn`; crt.sh 502 reproduced |
> | P3 known-brands header + phone-footprint reclaim | **#719** | `.or()` reclaim query 200-OK on live PostgREST |
> | Cleanup: onward-skipped ×4 → 1 | **#718** | Mapping-lock test (3); typecheck clean |
>
> **Two founder decisions deferred (not done unilaterally):**
>
> - **meta-brp-report delete** — reverses a documented "keep for re-registration" decision (ADR-0019/#552) for 0 step-run saving. Skipped; see PR #718.
> - **ct-monitor retire** — redundant + can't reach crt.sh, but referenced in ADR-0016. Made loud (#720), retirement left to you.
> - **onward producer wiring** (`hasFinancialLoss`/`hasPiiCompromise`) — no producer exists; needs a user micro-question, tracked in BACKLOG. Product-launch scope, not a bug.
> - Open questions from §4/§5 (retention-bundling convention; `report_count>=3` threshold; on-demand enrichment) remain for your call.

**Mode:** report-only. Nothing changed. Every fix/remove/combine below is a founder-approved
follow-up PR. **Scope:** all 73 registered fns (79 `createFunction` sites incl. multi-export
files + the unregistered `meta-brp` stub). **Method:** effect-freshness FIRST (max timestamp on
each fn's write table), cost_telemetry second, static step-run estimates, adversarial refute-first
verify on every remove/combine. Born from the v224 clone-watch incident (81% inert past 3
correctness reviews). Workflow: `wf_6e4d4d62-e51` (23 agents, 0 errors).

## Headline

The fleet is **architecturally sound and has no runaway** — every step-run path is bounded, and
**almost every combine candidate was correctly REJECTED** on failure-domain-isolation grounds
(the adversarial pass _upheld_ the fleet's decoupling; see §4). The value is in **operational**
findings code review can't see: one live-but-useless feature (P1), three live-but-structurally-
broken or whole-pipeline-inert flows (P2), two safe cleanups, and a map of built-but-unwired
features (§5). Only **2 genuine structural changes** survived verification; the rest is fix-in-place.

---

## 1. P1 — live degradation, fix (the headline catch)

**`reddit-intel-cluster` — greedy clustering collapsed into one runaway mega-theme.**

- **Evidence:** for **10 consecutive weeks** (2026-05-04 → 07-06) `distinct_themes=1` for _every_
  cohort. One theme holds **2263 members = 89% of all 2543 posts**; all 1103 posts in the last 30d
  joined it. `new_themes` last30=**0**, last90=160 but newest `created_at=2026-05-03` (70 days → 0
  new themes since). 144/160 themes still `title='Pending naming'`. **No `reddit-intel-name-themes`
  cost row in 7d — the Sonnet naming call has not fired.**
- **Why it hid:** convergence is _fine_ (every post assigned, `theme_null=0`) and the collapse
  produces **zero Sonnet naming cost**, so there was no cost signal to trip an alarm. It "works"
  and produces no intelligence — exactly the v224 class.
- **Root cause:** `COSINE_THRESHOLD=0.62` against an online-mean centroid over 2263 heterogeneous
  posts → a central attractor every new post scores >0.62 against; nothing ever re-seeds. Code's own
  comment flags `member_count>50` as "too loose" — this is 45× that.
- **Fix:** cap the max centroid an incoming post may join (reject joins above a member ceiling →
  force re-seed) and/or lower `COSINE_THRESHOLD`; consider periodic full re-cluster vs unbounded
  online-mean drift; **add a health alarm on `distinct_themes==1 for N cohorts`**; rebuild the
  2263-member theme once fixed.

---

## 2. P2 — live but structurally broken / whole-pipeline inert, fix

**a. `pipeline-enrichment-fanout` — queue cannot drain (5-year backlog).**
WHOIS/SSL fan-out is LIVE (last attempt today 00:04) but **235,601 pending-active URLs vs ~124/day
completion** (cap 20 domains/run × 2 runs/day). Oldest-first ordering → recent URLs never reached.
The `0 */12` header's "no domains skipped / self-draining" claim is false. **Fix:** scope the queue
to URLs actually queried/reported (not whole blocklist dumps — phishing_army 215k + phishtank 82k),
or raise `MAX_DOMAINS_PER_RUN`/tighten cadence; at minimum correct the header.

**b. `scam-reports-backfill-embed` — `verified_scams` has no steady-state embed path.**
**39 of 64 verified_scams (61%) with a summary are unembedded.** This manual-only backfill is the
_only_ path that embeds `verified_scams`; `scam-report-embed` only handles `scam_reports`. Header
falsely claims new rows embed synchronously. Hybrid search over the authoritative scam anchors is
silently degrading. **Fix:** give `verified_scams` a steady-state path — a cron delta (mirror
`acnc-charity-backfill-embed`'s dual cron+event) or a stored-event consumer from `storeVerifiedScam`.
(The `scam_reports` tail is fine — its 26 unembedded rows are all <40 chars, correctly skipped.)

**c. `report-onward-auto-report` — the entire onward pipeline is INERT + a convergence gap.**
`onward_report_log` has **0 rows in its lifetime** (schema live since v119). The only automated
producer is dark (cron `25 */12` removed, `FF_ONWARD_AUTO_REPORT` OFF), and the click surface never
fires because **`ResultCard` never passes `hasFinancialLoss`/`hasPiiCompromise` to
`OnwardReportPicker`** (the CLAUDE.md "latent gap") → zero `POST /api/report/onward` traffic. So
_all_ onward workers (§4, §5) are inert for lack of a producer, not lack of correctness.
Plus a **convergence gap**: the click route leaves a row `status='queued'` when `inngest.send`
throws and never re-fires on resubmit; the auto-producer upsert uses `ignoreDuplicates` so it skips
queued rows too; **nothing reads `onward_report_log WHERE status='queued'` to re-drive** — orphaned
rows stick forever. **Fix (product first):** wire the producer (pass the two flags to the picker);
then re-add the cron + a queued-row re-fire sweep so a dropped send self-heals.

**d. `pipeline-ct-monitor` — 0 attributable rows all-time; duplicates the Python scraper.**
Upserts `scam_urls` under `feed_source='crtsh_monitor'` but that label is on **0 rows**, while the
heavy Python `crtsh` scraper it overlaps has **4,970**. Runs every 12h under a LIVE flag, emits no
effect; header also wrongly claims it writes `brand_impersonation_alerts`. **Fix:** retire the
9-keyword sweep in favour of the Python crt.sh scraper, or fix `bulk_upsert_feed_url` to record the
label on conflict; correct the header either way.

---

## 3. P3 — honesty / hygiene fixes

- **`known-brands-discover`** — documented "re-probe 'none' rows after 90d" is **unimplemented**:
  the candidate gate treats all 226 `contact_type='none'` rows as permanently covered, and
  `known_brands` has no `probed_at` column, so no 90d basis exists. Discovery silent 12d (last
  `security_txt_discovery` 2026-06-30). **Fix:** delete the false header claim, or add `probed_at` +
  a reprobe branch.
- **`phone-footprint-refresh-claimer`** — stale-claim reclaim gap (v224 class): claimer sets
  `claimed_at` but its worklist excludes claimed rows forever; only the monitor's `markCompleted`
  moves a row back. If the emit step or `refresh.monitor` event is dropped, the row is stuck. Dark
  today (queue empty) — surfaces **post-launch**. **Fix:** add a stale-claim reclaim
  (`completed_at IS NULL AND claimed_at < now()-interval '1 hour'`) or set `claimed_at` after a
  confirmed emit.

---

## 4. Structural changes that survived verification (only 2)

| Change                              | Verdict   | Effect                                                                                                                                                                                                                                                                                       |
| ----------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **REMOVE `meta-brp-report`**        | CONFIRMED | Triple-dark unregistered stub (never fires; `deepfake_detections` 0 rows all-time; state UPDATE commented out — footgun #519). Delete file + doc rows. One `git revert` away if deepfake BRP ships. Saves surface, not step-runs.                                                            |
| **COMBINE `onward-skipped` ×4 → 1** | CONFIRMED | `report-onward-{scamwatch,reportcyber,idcare,ask-arthur-feed}` are pure log-only markers, already one file, same `markStatus()` helper, no external API, no failure domain to couple. One fn with 4 event triggers + an event→`{status,reason}` map. Saves 3 registrations. All inert today. |

### Combines correctly REJECTED — verify upheld the fleet's isolation (report as validated keep-separate)

Every one of these was proposed then **refuted on independent-failure-domain grounds** — merging
would let one stage's failure poison the others (the exact "merging fns that fail independently is a
regression" rule):

- **staleness ×3** — 3 near-identical wrappers but 3 different tables (`scam_urls`/`scam_ips`/
  `scam_crypto_wallets`), each an independent UPDATE that can lock/timeout; a first-step throw would
  halt the others. **Keep separate.**
- **feed-sync ×2** — different source tables + idempotency namespaces; saving is ~4 invocations/mo.
  **Keep separate** (merge only opportunistically if already editing the file).
- **embeddings ×4** — 4 tables, 4 triggers, 4 brakes, 4 cost tags; share only the `embed()` lib seam
  (already deduped). **Keep separate.**
- **reddit-intel chain ×3** — event seams are load-bearing durable checkpoints across _expensive_
  Sonnet/Voyage calls; merging would re-bill on a cluster retry (and cluster is P1-broken).
  **Keep separate.**
- **analyze-fanout ×4** — canonical good fan-out; 3 consumers of one event w/ different retry budgets
  - a 4th on a different system event. **Keep separate.**
- **external onward ×4** — 4 destinations, 4 flags, 4 rate-limit buckets (brand-abuse 5/24h vs 60/1h).
  **Keep separate.**

### Open question for the founder (genuine inconsistency)

The **retention combine** (`reddit-processed-posts` + `telco-events` + `archive-shadows`
[+ `cost-telemetry`]) was proposed citing `feed-retention`'s own precedent ("it already bundles 3
single-RPC prunes under one fn") but then **refuted** on the same coupling grounds. Both can't be
right: `feed-retention` bundles today, yet we reject bundling these. The defensible distinction is
_same-feature_ prunes (feed-retention) vs _unrelated-feature_ prunes — but it's a judgment call, not
settled. **Decide the fleet's retention-bundling convention** rather than treating this as closed.

---

## 5. Built-but-unwired map (keep, correct while dark — but a strategic signal)

A large slice of the fleet has **never produced an effect** because its producer or flag isn't live.
Not waste (durable shapes awaiting launch) but a map of unfinished features:

- **One upstream threshold darkens two paid stages:** `report_count>=3` is unreachable in the current
  corpus (max is 2), so **both `pipeline-entity-enrichment` (STALE, 18d) and
  `pipeline-urlscan-enrichment` (INERT, 0 paid calls all-time)** are data-starved. Lower/seed the
  threshold and both unblock together.
- **Vuln AU-enrichment ×2** — 3,987-row backlog, `enriched_at` NULL for all; dark flag + no producer.
- **`match-b2b-exposure`** — 0 detections; the `/api/v1/exposure` producer hasn't shipped.
- **All external onward workers** (brand-abuse/acma/openphish/apwg) + the auto-producer — inert for
  the §2c producer gap.
- **`brand-register-refresh`, `scam-alert-push`, `regulator-alert-push`** — dark by flag (documented).
- **Phone-footprint ×5** — dark until Vonage CAMARA go-live; `phone-footprint-retention` runs a daily
  no-op over empty tables (intentional — a PII job should run unconditionally).
- **`shop-signal-enrich`** — code healthy but **4 checks ever, 0 in 7d** despite `FF_SHOP_SIGNAL` ON
  since 2026-05-20. Product-adoption signal, not a defect.

## 6. Step-run budget

No fn approaches the 50K/mo cap. Largest contributors: clone-watch preclassify/urlscan/recheck
(already halved at v224), `feedback-triage-refresh` ~24/day (cheap guards), staleness ~3/day,
`reddit-intel-cluster` ~42/wk. The fleet is comfortably within budget; the §4 combines would save
only a handful of invocations/mo — which is _why_ they're not worth the failure-domain coupling.

## 7. Confirmed healthy (42, no action)

analyze-fanout (report/brand/cost), risk-scorer, cluster-builder (idle-by-data), staleness ×3,
feed-items-embed, scam-report-embed, acnc-charity-backfill-embed, reddit-intel daily/embed,
competitor-intel-extract, feed-sync-verified, shopfront-nrd-daily-ingest (convergent — the v224 fix
pattern verified present), phone-footprint pdf/monitor/pager, feedback-triage-refresh, feed-retention,
cost-telemetry-retention, report-brand-stewardship, reddit-brands-discover, and the clone-watch
sub-fleet (11 spot-checked LIVE incl. the v224 recheck read-gate fix confirmed converging).

---

### Suggested execution order (each its own PR, on approval)

1. **P1** reddit-intel-cluster recalibrate + alarm (highest value).
2. **P2c** onward producer wiring + queued-row re-fire (unlocks a whole dormant capability).
3. **P2a/b/d** enrichment-fanout scoping, verified_scams embed path, ct-monitor retire.
4. **Cleanups** meta-brp delete + onward-skipped ×4 merge (one small PR).
5. **P3** known-brands honesty + phone-footprint reclaim (pre-launch hardening).
6. **Decisions** retention-bundling convention; `report_count>=3` threshold; shop-signal adoption.
