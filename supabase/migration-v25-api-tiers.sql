-- Migration v25: API tiers + usage logging for B2B customers.
-- Adds per-key rate limits, endpoint restrictions, and usage tracking.

-- =============================================================================
-- Add tier columns to api_keys
-- =============================================================================
ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS rate_limit_per_minute INT NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS max_batch_size INT NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS allowed_endpoints TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS billing_email TEXT;

-- =============================================================================
-- Table: api_usage_log — per-key, per-endpoint, per-day usage tracking
-- =============================================================================
CREATE TABLE IF NOT EXISTS api_usage_log (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key_hash     TEXT NOT NULL,
  endpoint     TEXT NOT NULL,
  day          DATE NOT NULL DEFAULT CURRENT_DATE,
  call_count   INT NOT NULL DEFAULT 1,
  last_called  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (key_hash, endpoint, day)
);

CREATE INDEX IF NOT EXISTS idx_api_usage_key_day ON api_usage_log (key_hash, day DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_endpoint_day ON api_usage_log (endpoint, day DESC);

-- =============================================================================
-- RLS: service-role only (usage data is internal)
-- =============================================================================
ALTER TABLE api_usage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role access api_usage_log" ON api_usage_log
  FOR ALL USING (auth.role() = 'service_role');

-- =============================================================================
-- RPC: log_api_usage — upsert a usage row (fire-and-forget from API routes)
-- =============================================================================
CREATE OR REPLACE FUNCTION log_api_usage(
  p_key_hash TEXT,
  p_endpoint TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO api_usage_log (key_hash, endpoint, day, call_count, last_called)
  VALUES (p_key_hash, p_endpoint, CURRENT_DATE, 1, NOW())
  ON CONFLICT (key_hash, endpoint, day) DO UPDATE SET
    call_count = api_usage_log.call_count + 1,
    last_called = NOW();
END;
$$;
