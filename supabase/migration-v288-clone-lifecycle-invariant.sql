-- Migration v288 — make the clone-lifecycle terminal-sync invariant ENFORCED
-- rather than conventional.
--
-- WHY. `shopfront_clone_alerts` carries two state columns by design (v199):
--   lifecycle_state — the fine-grained enforcement pipeline
--   alert_state     — the coarse operator disposition, and the "is this alert
--                     live" filter for the public /clone-watch page and the
--                     v198 brand-register open-count
-- v199's header states the contract: "The two are kept consistent ONLY at
-- terminal transitions (taken_down / dormant), done in advance_clone_lifecycle()
-- below, so existing alert_state consumers stay correct."
--
-- That contract was never enforced by anything. Audited 2026-08-23:
--   * no CHECK constraint mentions both columns
--   * no trigger exists on the table at all
--   * rpcs.smoke.test.ts covers 11 RPCs, of which exactly one is clone-watch
--     (a stats read) — no lifecycle guard has any test
--   * the sync rule is hand-copied into THREE writers (v199's CASE, v249's
--     CASE, v286's literal), and every one of them re-derived it
--
-- It has already failed once. v285 added a FOURTH terminal writer
-- (mark_stale_clone_alerts_dormant) without the rule; two rows went
-- lifecycle_state='dormant' with alert_state='open', which
-- aggregate_open_clone_alerts_by_brand (v198 — no date filter, no lifecycle
-- filter) would have counted as open clones on /admin/brand-register forever.
-- It was caught by a hand-written prod cross-tab, not by the system.
--
-- WHAT THIS DOES. A table CHECK: a terminal lifecycle_state REQUIRES the
-- matching coarse disposition. A future writer that forgets now fails its
-- write — loudly, at the point of the mistake — instead of silently
-- corrupting an operator-facing count that nobody re-reads for months.
--
-- Fail-loud is the deliberate choice over a self-healing trigger. This repo's
-- expensive defects are consistently the silent kind (v272's 162 stranded
-- rows, v275's 193, v285's 2), and a trigger that quietly corrects a writer
-- would hide the next author's mistake rather than teach them. The cost is
-- real and accepted: a bad write inside a bounded sweep aborts that sweep.
--
-- SAFE TO ADD TODAY — verified, not assumed. All 2,786 live rows validate:
--   lifecycle  | alert_state | n     | verdict
--   declined   | open        | 1858  | ok
--   detected   | open        |  561  | ok
--   monitoring | open        |  172  | ok
--   weaponised | open        |  107  | ok
--   taken_down | taken_down  |   86  | ok
--   dormant    | expired     |    2  | ok
-- Zero repair needed. (Note `reported` has NO rows at all — the bulk lane has
-- made 2,151 submissions and never sets it; only the low-volume manual path
-- does. Tracked separately; not this migration's business.)
--
-- The readable statement of the machine this constraint protects one corner of
-- now lives in apps/web/lib/clone-watch/lifecycle.ts. Step 2 — routing the
-- four SQL writers through one set-based transition RPC that consults the same
-- edge set — is deliberately NOT in this change: the enforcement crons run
-- daily and a bug in a consolidated writer breaks live takedown reporting.
-- This migration changes no writer and therefore carries no runtime risk.
--
-- Idempotent: dropped and re-added, and NOT VALID is not used because the
-- table already conforms.

ALTER TABLE public.shopfront_clone_alerts
  DROP CONSTRAINT IF EXISTS clone_alert_terminal_state_sync;

ALTER TABLE public.shopfront_clone_alerts
  ADD CONSTRAINT clone_alert_terminal_state_sync
  CHECK (
    lifecycle_state NOT IN ('taken_down', 'dormant')
    OR alert_state IN ('taken_down', 'expired')
  );

COMMENT ON CONSTRAINT clone_alert_terminal_state_sync
  ON public.shopfront_clone_alerts IS
  'v288: a terminal lifecycle_state requires the matching coarse alert_state (taken_down->taken_down, dormant->expired). Enforces the v199 contract that three writers each re-implemented by hand and a fourth (v285) omitted, silently inflating the brand-register open-count. Spec: apps/web/lib/clone-watch/lifecycle.ts.';
