-- v61: Per-install extension identity
-- Replaces the shared WXT_EXTENSION_SECRET with a per-install ECDSA P-256
-- public key registered through a Turnstile-gated endpoint. Request signatures
-- verified against this table. install_id stays the existing random UUID so
-- extension_subscriptions (v34) mappings are unaffected.

CREATE TABLE IF NOT EXISTS extension_installs (
  install_id        TEXT PRIMARY KEY,
  public_key_jwk    JSONB NOT NULL,
  registered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked           BOOLEAN NOT NULL DEFAULT false,
  revoked_reason    TEXT,
  ip_hash           TEXT,
  turnstile_country TEXT
);

CREATE INDEX IF NOT EXISTS idx_extension_installs_last_seen
  ON extension_installs (last_seen_at);

CREATE INDEX IF NOT EXISTS idx_extension_installs_revoked
  ON extension_installs (revoked)
  WHERE revoked = true;
