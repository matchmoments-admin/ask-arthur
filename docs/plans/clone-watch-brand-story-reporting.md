# Clone-Watch — Brand-story reporting ("Netcraft declined it, and here's what happened")

**Status:** Plan (drafted 2026-07-10)
**Goal:** Make brand reports tell the _true_ story — takedowns **and** the clones Netcraft
**declined to action** that are sitting parked, waiting to be weaponised — accurately,
efficiently, at scale. The raw signal already exists per-alert; this wires it into the
lifecycle and surfaces it to brands.

Follow-on to [[clone-watch-netcraft-false-negative-escalation]] (PR #701/#702). Relates to
`clone-watch-enforcement-monetisation-plan`, the monthly LinkedIn data-drop, and
`monitored_brands` (v207).

---

## 1. The brand narrative we want to tell

Brands care about two things: **takedowns** and **being told when their lookalikes are NOT
being dealt with**. Today we only ever say "detected / reported". The full arc we can now
tell, per brand, per month:

```
   detected ──▶ submitted to Netcraft ──▶ ┌─ TAKEN DOWN (Netcraft actioned)  ✅  [+ median time]
                                          │
                                          └─ DECLINED  ("no threats" / "unavailable")
                                                │   ← the story nobody else tells:
                                                │     a lookalike of YOUR brand, live/parked,
                                                │     that the vendor decided not to touch.
                                                ├─▶ WE ESCALATED (filed report_issue)         ↩ forced re-review
                                                │      └─▶ RE-TAKEN-DOWN after our push        🏆 the win
                                                └─▶ FLIPPED TO ACTIVE PHISHING (weaponised)    🔥 "declined ≠ safe"
```

The declined→weaponised line is the differentiator. Commercial brand-protection vendors
([Bolster](https://bolster.ai/solutions/typosquatting-protection),
[Fortra](https://www.fortra.com/platform/brand-protection/domain-monitoring),
[PhishFort](https://phishfort.com/typosquat-protection/)) all headline _fast takedown time_
and _verified threats_ — none surfaces "our detection vendor said no and was wrong." That
honesty is brand-helpful and uniquely ours.

**Best-practice framing** (from the research): lead with **time-to-takedown** and
**verified threats (low FP)**, treat monitoring as **continuous not periodic**, and back
every claim with **evidence** (we already hold urlscan screenshots + WHOIS/ASN). Keep the
verbs honest — "detected / reported / escalated / taken down / flipped to phishing" — never
imply we took a domain down when we didn't.

---

## 2. Why the reports can't tell this today (two broken chains)

### 2a. Lifecycle is never advanced for auto-submitted clones

- `advance_clone_lifecycle` (`migration-v199`) is called only by the **manual** submit path
  (`clone-watch-submit-netcraft.ts:176`) and the **dark** rollup poll
  (`clone-watch-poll-netcraft.ts:210`, cron removed, gated on unset flags).
- The **auto** bulk submitter (`clone-watch-netcraft-auto.ts:231-256`, the ~892 real clones)
  only stamps `submitted_to.netcraft` — it **never** advances lifecycle.
- The new per-URL issue reader (`clone-watch-netcraft-issue.ts`) writes only
  `submitted_to.netcraft_issue.*` markers — it **never** advances lifecycle either.
- **Result:** auto-submitted clones sit in lifecycle limbo. `lifecycle_state` is stale;
  `takedown_at` (JSONB, the only KPI input, written only by the dark poll) is starved, so
  **median-time-to-takedown is empty** for the real pipeline.

### 2b. No brand report reads the lifecycle

- Every brand metric is a point-in-time COUNT of `shopfront_clone_alerts`
  (`report-card-data.ts:206`, `report-brand-stewardship.ts:319-372`). The month SELECT
  doesn't even fetch `lifecycle_state` / `netcraft_declined_at` / `weaponised_at`.
- `clone_watch_report_summary` + `clone_watch_monthly_brand_stats` (the precomputed monthly
  stats brands read) have no `declined` / `escalated` / `taken_down` / `weaponised` fields
  (`report-summary.ts:24-38`).
- So the signal is persisted but invisible. **This is an aggregation-and-wiring gap, not a
  data-collection gap.**

### 2c. The weaponisation loop is already built — just unfed

- `clone-watch-lifecycle-recheck` (cron `0 */6 * * *`) re-scans
  `lifecycle_state IN ('monitoring','declined')` → urlscan → `apply_clone_urlscan_verdict`
  (`v200`) promotes `likely_phishing` → `weaponised` (+ `weaponised_at`) → `weaponised.v1`
  → enforcement-plan opens cases.
- It only works on clones already in `declined`/`monitoring`. Once 2a sets declined clones
  to `lifecycle_state='declined'`, this loop **automatically** starts watching them for
  weaponisation — no new machinery, just feed it.

---

## 3. The plan

Three parts. Part A fixes the broken chain (single source of truth), Part B aggregates,
Part C surfaces. Each is independently shippable and dark-flag-gated.

### Part A — Per-URL verdict reconciler (drive lifecycle from the /urls truth)

**Retire the rollup poll's role; make the per-URL reader the single Netcraft verdict
source** (the ultracode C13/C14 recommendation). The reader already fetches
`GET /submission/{uuid}/urls` per uuid; in the same pass it advances lifecycle for **every**
one of that uuid's alerts by its own `url_state` — not the rollup:

| per-URL `url_state`         | lifecycle transition            | stamp                                                                 |
| --------------------------- | ------------------------------- | --------------------------------------------------------------------- |
| `malicious`                 | → `taken_down`                  | `submitted_to.netcraft.takedown_at` (feeds the KPI, per-URL-accurate) |
| `no threats`                | → `declined`                    | `netcraft_declined_at` (+ feeds the weaponisation recheck)            |
| `unavailable`               | → `declined` (parked/cloaked)   | `netcraft_declined_at`                                                |
| `suspicious` / `processing` | leave (`monitoring`/`reported`) | recheck later                                                         |

This fixes 2a for all ~892 auto clones, populates the time-to-takedown KPI **correctly**
(per-URL, not the rollup that marks all 38 as taken-down when 1 is malicious), and feeds the
existing weaponisation recheck (2c) by setting `declined`.

**Shape (efficient — one fetch drives everything):** evolve the existing
`clone-watch-netcraft-issue` fn OR a sibling `clone-watch-netcraft-reconcile` that, per
submitted-not-lifecycle-terminal uuid: one keyless `GET /urls` → (1) advance lifecycle for
all matched alerts (uncapped — cheap reads + bulk stamps, no reporter-standing cost), (2)
file `report_issue` on the branded `declined` ones (capped, as today). Cadence: every 6h
(matches the recheck loop) — keyless GETs are free, so no daily cap on the reconcile side;
only the POST side keeps `NETCRAFT_ISSUE_DAILY_CAP`. **Do NOT re-enable the rollup poll.**

Migration: extend the worklist RPC to return all submitted-not-terminal alerts per uuid (not
just issue-pending); reuse `merge_clone_alert_submission_bulk` + `advance_clone_lifecycle`.

### Part B — Aggregate the lifecycle into the precomputed brand stats

Extend the monthly aggregation (`clone-watch-report-summary` cron `0 11 1 * *` +
`report-brand-stewardship` cron) and the live report-card query to SELECT + count the
lifecycle columns. New per-brand + overall metrics:

- `taken_down` (+ per-brand median time-to-takedown)
- `declined` (Netcraft said no — still live/parked) ← the headline "unactioned" number
- `escalated` (we filed `report_issue` — `netcraft_issue.issue_reported_at`)
- `re_taken_down_after_escalation` (declined → escalated → later `taken_down`) ← the win
- `weaponised_after_decline` (`declined`/`monitoring` → `weaponised`) ← "declined ≠ safe"

Migration v217+: add these columns to `clone_watch_report_summary` +
`clone_watch_monthly_brand_stats` (both already the precomputed, brand-read tables — so
brands read pre-aggregated rows, **zero live scans**, scalable). Add the fields to the
`CloneWatchReportCard` type + `report-card-data.ts` aggregator.

### Part C — Surface the story (honest verbs, evidence-backed)

- **Monthly brand email** (`BrandStewardshipReport.tsx`, gated `FF_BRAND_STEWARDSHIP_REPORT`):
  add a "Reported but not actioned" section — the declined count front-and-centre, the
  escalated count ("we pushed back"), the weaponised-after-decline count ("here's what
  happened when it was left alone"), and a short **watch list** of still-declined lookalikes
  with urlscan screenshots we already hold.
- **Public month page + LinkedIn carousel** (`/clone-watch/[period]`, `/admin/report-card`):
  a slide/tile for the declined→escalated→weaponised arc + the median takedown time (now
  populated). Keep the honest caption convention (`clone-watch-caption.ts`).
- **Brand-exposure teaser + B2B**: add `declined`/`weaponised` to the masked
  `brand_exposure_summary` teaser (a strong lead-gen hook: "N of your lookalikes are live
  and unactioned"). A future B2B `/api/v1/clone-report` can serve the per-brand arc from the
  precomputed stats.

**New domain term** (add to `CONTEXT.md`): **"unactioned lookalike"** — a submitted clone
Netcraft graded non-malicious (`lifecycle_state='declined'`), still live/parked,
pre-weaponisation. This is the reportable state that is uniquely ours.

---

## 4. Efficiency & scalability

- **Reconciler:** keyless GETs, grouped by uuid (one fetch per batch drives lifecycle for
  ≤50 alerts), bulk-atomic stamps. Replaces the dark poll — net-neutral-or-cheaper. Every
  6h × ~164 uuids ÷ batch = well within Inngest (a few hundred steps/day; the whole feature
  stays a small slice of the 50k/mo shared cap). No LLM, no hot-table index.
- **Reporting:** brands read the **precomputed** `clone_watch_*` stats tables (existing
  pattern) — no per-request scans. Monthly cron does the aggregation once.
- **Weaponisation:** reuses the existing recheck loop (no new scanner). Scales with the
  declined backlog, already batched (50/run, 6h cadence).

---

## 5. Flags to set TRUE to test the story end-to-end

| Flag / env                                       | Purpose                                            | Notes                                   |
| ------------------------------------------------ | -------------------------------------------------- | --------------------------------------- |
| `FF_CLONE_NETCRAFT_ISSUE`                        | the reporter/reconciler                            | already ON (dry-run)                    |
| `NETCRAFT_ISSUE_DRY_RUN=false`                   | actually file + stamp lifecycle                    | flip after the probe; start single-uuid |
| **new** `FF_CLONE_LIFECYCLE_RECONCILE`           | Part A — drive lifecycle from /urls                | new gate; test lifecycle population     |
| `FF_SHOPFRONT_CLONE_RECHECK`                     | weaponisation recheck of declined clones           | existing                                |
| `FF_SHOPFRONT_CLONE_URLSCAN` + `URLSCAN_API_KEY` | the urlscan verdict that flips declined→weaponised | existing                                |
| `FF_BRAND_STEWARDSHIP_REPORT`                    | the monthly brand email                            | to test Part C email                    |
| `FF_CLONE_WATCH_PUBLIC`                          | index the public month page                        | to test Part C public                   |
| `FF_BRAND_EXPOSURE`                              | the masked teaser                                  | to test the lead-gen hook               |
| `FF_AXIOM_ENABLED=true`                          | observability of the whole chain                   | **verify this is on**                   |

Minimal set to prove the narrative: `FF_CLONE_LIFECYCLE_RECONCILE` + `FF_SHOPFRONT_CLONE_RECHECK`

- `FF_SHOPFRONT_CLONE_URLSCAN` (+ key) to populate lifecycle, then `FF_BRAND_STEWARDSHIP_REPORT`
  to render the email against a real brand.

---

## 6. Build sequence (PRs)

- **PR3.1 — Reconciler (Part A).** Migration v217 (broadened worklist RPC + any lifecycle
  helper), evolve `clone-watch-netcraft-issue` (or sibling) to advance lifecycle per url_state
  - stamp takedown_at/declined_at. Gate `FF_CLONE_LIFECYCLE_RECONCILE`. Backfill: one run
    reconciles the 892 auto clones → lifecycle populated, KPI live, declined clones enter the
    recheck loop. Verify KPI + declined counts via SQL.
- **PR3.2 — Aggregation (Part B).** Migration v218 (stats-table columns), extend the report
  aggregators + `CloneWatchReportCard` type. Verify the monthly cron writes the new fields.
- **PR3.3 — Surfacing (Part C).** Brand email section + watch list, public/LinkedIn slide,
  teaser fields, `CONTEXT.md` term. Honest verbs; screenshot evidence.
- **PR3.4 (optional) — B2B `/api/v1/clone-report`** per-brand arc from precomputed stats.

## 7. Open questions

1. **Reconciler placement:** evolve `clone-watch-netcraft-issue` into the single per-URL
   reader (one fetch drives lifecycle + issue), or a separate `clone-watch-netcraft-reconcile`
   sibling? Recommend folding (one fetch, cap only on POSTs) for efficiency.
2. **"taken_down" semantics:** Netcraft `malicious` = they'll blocklist/action, not
   necessarily domain-removed. Keep the established `malicious → taken_down` convention (the
   KPI already assumes it) but the brand copy should say "actioned by Netcraft" not "removed".
3. **Per-brand median time-to-takedown** needs enough taken_down samples per brand — for
   small brands, fall back to the portfolio median. Confirm the copy.
4. **Backfill window:** reconcile only the last 30d of submissions (archival-safe) or all
   892? Recommend 30d rolling (matches the reporter window) + let older ones age out.
