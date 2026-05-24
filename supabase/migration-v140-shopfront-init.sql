-- v140 — Shopfront clone-detection foundation tables.
--
-- Ships the locked schema from #376 forward to Layer 0 (clone-watch MVP).
-- Tables created here:
--   * shopfront_shops              — installed Shopify merchant index. Empty
--                                     at MVP; populated when #373 installs the
--                                     Shield app on a development store.
--                                     Extended (token columns, verification
--                                     state) by #373.
--   * shopfront_clone_alerts       — single write target for ALL clone
--                                     detections across Layer 0 / Phase A /
--                                     Phase B / Phase C (ADR-0016).
--   * shopfront_takedown_attempts  — DMCA / registrar / Cloudflare /
--                                     Shopify-abuse attempt log per alert.
--
-- Layer 0 (this MVP) writes target_shop_id IS NULL + source = 'nrd' rows
-- only. The CHECK constraint and idx_clone_alerts_unverified partial index
-- support that branch without further migration.

-- ---------------------------------------------------------------------------
-- shopfront_shops — minimal scaffold. #373 will extend with token columns,
-- verification state, plan tier, etc.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shopfront_shops (
  id              BIGSERIAL PRIMARY KEY,
  shop_domain     TEXT NOT NULL UNIQUE,
  shopify_shop_id TEXT,
  installed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uninstalled_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.shopfront_shops ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shopfront_shops_service_role_all ON public.shopfront_shops;
CREATE POLICY shopfront_shops_service_role_all
  ON public.shopfront_shops
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- shopfront_clone_alerts — write target for all clone detections.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shopfront_clone_alerts (
  id BIGSERIAL PRIMARY KEY,

  target_shop_id          BIGINT REFERENCES public.shopfront_shops(id) ON DELETE CASCADE,
  inferred_target_domain  TEXT,
  CONSTRAINT clone_alerts_target_xor CHECK (
       (target_shop_id IS NOT NULL AND inferred_target_domain IS NULL)
    OR (target_shop_id IS NULL     AND inferred_target_domain IS NOT NULL)
  ),

  candidate_domain        TEXT NOT NULL,
  candidate_url           TEXT NOT NULL,
  url_hash                TEXT NOT NULL,

  signals                 JSONB NOT NULL DEFAULT '[]'::jsonb,

  severity                SMALLINT NOT NULL CHECK (severity BETWEEN 0 AND 100),
  severity_tier           TEXT NOT NULL CHECK (severity_tier IN ('low', 'medium', 'high', 'critical')),

  source                  TEXT NOT NULL CHECK (source IN (
    'corpus', 'certstream_calidog', 'lexical_pattern', 'nrd', 'hetzner_certstream'
  )),

  last_fetched_at         TIMESTAMPTZ,
  fetch_status            TEXT CHECK (fetch_status IN (
    'pending', 'success', 'timeout',
    'robots_blocked', 'http_error', 'tls_error', 'dns_error'
  )),

  first_seen_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  alert_state             TEXT NOT NULL DEFAULT 'open' CHECK (alert_state IN (
    'open', 'acknowledged', 'taken_down', 'dismissed', 'expired'
  )),

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_clone_alerts_target_url
  ON public.shopfront_clone_alerts (
    COALESCE(target_shop_id::text, inferred_target_domain),
    url_hash
  );

CREATE INDEX IF NOT EXISTS idx_clone_alerts_shop_open
  ON public.shopfront_clone_alerts (target_shop_id, severity DESC, first_seen_at DESC)
  WHERE alert_state = 'open' AND target_shop_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clone_alerts_unverified
  ON public.shopfront_clone_alerts (source, first_seen_at DESC)
  WHERE target_shop_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_clone_alerts_url_hash
  ON public.shopfront_clone_alerts (url_hash);

ALTER TABLE public.shopfront_clone_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shopfront_clone_alerts_service_role_all ON public.shopfront_clone_alerts;
CREATE POLICY shopfront_clone_alerts_service_role_all
  ON public.shopfront_clone_alerts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- shopfront_takedown_attempts — per-alert takedown attempt log. Unused at
-- Layer 0 (no takedown work yet); populated by Shield Pro tier (#377).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shopfront_takedown_attempts (
  id                    BIGSERIAL PRIMARY KEY,
  clone_alert_id        BIGINT NOT NULL REFERENCES public.shopfront_clone_alerts(id) ON DELETE CASCADE,
  attempt_type          TEXT NOT NULL CHECK (attempt_type IN (
    'dmca', 'registrar_abuse', 'cloudflare_host_abuse', 'shopify_dmca'
  )),
  initiated_by          TEXT NOT NULL CHECK (initiated_by IN (
    'merchant_self_serve', 'askarthur_ops'
  )),
  initiated_by_user_id  UUID REFERENCES auth.users(id),
  template_version      TEXT NOT NULL,
  recipient_email       TEXT,
  recipient_org         TEXT,
  body_md               TEXT NOT NULL,
  drafted_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at               TIMESTAMPTZ,
  response_at           TIMESTAMPTZ,
  outcome               TEXT CHECK (outcome IN (
    'pending', 'taken_down', 'rejected', 'no_response', 'partially_resolved'
  )),
  outcome_notes         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_takedown_attempts_clone_alert
  ON public.shopfront_takedown_attempts (clone_alert_id, drafted_at DESC);

ALTER TABLE public.shopfront_takedown_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shopfront_takedown_attempts_service_role_all ON public.shopfront_takedown_attempts;
CREATE POLICY shopfront_takedown_attempts_service_role_all
  ON public.shopfront_takedown_attempts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
