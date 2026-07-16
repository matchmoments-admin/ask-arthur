-- migration-v236-weaponised-notified-durable-emit.sql
--
-- Fixes a durability regression in the clone-watch urlscan-retrieve step-loop
-- collapse (#762): weaponised.v1 emission relied on an in-memory array built
-- inside a single batch step. apply_clone_urlscan_verdict (v200) is one-shot
-- (newly_weaponised only on the real transition), so if the batch step is
-- interrupted AFTER a row weaponises but BEFORE the emit step runs (5m finish
-- timeout, or a mid-run deploy killing the invocation), the Inngest replay
-- re-processes the row, the RPC now returns newly_weaponised=false, the row is
-- excluded from the array, and emit-weaponised fires for everything EXCEPT it.
-- Result: the brand alert (shopfront-clone-notify-weaponised) and takedown
-- (shopfront-clone-enforcement-plan) never fire for a confirmed live phishing
-- clone, and nothing re-detects it (lifecycle-recheck only scans the
-- declined/monitoring tail).
--
-- Fix: make the "needs notification" state recoverable from persisted state.
-- weaponised.v1 is now emitted from a DB query (weaponised_at NOT NULL AND
-- weaponised_notified_at NULL) instead of an in-memory array, so a dropped
-- emission is picked up on the next tick regardless of which run detected it.
--
-- Backfill: stamp all EXISTING weaponised rows as already-notified so this
-- change does NOT re-emit historical weaponisation events on first deploy
-- (Inngest event-dedup has a limited retention window, so id-keying alone
-- wouldn't suppress re-fires of old events).
--
-- Idempotent. Reverse: DROP COLUMN weaponised_notified_at.

ALTER TABLE public.shopfront_clone_alerts
  ADD COLUMN IF NOT EXISTS weaponised_notified_at timestamptz;

COMMENT ON COLUMN public.shopfront_clone_alerts.weaponised_notified_at IS
  'When the shopfront/clone.weaponised.v1 event was emitted for this alert. NULL + weaponised_at NOT NULL = the durable emit worklist (survives an interrupted retrieve batch). Set atomically with the send.';

-- Emit worklist: weaponised but not yet notified.
CREATE INDEX IF NOT EXISTS idx_clone_alerts_weaponised_unnotified
  ON public.shopfront_clone_alerts (weaponised_at)
  WHERE weaponised_at IS NOT NULL AND weaponised_notified_at IS NULL;

-- One-time backfill: existing weaponised alerts already had their events
-- emitted via the old path — mark them notified so the new worklist starts
-- empty and only picks up genuinely-new transitions.
UPDATE public.shopfront_clone_alerts
  SET weaponised_notified_at = weaponised_at
  WHERE weaponised_at IS NOT NULL AND weaponised_notified_at IS NULL;
