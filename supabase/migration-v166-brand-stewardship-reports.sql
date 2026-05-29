-- v166 — Monthly Brand Stewardship Report ledger (WS2-cap).
--
-- One row per (brand, calendar month) recording what Ask Arthur detected +
-- reported onward on that brand's behalf during the month. This IS the
-- "keep all records so we can prove + assist" audit ledger — the row is the
-- proof artifact, independent of whether the summary email is ever sent.
--
-- Aggregation happens in TypeScript in the report-brand-stewardship cron
-- (a month of onward_report_log is bounded), which UPSERTs rows here. The
-- brand-facing summary email (separate slice) reads prepared rows and sends
-- via an admin-approved route, mirroring the clone-watch notify-brand flow.
--
-- metrics JSONB shape (factual verbs only — never "we took down"):
--   {
--     "detected": <int>,                         -- distinct scam_reports impersonating the brand
--     "reported_by_destination": { "openphish": n, "apwg": n, "acma_email_spam": n, ... },
--     "observed_taken_down": <int>,              -- onward rows we have a confirmed terminal status for
--     "reports_sent": <int>                       -- onward rows with status='sent'
--   }

CREATE TABLE IF NOT EXISTS public.brand_stewardship_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_key TEXT NOT NULL,
  brand_name TEXT NOT NULL,
  -- First day of the reported calendar month (UTC), e.g. 2026-05-01.
  period_month DATE NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- The scam_reports rows that contributed — evidence linkage for "assist when needed".
  evidence_scam_report_ids BIGINT[] NOT NULL DEFAULT '{}',
  recipient_email TEXT,
  status TEXT NOT NULL DEFAULT 'prepared'
    CHECK (status IN ('prepared', 'pending_send', 'sent', 'skipped', 'failed')),
  status_reason TEXT,
  provider TEXT,
  provider_message_id TEXT,
  approved_by_admin_id TEXT,
  prepared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One report per brand per month — the cron UPSERTs onto this.
CREATE UNIQUE INDEX IF NOT EXISTS brand_stewardship_reports_brand_month_idx
  ON public.brand_stewardship_reports (brand_key, period_month);

-- Dashboard / send-route lookups by status within a period.
CREATE INDEX IF NOT EXISTS brand_stewardship_reports_status_idx
  ON public.brand_stewardship_reports (status, period_month);

ALTER TABLE public.brand_stewardship_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brand_stewardship_reports_service_all
  ON public.brand_stewardship_reports;
CREATE POLICY brand_stewardship_reports_service_all
  ON public.brand_stewardship_reports
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.brand_stewardship_reports IS
  'Monthly per-brand record of detections + onward reports made on the brand''s behalf. The audit ledger behind the Brand Stewardship Report email (WS2-cap). One row per (brand_key, period_month).';
