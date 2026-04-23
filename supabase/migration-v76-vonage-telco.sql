-- Migration v76: Vonage / telco signal tables — ship schema in Sprint 1,
-- populate when Aduna + Telstra approval lands (Sprint 6).
--
-- Rationale: this migration ships BEFORE live Vonage to guarantee that the
-- moment `FF_VONAGE_MOCK_MODE=false` flips, every write path already has a
-- durable landing zone and the composite scorer can read from
-- telco_signal_history without a coordinated schema change. Mock adapters
-- write `source = 'mock'` rows during Sprints 2–5 so the Inngest consumer
-- code-path is exercised end-to-end before real carrier traffic arrives.
--
-- All tables use BIGINT IDs for consistency with v21–v74. RLS is service-role
-- only — telco signals are never exposed directly to end users; they flow
-- into phone_footprints.pillar_scores where user-facing RLS already applies.

-- =============================================================================
-- Table: sim_swap_monitors — per-number registration for CAMARA SIM Swap
-- =============================================================================
CREATE TABLE IF NOT EXISTS sim_swap_monitors (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id          UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id           UUID REFERENCES organizations(id) ON DELETE CASCADE,
  msisdn_e164      TEXT NOT NULL,
  msisdn_hash      TEXT NOT NULL,
  max_age_hours    INT NOT NULL DEFAULT 240,  -- 10 days — carrier retention window
  webhook_url      TEXT,
  webhook_secret   TEXT,                      -- HMAC, AES-GCM encrypted at app layer
  provider         TEXT NOT NULL DEFAULT 'vonage' CHECK (provider IN ('vonage','twilio','mock')),
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  last_check_at    TIMESTAMPTZ,
  soft_deleted_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ssm_single_owner CHECK (
    (user_id IS NOT NULL AND org_id IS NULL) OR
    (user_id IS NULL AND org_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_ssm_user        ON sim_swap_monitors (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ssm_org         ON sim_swap_monitors (org_id)  WHERE org_id  IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ssm_msisdn_hash ON sim_swap_monitors (msisdn_hash);
CREATE INDEX IF NOT EXISTS idx_ssm_active      ON sim_swap_monitors (active) WHERE active = TRUE AND soft_deleted_at IS NULL;

-- =============================================================================
-- Table: sim_swap_events — append-only log of swap check results
-- =============================================================================
-- Every call to CAMARA /sim-swap/check lands one row here. `swapped = TRUE`
-- means the carrier confirmed a swap within `max_age_hours`. `source = 'mock'`
-- rows during mock-mode simulate negative checks so downstream scoring is
-- exercised.
CREATE TABLE IF NOT EXISTS sim_swap_events (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  monitor_id      BIGINT REFERENCES sim_swap_monitors(id) ON DELETE SET NULL,
  msisdn_e164     TEXT NOT NULL,
  msisdn_hash     TEXT NOT NULL,
  swapped         BOOLEAN NOT NULL,
  swap_date       TIMESTAMPTZ,
  max_age_checked INT,
  source          TEXT NOT NULL CHECK (source IN ('vonage','twilio','mock')),
  raw_response    JSONB NOT NULL DEFAULT '{}',
  latency_ms      INT,
  cost_usd        NUMERIC(8,4),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sse_msisdn_hash ON sim_swap_events (msisdn_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sse_monitor     ON sim_swap_events (monitor_id, created_at DESC) WHERE monitor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sse_swapped     ON sim_swap_events (swapped, created_at DESC) WHERE swapped = TRUE;
CREATE INDEX IF NOT EXISTS idx_sse_created_brin ON sim_swap_events USING BRIN (created_at);

-- =============================================================================
-- Table: device_swap_events — CAMARA Device Swap check results
-- =============================================================================
-- Device swap ≠ SIM swap: same SIM, new handset. Useful as a secondary signal
-- (e.g., SIM-swap-clean number with a sudden device change might still be a
-- takeover if paired with carrier drift).
CREATE TABLE IF NOT EXISTS device_swap_events (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  msisdn_e164     TEXT NOT NULL,
  msisdn_hash     TEXT NOT NULL,
  swapped         BOOLEAN NOT NULL,
  swap_date       TIMESTAMPTZ,
  max_age_checked INT,
  source          TEXT NOT NULL CHECK (source IN ('vonage','twilio','mock')),
  raw_response    JSONB NOT NULL DEFAULT '{}',
  latency_ms      INT,
  cost_usd        NUMERIC(8,4),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dse_msisdn_hash ON device_swap_events (msisdn_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dse_created_brin ON device_swap_events USING BRIN (created_at);

-- =============================================================================
-- Table: subscriber_match_checks — CAMARA KYC Match
-- =============================================================================
-- Given a claimed name and a phone, ask the carrier "does this number belong
-- to this person?". Used for high-value corporate onboarding / account
-- takeover remediation. Extremely privacy-sensitive — we never log the raw
-- name, only a hash. The match result is a categorical ("match"/"mismatch"/
-- "unavailable") plus a confidence score.
CREATE TABLE IF NOT EXISTS subscriber_match_checks (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  msisdn_e164          TEXT NOT NULL,
  msisdn_hash          TEXT NOT NULL,
  requested_name_hash  TEXT NOT NULL,
  match_result         TEXT NOT NULL CHECK (match_result IN ('match','mismatch','partial','unavailable')),
  confidence           NUMERIC(3,2) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  source               TEXT NOT NULL CHECK (source IN ('vonage','twilio','mock')),
  raw_response         JSONB NOT NULL DEFAULT '{}',
  latency_ms           INT,
  cost_usd             NUMERIC(8,4),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_smc_msisdn_hash ON subscriber_match_checks (msisdn_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_smc_created_brin ON subscriber_match_checks USING BRIN (created_at);

-- =============================================================================
-- Table: telco_signal_history — unified timeline of telco-derived facts
-- =============================================================================
-- Keyed by scam_entities.id so the risk scorer can join phone footprint data
-- to the existing entity risk machinery (compute_entity_risk_score v24/v26/v27).
-- signal_type values are intentionally open-coded — future carrier features
-- like `roaming_anomaly` or `reachability_flap` slot in without schema churn.
CREATE TABLE IF NOT EXISTS telco_signal_history (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_id    BIGINT NOT NULL REFERENCES scam_entities(id) ON DELETE CASCADE,
  signal_type  TEXT NOT NULL CHECK (signal_type IN (
    'sim_swap','device_swap','carrier_drift','reachability','roaming','subscriber_match'
  )),
  signal_value JSONB NOT NULL,
  severity     SMALLINT CHECK (severity IS NULL OR (severity >= 0 AND severity <= 100)),
  source       TEXT NOT NULL CHECK (source IN ('vonage','twilio','mock')),
  observed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tsh_entity     ON telco_signal_history (entity_id, signal_type, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_tsh_type_obs   ON telco_signal_history (signal_type, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_tsh_obs_brin   ON telco_signal_history USING BRIN (observed_at);

-- =============================================================================
-- Table: telco_api_usage — per-call cost accounting
-- =============================================================================
-- Duplicates some telemetry that logCost() writes to cost_telemetry, but this
-- row shape is telco-specific (provider, endpoint, status, latency) and is
-- consumed by the admin Vonage-health panel + MNC/MCC coverage heatmap.
-- Keep both: cost_telemetry is the finance source-of-truth, telco_api_usage
-- is the operational dashboard source.
CREATE TABLE IF NOT EXISTS telco_api_usage (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider     TEXT NOT NULL CHECK (provider IN ('vonage','twilio','mock')),
  endpoint     TEXT NOT NULL,
  user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  org_id       UUID REFERENCES organizations(id) ON DELETE SET NULL,
  msisdn_hash  TEXT,
  status       TEXT NOT NULL CHECK (status IN ('ok','timeout','error','mock','rate_limited','unauthorized')),
  latency_ms   INT,
  cost_usd     NUMERIC(8,4),
  cost_aud     NUMERIC(8,4),
  metadata     JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tau_provider_created ON telco_api_usage (provider, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tau_status           ON telco_api_usage (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tau_created_brin     ON telco_api_usage USING BRIN (created_at);

-- =============================================================================
-- Table: telco_webhook_subscriptions — CAMARA Webhook subscription state
-- =============================================================================
-- Vonage's CAMARA SIM-swap webhook requires a subscription per number. Status
-- starts 'pending' on creation and moves to 'active' after handshake; can be
-- 'suspended' (e.g., carrier throttling) or 'revoked' (user removed monitor).
CREATE TABLE IF NOT EXISTS telco_webhook_subscriptions (
  id                        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id                    UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id                   UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  monitor_id                BIGINT REFERENCES sim_swap_monitors(id) ON DELETE CASCADE,
  provider                  TEXT NOT NULL CHECK (provider IN ('vonage','twilio','mock')),
  event_type                TEXT NOT NULL,
  subscription_id_external  TEXT,
  status                    TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended','revoked','error')),
  last_heartbeat_at         TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tws_monitor ON telco_webhook_subscriptions (monitor_id) WHERE monitor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tws_status  ON telco_webhook_subscriptions (status);

-- =============================================================================
-- Table: telco_provider_health — 5-minute rolling health snapshot per endpoint
-- =============================================================================
-- Written by an Inngest cron (Sprint 10) that computes success_rate + p95
-- from recent telco_api_usage rows. The admin panel reads the latest row per
-- (provider, endpoint) for at-a-glance provider health.
CREATE TABLE IF NOT EXISTS telco_provider_health (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider         TEXT NOT NULL CHECK (provider IN ('vonage','twilio','mock')),
  endpoint         TEXT NOT NULL,
  mode             TEXT NOT NULL CHECK (mode IN ('live','mock','degraded','down')),
  success_rate_5m  NUMERIC(5,2),
  p95_latency_ms   INT,
  sample_count_5m  INT,
  observed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tph_provider_obs ON telco_provider_health (provider, endpoint, observed_at DESC);

-- =============================================================================
-- RLS — service role only. End users never read these directly.
-- =============================================================================
ALTER TABLE sim_swap_monitors          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sim_swap_events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_swap_events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriber_match_checks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE telco_signal_history       ENABLE ROW LEVEL SECURITY;
ALTER TABLE telco_api_usage            ENABLE ROW LEVEL SECURITY;
ALTER TABLE telco_webhook_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE telco_provider_health      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role access sim_swap_monitors" ON sim_swap_monitors;
CREATE POLICY "Service role access sim_swap_monitors" ON sim_swap_monitors
  FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Service role access sim_swap_events" ON sim_swap_events;
CREATE POLICY "Service role access sim_swap_events" ON sim_swap_events
  FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Service role access device_swap_events" ON device_swap_events;
CREATE POLICY "Service role access device_swap_events" ON device_swap_events
  FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Service role access subscriber_match_checks" ON subscriber_match_checks;
CREATE POLICY "Service role access subscriber_match_checks" ON subscriber_match_checks
  FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Service role access telco_signal_history" ON telco_signal_history;
CREATE POLICY "Service role access telco_signal_history" ON telco_signal_history
  FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Service role access telco_api_usage" ON telco_api_usage;
CREATE POLICY "Service role access telco_api_usage" ON telco_api_usage
  FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Service role access telco_webhook_subscriptions" ON telco_webhook_subscriptions;
CREATE POLICY "Service role access telco_webhook_subscriptions" ON telco_webhook_subscriptions
  FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Service role access telco_provider_health" ON telco_provider_health;
CREATE POLICY "Service role access telco_provider_health" ON telco_provider_health
  FOR ALL USING (auth.role() = 'service_role');

-- Org admins can read sim_swap_monitors for their org (for fleet dashboard).
DROP POLICY IF EXISTS "Org admins read sim_swap_monitors" ON sim_swap_monitors;
CREATE POLICY "Org admins read sim_swap_monitors" ON sim_swap_monitors
  FOR SELECT USING (
    org_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM org_members m
      WHERE m.org_id = sim_swap_monitors.org_id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner','admin','fraud_analyst','compliance_officer')
        AND m.status = 'active'
    )
  );

-- Users read their own sim_swap_monitors (for mobile "Heartbeat" feature).
DROP POLICY IF EXISTS "Users read own sim_swap_monitors" ON sim_swap_monitors;
CREATE POLICY "Users read own sim_swap_monitors" ON sim_swap_monitors
  FOR SELECT USING (user_id = auth.uid());
