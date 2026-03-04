-- Migration v32: Device push tokens for mobile notifications
-- Phase B1: Push notification server-side delivery

CREATE TABLE IF NOT EXISTS device_push_tokens (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  expo_token TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  device_id TEXT NOT NULL,
  region TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (expo_token)
);

-- Index for push delivery queries (active tokens, optionally by region)
CREATE INDEX IF NOT EXISTS idx_push_tokens_active
  ON device_push_tokens (active, platform)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_push_tokens_region
  ON device_push_tokens (region)
  WHERE active = true AND region IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_push_tokens_user
  ON device_push_tokens (user_id)
  WHERE user_id IS NOT NULL;

-- RPC to upsert a push token (idempotent registration)
CREATE OR REPLACE FUNCTION upsert_push_token(
  p_expo_token TEXT,
  p_platform TEXT,
  p_device_id TEXT,
  p_region TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO device_push_tokens (expo_token, platform, device_id, region, user_id, last_seen, updated_at)
  VALUES (p_expo_token, p_platform, p_device_id, p_region, p_user_id, now(), now())
  ON CONFLICT (expo_token) DO UPDATE SET
    platform = EXCLUDED.platform,
    device_id = EXCLUDED.device_id,
    region = COALESCE(EXCLUDED.region, device_push_tokens.region),
    user_id = COALESCE(EXCLUDED.user_id, device_push_tokens.user_id),
    active = true,
    last_seen = now(),
    updated_at = now();
END;
$$;
