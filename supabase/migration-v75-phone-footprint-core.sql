-- Migration v75: Phone Footprint — core tables, RLS, retention, RPC.
--
-- Ships the consumer + corporate phone-footprint product primitives. Tables
-- are idempotent (IF NOT EXISTS everywhere), safe to re-apply.
--
-- Naming: every table is prefixed `phone_footprint_` so they are trivially
-- locatable in the admin console and greppable in RLS reviews. Internal
-- identifiers align with the v21 intelligence-core shape
-- (BIGINT GENERATED ALWAYS AS IDENTITY, not UUID) — consistency with
-- scam_reports / scam_entities / report_entity_links simplifies joins.
--
-- MSISDN storage strategy:
--   msisdn_e164   — plaintext E.164. Indexed. JOIN-able with
--                   scam_entities.normalized_value (which stores the same
--                   canonical form). Required because the primary risk
--                   pillar runs over scam_entities.
--   msisdn_hash   — HMAC-SHA256(e164, vault_pepper). Hex. Used in logs,
--                   cross-IP abuse tracking, and any derived telemetry where
--                   we don't need to JOIN back to scam_entities. When the
--                   snapshot row ages out, anonymise_expired_footprints()
--                   replaces msisdn_e164 with 'REDACTED' and leaves the
--                   hash intact for forensic continuity without PII.
--
-- RLS pattern matches v55 (organizations) — service role full access +
-- user-scoped SELECT + org-member SELECT via org_members join. No
-- public-read (unlike scam_reports) because these rows are personal.

-- =============================================================================
-- Table: phone_footprints — one row per snapshot
-- =============================================================================
CREATE TABLE IF NOT EXISTS phone_footprints (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id            UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id             UUID REFERENCES organizations(id) ON DELETE CASCADE,
  msisdn_e164        TEXT NOT NULL,
  msisdn_hash        TEXT NOT NULL,
  tier_generated     TEXT NOT NULL CHECK (tier_generated IN ('teaser','basic','full')),
  composite_score    SMALLINT NOT NULL CHECK (composite_score BETWEEN 0 AND 100),
  band               TEXT NOT NULL CHECK (band IN ('safe','caution','high','critical')),
  pillar_scores      JSONB NOT NULL DEFAULT '{}',
  coverage           JSONB NOT NULL DEFAULT '{}',
  providers_used     TEXT[] NOT NULL DEFAULT '{}',
  explanation        TEXT,
  idempotency_key    TEXT UNIQUE,
  request_id         TEXT,
  generated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at         TIMESTAMPTZ NOT NULL,
  anonymised_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pf_msisdn_e164        ON phone_footprints (msisdn_e164);
CREATE INDEX IF NOT EXISTS idx_pf_msisdn_e164_tier   ON phone_footprints (msisdn_e164, tier_generated, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_pf_msisdn_hash        ON phone_footprints (msisdn_hash);
CREATE INDEX IF NOT EXISTS idx_pf_user               ON phone_footprints (user_id, generated_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pf_org                ON phone_footprints (org_id, generated_at DESC) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pf_expires_brin       ON phone_footprints USING BRIN (expires_at);

-- =============================================================================
-- Table: phone_footprint_monitors — saved numbers under refresh
-- =============================================================================
CREATE TABLE IF NOT EXISTS phone_footprint_monitors (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id            UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id             UUID REFERENCES organizations(id) ON DELETE CASCADE,
  msisdn_e164        TEXT NOT NULL,
  msisdn_hash        TEXT NOT NULL,
  alias              TEXT,
  scope              TEXT NOT NULL CHECK (scope IN ('self','family','fleet')),
  ownership_proof    JSONB,
  consent_granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consent_expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '13 months'),
  tier               TEXT NOT NULL CHECK (tier IN ('basic','full')),
  alert_threshold    SMALLINT NOT NULL DEFAULT 15,
  refresh_cadence    TEXT NOT NULL DEFAULT 'monthly' CHECK (refresh_cadence IN ('daily','weekly','monthly')),
  last_refreshed_at  TIMESTAMPTZ,
  next_refresh_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_footprint_id  BIGINT REFERENCES phone_footprints(id) ON DELETE SET NULL,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','consent_lapsed','revoked')),
  soft_deleted_at    TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Exactly one owner. Either user_id (personal) or org_id (fleet), never both, never neither.
  CONSTRAINT pfm_single_owner CHECK (
    (user_id IS NOT NULL AND org_id IS NULL) OR
    (user_id IS NULL AND org_id IS NOT NULL)
  )
);

-- Partial uniques — one monitor per (owner, number, scope) while active.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pfm_user_msisdn_scope
  ON phone_footprint_monitors (user_id, msisdn_hash, scope)
  WHERE user_id IS NOT NULL AND soft_deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pfm_org_msisdn_scope
  ON phone_footprint_monitors (org_id, msisdn_hash, scope)
  WHERE org_id IS NOT NULL AND soft_deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pfm_next_refresh
  ON phone_footprint_monitors (next_refresh_at)
  WHERE status = 'active' AND soft_deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pfm_consent_expires
  ON phone_footprint_monitors (consent_expires_at)
  WHERE status = 'active' AND soft_deleted_at IS NULL;

-- =============================================================================
-- Table: phone_footprint_alerts — delta events from refresh
-- =============================================================================
CREATE TABLE IF NOT EXISTS phone_footprint_alerts (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  monitor_id         BIGINT NOT NULL REFERENCES phone_footprint_monitors(id) ON DELETE CASCADE,
  prev_footprint_id  BIGINT REFERENCES phone_footprints(id) ON DELETE SET NULL,
  next_footprint_id  BIGINT NOT NULL REFERENCES phone_footprints(id) ON DELETE CASCADE,
  alert_type         TEXT NOT NULL CHECK (alert_type IN (
    'band_change','score_delta','new_breach','new_scam_reports','sim_swap','carrier_change','fraud_score_delta'
  )),
  severity           TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  details            JSONB NOT NULL DEFAULT '{}',
  delivered_channels TEXT[] NOT NULL DEFAULT '{}',
  delivered_at       TIMESTAMPTZ,
  idempotency_key    TEXT UNIQUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pfa_monitor_created
  ON phone_footprint_alerts (monitor_id, created_at DESC);

-- =============================================================================
-- Table: phone_footprint_refresh_queue — claim queue for Inngest refresh
-- =============================================================================
CREATE TABLE IF NOT EXISTS phone_footprint_refresh_queue (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  monitor_id    BIGINT NOT NULL REFERENCES phone_footprint_monitors(id) ON DELETE CASCADE,
  scheduled_for TIMESTAMPTZ NOT NULL,
  claimed_at    TIMESTAMPTZ,
  claimed_by    TEXT,
  attempts      SMALLINT NOT NULL DEFAULT 0,
  last_error    TEXT,
  completed_at  TIMESTAMPTZ,
  UNIQUE (monitor_id)
);

CREATE INDEX IF NOT EXISTS idx_pfrq_due
  ON phone_footprint_refresh_queue (scheduled_for)
  WHERE claimed_at IS NULL AND completed_at IS NULL;

-- =============================================================================
-- Table: phone_footprint_entitlements — Stripe-synced, independent of api_keys.tier
-- =============================================================================
CREATE TABLE IF NOT EXISTS phone_footprint_entitlements (
  id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id                 UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id                  UUID REFERENCES organizations(id) ON DELETE CASCADE,
  stripe_subscription_id  TEXT UNIQUE,
  stripe_price_id         TEXT,
  sku                     TEXT NOT NULL,  -- pf_personal_monthly, pf_family_annual, pf_fleet_starter_monthly, ...
  saved_numbers_limit     INT NOT NULL DEFAULT 1,
  monthly_lookup_limit    INT NOT NULL DEFAULT 90,
  refresh_cadence_min     TEXT NOT NULL DEFAULT 'monthly' CHECK (refresh_cadence_min IN ('daily','weekly','monthly')),
  features                JSONB NOT NULL DEFAULT '{}',  -- {pdf,heartbeat,claude,batch,webhook}
  family_head_user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status                  TEXT NOT NULL CHECK (status IN ('active','past_due','canceled','paused','trialing')),
  current_period_end      TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pfe_single_owner CHECK (
    (user_id IS NOT NULL AND org_id IS NULL) OR
    (user_id IS NULL AND org_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_pfe_user   ON phone_footprint_entitlements (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pfe_org    ON phone_footprint_entitlements (org_id)  WHERE org_id  IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pfe_family ON phone_footprint_entitlements (family_head_user_id) WHERE family_head_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pfe_status ON phone_footprint_entitlements (status);

-- =============================================================================
-- Table: phone_footprint_otp_attempts — Twilio Verify anti-abuse forensics
-- =============================================================================
-- OTP attempts are keyed by msisdn_hash + ip_hash + attempted_at. Used for:
--   1. Rate limiting inside /api/phone-footprint/verify/start (3/phone/24h).
--   2. Abuse forensics when an msisdn gets soft-banned (Upstash key is
--      authoritative for live state; this table is the persistent audit).
--   3. Cost correlation — every row pairs with a logCost() call.
CREATE TABLE IF NOT EXISTS phone_footprint_otp_attempts (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  msisdn_e164     TEXT NOT NULL,
  msisdn_hash     TEXT NOT NULL,
  ip_hash         TEXT NOT NULL,
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  twilio_sid      TEXT,
  status          TEXT NOT NULL CHECK (status IN ('pending','approved','denied','expired','error')),
  channel         TEXT NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms','call')),
  attempted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pfoa_msisdn_window
  ON phone_footprint_otp_attempts (msisdn_hash, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_pfoa_ip_window
  ON phone_footprint_otp_attempts (ip_hash, attempted_at DESC);

-- =============================================================================
-- RLS — service role full, users own their data, org members read fleet
-- =============================================================================
ALTER TABLE phone_footprints              ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_footprint_monitors      ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_footprint_alerts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_footprint_refresh_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_footprint_entitlements  ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_footprint_otp_attempts  ENABLE ROW LEVEL SECURITY;

-- Service role full access everywhere (matches v55 + v31 pattern).
DROP POLICY IF EXISTS "Service role access phone_footprints" ON phone_footprints;
CREATE POLICY "Service role access phone_footprints" ON phone_footprints
  FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Service role access phone_footprint_monitors" ON phone_footprint_monitors;
CREATE POLICY "Service role access phone_footprint_monitors" ON phone_footprint_monitors
  FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Service role access phone_footprint_alerts" ON phone_footprint_alerts;
CREATE POLICY "Service role access phone_footprint_alerts" ON phone_footprint_alerts
  FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Service role access phone_footprint_refresh_queue" ON phone_footprint_refresh_queue;
CREATE POLICY "Service role access phone_footprint_refresh_queue" ON phone_footprint_refresh_queue
  FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Service role access phone_footprint_entitlements" ON phone_footprint_entitlements;
CREATE POLICY "Service role access phone_footprint_entitlements" ON phone_footprint_entitlements
  FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Service role access phone_footprint_otp_attempts" ON phone_footprint_otp_attempts;
CREATE POLICY "Service role access phone_footprint_otp_attempts" ON phone_footprint_otp_attempts
  FOR ALL USING (auth.role() = 'service_role');

-- Users read their own footprints.
DROP POLICY IF EXISTS "Users read own phone_footprints" ON phone_footprints;
CREATE POLICY "Users read own phone_footprints" ON phone_footprints
  FOR SELECT USING (user_id = auth.uid());

-- Org members read footprints generated under their org (v55 pattern).
DROP POLICY IF EXISTS "Org members read phone_footprints" ON phone_footprints;
CREATE POLICY "Org members read phone_footprints" ON phone_footprints
  FOR SELECT USING (
    org_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM org_members m
      WHERE m.org_id = phone_footprints.org_id
        AND m.user_id = auth.uid()
        AND m.status = 'active'
    )
  );

-- Users manage their own monitors.
DROP POLICY IF EXISTS "Users manage own phone_footprint_monitors" ON phone_footprint_monitors;
CREATE POLICY "Users manage own phone_footprint_monitors" ON phone_footprint_monitors
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Org members read fleet monitors; owner/admin/fraud_analyst/compliance_officer can write.
DROP POLICY IF EXISTS "Org members read fleet monitors" ON phone_footprint_monitors;
CREATE POLICY "Org members read fleet monitors" ON phone_footprint_monitors
  FOR SELECT USING (
    org_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM org_members m
      WHERE m.org_id = phone_footprint_monitors.org_id
        AND m.user_id = auth.uid()
        AND m.status = 'active'
    )
  );

DROP POLICY IF EXISTS "Org staff write fleet monitors" ON phone_footprint_monitors;
CREATE POLICY "Org staff write fleet monitors" ON phone_footprint_monitors
  FOR ALL USING (
    org_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM org_members m
      WHERE m.org_id = phone_footprint_monitors.org_id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner','admin','fraud_analyst','compliance_officer')
        AND m.status = 'active'
    )
  )
  WITH CHECK (
    org_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM org_members m
      WHERE m.org_id = phone_footprint_monitors.org_id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner','admin','fraud_analyst','compliance_officer')
        AND m.status = 'active'
    )
  );

-- Alerts inherit monitor access.
DROP POLICY IF EXISTS "Users read own alerts" ON phone_footprint_alerts;
CREATE POLICY "Users read own alerts" ON phone_footprint_alerts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM phone_footprint_monitors m
      WHERE m.id = phone_footprint_alerts.monitor_id
        AND (
          m.user_id = auth.uid() OR
          (m.org_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM org_members om
            WHERE om.org_id = m.org_id AND om.user_id = auth.uid() AND om.status = 'active'
          ))
        )
    )
  );

-- Entitlements: users read own, org admins read theirs.
DROP POLICY IF EXISTS "Users read own entitlements" ON phone_footprint_entitlements;
CREATE POLICY "Users read own entitlements" ON phone_footprint_entitlements
  FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Org admins read org entitlements" ON phone_footprint_entitlements;
CREATE POLICY "Org admins read org entitlements" ON phone_footprint_entitlements
  FOR SELECT USING (
    org_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM org_members m
      WHERE m.org_id = phone_footprint_entitlements.org_id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner','admin')
        AND m.status = 'active'
    )
  );

-- =============================================================================
-- RPC: phone_footprint_internal(p_msisdn_e164)
-- =============================================================================
-- Consolidates all internal scam-data signals for a phone number into a
-- single round-trip. Backs the pillar-1 "Internal scam reports" score.
--
-- Shape note: earlier drafts called this with a hashed MSISDN. We switched to
-- the plaintext E.164 because scam_entities.normalized_value holds the same
-- canonical form — a join on the hash would require an additional column.
-- The function is SECURITY DEFINER so service_role callers bypass RLS and
-- see the full public-read scam_entities corpus without any per-caller
-- policy evaluation.
CREATE OR REPLACE FUNCTION phone_footprint_internal(p_msisdn_e164 TEXT)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  WITH ent AS (
    SELECT id, report_count, first_seen, last_seen, canonical_entity_id
    FROM scam_entities
    WHERE entity_type = 'phone'
      AND normalized_value = p_msisdn_e164
    LIMIT 1
  ),
  rep AS (
    SELECT r.id, r.verdict, r.scam_type, r.channel,
           r.verified_scam_id, r.cluster_id, r.created_at
    FROM report_entity_links l
    JOIN ent e ON l.entity_id = e.id
    JOIN scam_reports r ON r.id = l.report_id
    WHERE r.created_at > NOW() - INTERVAL '365 days'
    ORDER BY r.created_at DESC
    LIMIT 500
  ),
  agg AS (
    SELECT
      COUNT(*)                                                          AS total_reports,
      COUNT(*) FILTER (WHERE verdict = 'HIGH_RISK')                     AS high_risk_reports,
      COUNT(*) FILTER (WHERE verdict = 'SUSPICIOUS')                    AS suspicious_reports,
      COUNT(DISTINCT scam_type) FILTER (WHERE scam_type IS NOT NULL)    AS distinct_scam_types,
      COUNT(DISTINCT cluster_id) FILTER (WHERE cluster_id IS NOT NULL)  AS distinct_clusters,
      MAX(created_at)                                                   AS last_reported_at,
      MIN(created_at)                                                   AS first_reported_at,
      BOOL_OR(verified_scam_id IS NOT NULL)                             AS has_verified_scam
    FROM rep
  ),
  cluster_peers AS (
    -- Size of the largest cluster this number belongs to, counted as number of
    -- distinct reports in that cluster. Answers "is this number part of an
    -- active campaign?".
    SELECT COALESCE(MAX(c.member_count), 0) AS max_cluster_size
    FROM scam_clusters c
    WHERE c.id IN (SELECT DISTINCT cluster_id FROM rep WHERE cluster_id IS NOT NULL)
  )
  SELECT jsonb_build_object(
    'entity_id',           (SELECT id FROM ent),
    'entity_report_count', COALESCE((SELECT report_count FROM ent), 0),
    'first_seen',          (SELECT first_seen FROM ent),
    'last_seen',           (SELECT last_seen FROM ent),
    'total_reports',       COALESCE((SELECT total_reports FROM agg), 0),
    'high_risk_reports',   COALESCE((SELECT high_risk_reports FROM agg), 0),
    'suspicious_reports',  COALESCE((SELECT suspicious_reports FROM agg), 0),
    'distinct_scam_types', COALESCE((SELECT distinct_scam_types FROM agg), 0),
    'distinct_clusters',   COALESCE((SELECT distinct_clusters FROM agg), 0),
    'first_reported_at',   (SELECT first_reported_at FROM agg),
    'last_reported_at',    (SELECT last_reported_at FROM agg),
    'has_verified_scam',   COALESCE((SELECT has_verified_scam FROM agg), FALSE),
    'max_cluster_size',    COALESCE((SELECT max_cluster_size FROM cluster_peers), 0)
  );
$$;

GRANT EXECUTE ON FUNCTION phone_footprint_internal(TEXT) TO service_role;

-- =============================================================================
-- Retention: daily sweeps for expired footprints + consent-lapsed monitors
-- =============================================================================
-- Run daily via Inngest cron. Idempotent — re-running only catches newly
-- expired rows.
CREATE OR REPLACE FUNCTION anonymise_expired_footprints()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INT;
BEGIN
  WITH updated AS (
    UPDATE phone_footprints
    SET msisdn_e164  = 'REDACTED',
        pillar_scores = '{}'::jsonb,
        explanation   = NULL,
        anonymised_at = NOW()
    WHERE expires_at < NOW() - INTERVAL '7 days'
      AND anonymised_at IS NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_updated FROM updated;
  RETURN v_updated;
END;
$$;

CREATE OR REPLACE FUNCTION sweep_inactive_monitors()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INT;
BEGIN
  WITH lapsed AS (
    UPDATE phone_footprint_monitors
    SET status = 'consent_lapsed',
        updated_at = NOW()
    WHERE status = 'active'
      AND soft_deleted_at IS NULL
      AND consent_expires_at < NOW()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_updated FROM lapsed;
  RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION anonymise_expired_footprints() TO service_role;
GRANT EXECUTE ON FUNCTION sweep_inactive_monitors()      TO service_role;

-- =============================================================================
-- RPC: sync_phone_footprint_entitlements — called from Stripe webhook
-- =============================================================================
-- Isolated from sync_subscription_tier (api_keys) so Phone Footprint can
-- be upgraded/downgraded without touching Arthur's core B2B API tier.
CREATE OR REPLACE FUNCTION sync_phone_footprint_entitlements(
  p_user_id                 UUID,
  p_org_id                  UUID,
  p_stripe_subscription_id  TEXT,
  p_stripe_price_id         TEXT,
  p_sku                     TEXT,
  p_status                  TEXT,
  p_current_period_end      TIMESTAMPTZ,
  p_saved_numbers_limit     INT,
  p_monthly_lookup_limit    INT,
  p_refresh_cadence_min     TEXT,
  p_features                JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO phone_footprint_entitlements (
    user_id, org_id, stripe_subscription_id, stripe_price_id, sku, status,
    current_period_end, saved_numbers_limit, monthly_lookup_limit,
    refresh_cadence_min, features
  ) VALUES (
    p_user_id, p_org_id, p_stripe_subscription_id, p_stripe_price_id, p_sku, p_status,
    p_current_period_end, p_saved_numbers_limit, p_monthly_lookup_limit,
    p_refresh_cadence_min, COALESCE(p_features, '{}'::jsonb)
  )
  ON CONFLICT (stripe_subscription_id) DO UPDATE SET
    sku                   = EXCLUDED.sku,
    stripe_price_id       = EXCLUDED.stripe_price_id,
    status                = EXCLUDED.status,
    current_period_end    = EXCLUDED.current_period_end,
    saved_numbers_limit   = EXCLUDED.saved_numbers_limit,
    monthly_lookup_limit  = EXCLUDED.monthly_lookup_limit,
    refresh_cadence_min   = EXCLUDED.refresh_cadence_min,
    features              = EXCLUDED.features,
    updated_at            = NOW();
END;
$$;

GRANT EXECUTE ON FUNCTION sync_phone_footprint_entitlements(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, INT, INT, TEXT, JSONB
) TO service_role;

-- =============================================================================
-- Admin metrics view
-- =============================================================================
CREATE OR REPLACE VIEW v_phone_footprint_metrics AS
SELECT
  date_trunc('day', generated_at AT TIME ZONE 'UTC')::date AS day,
  tier_generated,
  COUNT(*) FILTER (WHERE user_id IS NULL AND org_id IS NULL) AS anon_lookups,
  COUNT(*) FILTER (WHERE user_id IS NOT NULL AND org_id IS NULL) AS user_lookups,
  COUNT(*) FILTER (WHERE org_id IS NOT NULL)                 AS fleet_lookups,
  AVG(composite_score)::INT                                  AS avg_score,
  COUNT(*) FILTER (WHERE band = 'high')                      AS high_count,
  COUNT(*) FILTER (WHERE band = 'critical')                  AS critical_count
FROM phone_footprints
WHERE anonymised_at IS NULL
GROUP BY 1, 2;

GRANT SELECT ON v_phone_footprint_metrics TO service_role;
