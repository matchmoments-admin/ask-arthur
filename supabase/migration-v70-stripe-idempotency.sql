-- migration-v70-stripe-idempotency.sql
--
-- Stripe delivers webhooks with at-least-once semantics: a network blip or a
-- 5xx on our side can cause the same event.id to arrive twice. Our handlers
-- are mostly upserts so replays are usually harmless, but `updated_at`
-- clobbering and subscription-tier flapping have both been observed.
--
-- This log is a tiny idempotency gate: the webhook route INSERTs event.id
-- first; if the insert did not return a row (ON CONFLICT DO NOTHING), we
-- already processed the event and return 200 without doing the work again.

CREATE TABLE IF NOT EXISTS stripe_event_log (
  event_id     TEXT PRIMARY KEY,
  event_type   TEXT NOT NULL,
  api_version  TEXT,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_stripe_event_log_type_received
  ON stripe_event_log (event_type, received_at DESC);

ALTER TABLE stripe_event_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages stripe_event_log" ON stripe_event_log;
CREATE POLICY "Service role manages stripe_event_log"
  ON stripe_event_log FOR ALL
  USING (auth.role() = 'service_role');
