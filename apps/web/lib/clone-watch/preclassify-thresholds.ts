// Clone-watch pre-classifier thresholds — the ONE home for every number a
// gate compares `clone_watch_classifications.confidence` against.
//
// Since 2026-09-22 (ADR-0026) `confidence` is TypeSafe Jev's `is_clone_p`:
// a calibrated P(clone). Before that it was Haiku's self-reported certainty
// about its own boolean, which the 2026-09-20 back-test showed had no
// predictive power (a flat curve across three bins ≥ 0.7). These numbers
// were chosen from the day-1 calibration over 3,526 alerts
// (`clone_watch_jev_calibration()`, v312 edges — FROZEN to that pre-swap
// cohort since v313; the 30-day revisit reads live gate rows via
// `clone_watch_preclassify_calibration(p_since)`, v314):
//
//   jev p ≥ 0.4  → n 2857 · 156 weaponised · 305 FP   (Haiku ≥ 0.7: 2923 / 160 / 334)
//   jev p ≥ 0.5  → n 2336 · 146 weaponised · 197 FP
//   jev p ≥ 0.8  → n  346 ·  40 weaponised ·   2 FP   (Haiku ≥ 0.9: 1083 /  88 /  47)
//
// Why they live together: the fn that PRODUCES `confidence` and the four
// fns that GATE on it used to hold their constants in five files with
// nothing comparing them (memory: mutually unsatisfiable constants). A
// retune is now one edit here, and `preclassifyThresholds.test.ts` pins the
// ordering IS_CLONE_MIN_P ≤ WORKLIST_MIN_CONFIDENCE ≤ 1 and that no consumer
// carries a local literal.
//
// AUTO_CONFIRM_MIN_CONFIDENCE (0.8, the ≥ 0.8 row above) retired with
// clone-watch-auto-triage on 2026-09-26 (#1230): it had no other reader, and a
// threshold nothing enforces reads as a control that exists. If brand
// auto-confirm returns (after the #1237 readiness gate), re-derive it here.
//
// Revisit after 30 days of `source='live'` Jev rows (docs/ops/clone-watch-config.md § 8c).

/** `is_clone` = `is_clone_p >= IS_CLONE_MIN_P`. Below it the pre-classifier's
 *  auto-park may park the alert (weak signal only — lib/clone-watch/auto-park.ts). */
export const IS_CLONE_MIN_P = 0.4;

/** urlscan-submit, the dormant sweep and netcraft-auto admit `is_clone AND confidence >= this`. */
export const WORKLIST_MIN_CONFIDENCE = 0.4;

/** A risk indicator is listed in `risk_indicators[]` when its noul probability reaches this. */
export const RISK_INDICATOR_MIN_P = 0.5;
