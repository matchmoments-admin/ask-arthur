# Inngest fleet operational review — 2026-07-12

> **All 7 fix PRs (#717–#723) MERGED to `main` 2026-07-12.** Founder-approved
> cleanups **A + B SHIPPED in #725 (merged 2026-07-13)** — `meta-brp-report`
> deleted and `pipeline-ct-monitor` retired (kept `getCtMonitorConfig` as a
> rebuild kit). Items **C + D remain founder decisions.** Plan below.

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

### C. Onward producer wiring (`hasFinancialLoss` / `hasPiiCompromise`) — MED effort, product-launch scope

- **Decision needed:** launch onward reporting? (gated `NEXT_PUBLIC_FF_ONWARD_REPORTING`, currently pre-launch — `onward_report_log` 0 rows).
- **Evidence:** `OnwardReportPicker` accepts + forwards both signals, but **no code path produces them** anywhere, and `ResultCard` doesn't pass them → ReportCyber + IDCARE (gated on financial-loss / PII in `get_onward_destinations`) can never surface. Deriving from `scamType` is wrong ("finance-shaped" ≠ "user lost money").
- **Recommend:** part of the onward-reporting launch, not a standalone fix. MVP: add a 2-checkbox micro-question ("Did you lose money?" / "Did you share personal info?") as the picker's first step (reuse the Next Steps funnel's micro-question pattern), then it already forwards to `/api/report/destinations`. ~½ day. Tracked in `BACKLOG.md` (P1 onward-reporting).

### D. Design decisions (no code yet)

1. **Retention-bundling convention** — `feed-retention` bundles 3 single-RPC prunes under one fn; the review rejected bundling `telco-events` + `reddit-processed-posts` + `archive-shadows` (+`cost-telemetry`) prunes on failure-domain grounds. **These conflict.** For retention specifically the coupling argument is weak (idempotent, sub-second, next-night self-heals). **Recommend** adopting "same-nature nightly single-RPC prunes MAY bundle (one `step.run` per RPC)"; folding the 3–4 retention crons into one saves 3 registrations + 3 invocations/day. Low value, do only when convenient.
2. **`report_count >= 3` gate** — starves BOTH `pipeline-entity-enrichment` (STALE) and `pipeline-urlscan-enrichment` (0 paid calls all-time): max `report_count` in the corpus is 2, so neither paid stage can ever fire. **Recommend** deciding intent: if intelligence-core should be active now, lower to `>= 2` (cheap, light paid enrichment on twice-reported entities); if not, leave dark (correct once corpus grows) — but add the reachability note so it's not mistaken for a bug. Cost call.
3. **On-demand enrichment** (the deeper enrichment-fanout fix #723 deferred) — instead of eagerly enriching 235k blocklist URLs, enrich a URL when a user actually checks it (hook the analyze path: if the checked URL is `scam_urls.enrichment_status='pending'`, enrich it inline/targeted). Makes WHOIS/SSL ready exactly for checked URLs; the eager fan-out becomes a low-priority filler. MED effort; #723's newest-first already mitigates the acute harm, so this is an optimisation, not urgent.

**Suggested sequencing:** A + B are quick, reversible cleanups (bundle into one "fleet dead-code retirement" PR on approval). C rides the onward-reporting launch. D-1/D-2 are one-line convention/threshold calls; D-3 is a scoped optimisation for later.

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
