---
status: accepted
date: 2026-09-22
---

# Jev is the clone-watch pre-classifier

The clone-watch pre-classifier's `confidence` gates four worklists (urlscan-submit, the dormant sweep, netcraft-auto at `>= 0.7`), auto-triage's auto-confirm (`>= 0.9`) and the weaponisation-risk score, and the number Claude Haiku 4.5 produced had no predictive power: over all 3,526 alerts (2026-09-20, `clone_watch_jev_calibration()` v312) 83% of rows sat in three bins `>= 0.7` whose weaponised rates were 2.5 / 4.7 / 8.1% and FP rates 25.6 / 10.4 / 4.4% — the Netcraft lane had already measured the same flat curve (v284). TypeSafe Jev, a decision-only model that returns calibrated probabilities, was run as a **shadow lane** (v311, ADR-vocabulary in `CONTEXT.md`) on the identical three-field input, and its `is_clone_p` was monotone on both axes: weaponised 1.5 → 1.9 → 3.4 → 5.1 → 7.6 → 11.8% and FP 23 → 21 → 14 → 10 → 5.4 → 0.6% across deciles 4–9, at $0.000048/call (52× cheaper) and 405 ms p95 (~7× faster). **We decided Jev is the pre-classifier**: it writes the v157 `clone_watch_classifications` row every gate already reads, in the same shape, with `confidence` now meaning **P(clone)**; the gates are retuned to that scale — worklist `>= 0.4` (n 2857 / 156 weaponised / 305 FP, the same throughput as Haiku's `>= 0.7`: 2923 / 160 / 334) and auto-confirm `>= 0.8` (346 / 40 / **2 FP** vs Haiku's `>= 0.9`: 1083 / 88 / 47) — and every threshold lives in one module, `apps/web/lib/clone-watch/preclassify-thresholds.ts`, pinned by a source-scan test.

## Considered options

- **Point every reader at the v311 Jev table** (`is_clone_p`). Rejected: rewrites five RPCs, auto-triage, the risk scorer, three report readers and the fan-out selector — the exact worklist-predicate class that silently starved twice in 2026 (v224, v252). "Same table, same shape, new producer" leaves every reader untouched and the selector `list_clone_alerts_pending_preclassify` keys on the same row's absence.
- **Keep Haiku and blend** (average, or Jev as a second opinion). Rejected: a flat signal averaged with a calibrated one is a less calibrated one, and it keeps the $0.0025 call.
- **Delete the Haiku path outright.** Rejected for one release: the vendor is early-access with self-reported benchmarks and pricing it admits may be subsidised; `FF_CLONE_WATCH_JEV_PRIMARY` OFF is the rollback and costs nothing to keep.

## Consequences

- `clone_watch_classifications.confidence` changes meaning on 2026-09-22 from "Haiku's certainty about its own boolean" to "P(clone)". `model_id` (`jev-…` vs `claude-…`) is the cohort discriminator; `clone_watch_jev_calibration()` restricts its haiku side to genuine Haiku rows (v313). `computeWeaponisationRisk` (`confidence × 20`) and `list_clone_alerts_pending_triage.likely_tp` (`>= 0.6`, ordering only) are left as-is — both are scoring/ordering, not gates, and P(clone) is a better input to both; mid-p rows will score lower than before because they are now honestly scored.
- `reason` is synthesized from the probabilities (`jev p=0.71 · brandjack (0.80) · …`); no TypeScript reader existed.
- Tactic and intent distributions in `clone_watch_classification_trends` and the monthly targeting-intelligence report carry a **discontinuity at 2026-09-22** (agreement with Haiku was 63% / 56% on the backfill). Annotate, do not backfill.
- One vendor call now writes both siblings (the v157 gate row first — its failure throws and Inngest retries; the v311 raw row second — its failure is a warn). Cost rows stay under `shopfront_clone_preclassify` with `provider='typesafe'`, so the absence watch, the `SHOPFRONT_CLONE_OUTREACH_CAP_USD` brake and `/admin/costs` are unchanged. The shadow lane's own absence watch is removed; in rollback mode the shadow tail is unattended (accepted, documented).
- The measurement's outcome labels (`weaponised_at`, `urlscan_classification`) come from urlscan, which only saw what Haiku's gate admitted — the bias favoured Haiku, so Jev's recall on Haiku-rejected rows is unobserved. Revisit 0.4 / 0.8 after 30 days of `source='live'` rows; a retune is one edit in the thresholds module.
- Rollback: `FF_CLONE_WATCH_JEV_PRIMARY=false`. Rows Jev already wrote keep `model_id='jev-…'`; the gates at 0.4 / 0.8 then read Haiku's confidence (historically ≤ 5 Haiku rows in [0.4, 0.7)).
