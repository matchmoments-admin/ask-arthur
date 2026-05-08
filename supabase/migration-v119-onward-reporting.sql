-- migration-v119: Onward reporting — extends known_brands with abuse-contact
-- metadata, seeds an additional ~14 brands, and creates onward_report_log +
-- get_onward_destinations() RPC.
--
-- Lights up the brand_impersonation_alerts pipeline created in v49 by giving
-- the Inngest brand-abuse worker a typed registry to read. Idempotent — every
-- statement guarded with IF NOT EXISTS / DO blocks (ENUM types don't support
-- IF NOT EXISTS directly so we wrap them).

BEGIN;

-- ---------------------------------------------------------------------------
-- v119.1 Extend known_brands
-- ---------------------------------------------------------------------------

ALTER TABLE public.known_brands
  ADD COLUMN IF NOT EXISTS contact_type TEXT NOT NULL DEFAULT 'email',
  ADD COLUMN IF NOT EXISTS evidence_format TEXT,
  ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS verified_by TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS source_url TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'known_brands_contact_type_ck'
  ) THEN
    ALTER TABLE public.known_brands
      ADD CONSTRAINT known_brands_contact_type_ck
      CHECK (contact_type IN ('email','webform','inproduct'));
  END IF;
END$$;

-- Brand_key is the stable lookup token used by the Inngest router. Existing
-- v49 rows used brand_name; we add a brand_key that defaults to the lowercased
-- snake-case of brand_name for backwards-compat.
ALTER TABLE public.known_brands
  ADD COLUMN IF NOT EXISTS brand_key TEXT;

-- Backfill brand_key for existing rows (idempotent)
UPDATE public.known_brands
SET brand_key = lower(regexp_replace(brand_name, '[^a-zA-Z0-9]+', '_', 'g'))
WHERE brand_key IS NULL;

-- Backfill last_verified_at + verified_by + source_url for the v49 seed rows
-- so the staleness cron has a consistent baseline.
UPDATE public.known_brands
SET verified_by = COALESCE(verified_by, 'seed-v49'),
    source_url = COALESCE(source_url, security_contact_url)
WHERE verified_by IS NULL OR source_url IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS known_brands_brand_key_active_idx
  ON public.known_brands (brand_key) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS known_brands_active_idx
  ON public.known_brands (is_active) WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- v119.2 Seed additional brands (idempotent — uses brand_name unique key)
--
-- Notes on inclusions:
--   - Meta is contact_type='webform' (phish@fb.com is DEPRECATED — verified
--     in research block, do not seed it).
--   - Google's safebrowsing form is the primary path; legacy email is fallback.
--   - 'optus' v49 seed uses scam.team@optus.com.au which we keep; research
--     block's abuse@optusnet.com.au is the legacy domain — flagged in notes.
-- ---------------------------------------------------------------------------

INSERT INTO public.known_brands
  (brand_name, brand_domain, brand_category, security_contact_email,
   security_contact_url, contact_type, evidence_format, last_verified_at,
   verified_by, is_active, notes, source_url)
VALUES
  ('Apple', 'apple.com', 'tech', 'reportphishing@apple.com', NULL, 'email',
   'Forwarded email with headers', now(), 'seed-v119', true, NULL,
   'https://support.apple.com/en-au/102568'),
  ('PayPal', 'paypal.com', 'fintech', 'phishing@paypal.com', NULL, 'email',
   'Forwarded email as attachment', now(), 'seed-v119',
   true, 'spoof@paypal.com aliases here',
   'https://www.paypal.com/au/security/reporting-a-scam'),
  ('Microsoft', 'microsoft.com', 'tech', 'phish@office365.microsoft.com',
   'https://report.microsoft.com', 'email',
   'Report Message add-in preferred over free-form email', now(), 'seed-v119',
   true, 'In-product reporting preferred',
   'https://support.microsoft.com'),
  ('eBay', 'ebay.com.au', 'retailer', 'spoof@ebay.com', NULL, 'email',
   'Forwarded email as attachment', now(), 'seed-v119', true, NULL,
   'https://www.ebay.com/help/account/protecting-account/recognizing-reporting-fake-emails-websites'),
  ('Netflix', 'netflix.com', 'streaming', 'phishing@netflix.com', NULL, 'email',
   'Forwarded email', now(), 'seed-v119', true, NULL,
   'https://help.netflix.com/node/65674'),
  ('LinkedIn', 'linkedin.com', 'social', 'phishing@linkedin.com', NULL, 'email',
   'Forwarded email', now(), 'seed-v119', true, NULL,
   'https://www.linkedin.com/help/linkedin/answer/a1340696'),
  ('Binance', 'binance.com', 'crypto', 'report.phishing@binance.com', NULL,
   'email', 'Forwarded email + URL + wallet address', now(), 'seed-v119',
   true, NULL, 'https://www.binance.com/en/support'),
  ('Coinbase', 'coinbase.com', 'crypto', 'security@coinbase.com', NULL, 'email',
   'Forwarded email + URL', now(), 'seed-v119', true, NULL,
   'https://help.coinbase.com/en/coinbase/privacy-and-security/avoiding-phishing-and-scams/how-to-report-phishing-sites-and-emails'),
  ('Meta', 'facebook.com', 'social', NULL, 'https://www.facebook.com/help/reportlinks',
   'webform', 'In-product / web form', now(), 'seed-v119', true,
   'phish@fb.com is DEPRECATED — do not use. Use facebook.com/help/reportlinks',
   'https://www.facebook.com/help/217910864998172')
ON CONFLICT (brand_name) DO NOTHING;

-- Ensure brand_key is populated for newly inserted rows
UPDATE public.known_brands
SET brand_key = lower(regexp_replace(brand_name, '[^a-zA-Z0-9]+', '_', 'g'))
WHERE brand_key IS NULL;

COMMENT ON COLUMN public.known_brands.contact_type IS
  'How to send the abuse report: email | webform | inproduct. Inngest brand-abuse worker only sends when type=email.';
COMMENT ON COLUMN public.known_brands.is_active IS
  'False disables the row from get_onward_destinations() output. Set false on bounce or "stop" reply.';
COMMENT ON COLUMN public.known_brands.last_verified_at IS
  'Last time a human or staleness cron confirmed the contact is correct. Quarterly cron updates this.';

-- ---------------------------------------------------------------------------
-- v119.3 onward_destination + onward_status enums
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'onward_destination') THEN
    CREATE TYPE public.onward_destination AS ENUM (
      'scamwatch','reportcyber','acma_email_spam','idcare','brand_abuse','ask_arthur_feed'
    );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'onward_status') THEN
    CREATE TYPE public.onward_status AS ENUM (
      'queued','sending','sent','delivered','failed','skipped','manual_review'
    );
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- v119.4 onward_report_log
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.onward_report_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scam_report_id BIGINT REFERENCES public.scam_reports(id) ON DELETE CASCADE,
  analysis_id TEXT,
  destination public.onward_destination NOT NULL,
  destination_key TEXT,
  status public.onward_status NOT NULL DEFAULT 'queued',
  status_reason TEXT,
  provider TEXT,
  provider_message_id TEXT,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0,
  payload_hash TEXT,
  retention_expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '24 months'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS onward_report_log_scam_report_idx
  ON public.onward_report_log (scam_report_id);

CREATE INDEX IF NOT EXISTS onward_report_log_status_idx
  ON public.onward_report_log (status, queued_at);

CREATE UNIQUE INDEX IF NOT EXISTS onward_report_log_dedup_idx
  ON public.onward_report_log (scam_report_id, destination, destination_key);

ALTER TABLE public.onward_report_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS onward_report_log_service_all ON public.onward_report_log;
CREATE POLICY onward_report_log_service_all ON public.onward_report_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.onward_report_log IS
  'Audit log of every onward-reporting attempt. One row per (scam_report, destination, destination_key). The "Here''s what we did" UI panel reads from this table.';
COMMENT ON COLUMN public.onward_report_log.payload_hash IS
  'SHA-256 of the rendered email body (or deep-link URL params). Lets the brand-abuse worker dedupe replays of the same content within retention window.';
COMMENT ON COLUMN public.onward_report_log.status IS
  'queued -> sending -> sent (or failed). skipped means user-action-required (Scamwatch/ReportCyber/IDCARE) — the UI surfaces deep-links. manual_review means held for admin approval (first 10 sends per new brand_key).';

-- ---------------------------------------------------------------------------
-- v119.5 RPC: get_onward_destinations
--
-- Returns the dynamic destination list given the scam attributes. Driven
-- entirely by data — adding a new brand to known_brands surfaces it here.
--
-- #variable_conflict use_column is REQUIRED — the OUT parameters shadow
-- column names from known_brands (display_name, brand_key) and PL/pgSQL
-- defaults to the variable, raising 42702 ambiguity at call time. See
-- CLAUDE.md PL/pgSQL gotcha note (verified bite, 2026-05-06).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_onward_destinations(
  p_scam_type           TEXT,
  p_impersonated_brand  TEXT,
  p_channel             TEXT,
  p_has_financial_loss  BOOLEAN DEFAULT false,
  p_has_pii_compromise  BOOLEAN DEFAULT false
)
RETURNS TABLE (
  destination       public.onward_destination,
  destination_key   TEXT,
  display_name      TEXT,
  default_enabled   BOOLEAN,
  description       TEXT,
  contact_type      TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
#variable_conflict use_column
BEGIN
  -- Always: Scamwatch + Ask Arthur internal feed
  destination := 'scamwatch'::public.onward_destination;
  destination_key := 'scamwatch.gov.au';
  display_name := 'Scamwatch (National Anti-Scam Centre)';
  default_enabled := true;
  description := 'We''ll open the official Scamwatch form with your evidence ready to paste.';
  contact_type := 'webform';
  RETURN NEXT;

  destination := 'ask_arthur_feed'::public.onward_destination;
  destination_key := 'askarthur.au';
  display_name := 'Ask Arthur threat feed';
  default_enabled := true;
  description := 'Helps us warn other Australians about this scam.';
  contact_type := 'inproduct';
  RETURN NEXT;

  -- ReportCyber when there is loss or PII compromise
  IF p_has_financial_loss OR p_has_pii_compromise THEN
    destination := 'reportcyber'::public.onward_destination;
    destination_key := 'cyber.gov.au';
    display_name := 'ReportCyber (police / ACSC)';
    default_enabled := true;
    description := 'For crimes with money lost or identity theft.';
    contact_type := 'webform';
    RETURN NEXT;
  END IF;

  -- IDCARE for PII compromise
  IF p_has_pii_compromise THEN
    destination := 'idcare'::public.onward_destination;
    destination_key := 'idcare.org';
    display_name := 'IDCARE (free identity support)';
    default_enabled := false;
    description := 'Free human help from Australia''s identity support service.';
    contact_type := 'inproduct';
    RETURN NEXT;
  END IF;

  -- ACMA email-spam intake when channel = email
  IF lower(coalesce(p_channel, '')) = 'email' THEN
    destination := 'acma_email_spam'::public.onward_destination;
    destination_key := 'report@submit.spam.acma.gov.au';
    display_name := 'ACMA spam intake';
    default_enabled := true;
    description := 'We forward the scam email to the ACMA spam register.';
    contact_type := 'email';
    RETURN NEXT;
  END IF;

  -- Brand-abuse: lookup known_brands by brand_key (lowercased + snake_cased)
  IF p_impersonated_brand IS NOT NULL AND length(trim(p_impersonated_brand)) > 0 THEN
    RETURN QUERY
    SELECT
      'brand_abuse'::public.onward_destination AS destination,
      kb.brand_key AS destination_key,
      kb.brand_name AS display_name,
      true AS default_enabled,
      'Tell ' || kb.brand_name || ' their brand is being impersonated.' AS description,
      kb.contact_type AS contact_type
    FROM public.known_brands kb
    WHERE kb.is_active = true
      AND (
        lower(kb.brand_key) = lower(regexp_replace(p_impersonated_brand, '[^a-zA-Z0-9]+', '_', 'g'))
        OR lower(kb.brand_name) = lower(p_impersonated_brand)
      );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_onward_destinations(TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN)
  TO authenticated, anon, service_role;

COMMIT;
