-- Migration v56: Corporate leads table for B2B sales funnel.
-- Tracks inbound leads from landing pages, SPF assessment, calculator,
-- and referrals through the sales pipeline.

-- =============================================================================
-- Table: leads — corporate lead pipeline
-- =============================================================================
CREATE TABLE IF NOT EXISTS leads (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  company_name    TEXT NOT NULL,
  abn             TEXT,
  sector          TEXT CHECK (sector IN (
    'banking', 'telco', 'digital_platform',
    'insurance', 'superannuation', 'other'
  )),
  role_title      TEXT,
  phone           TEXT,
  source          TEXT NOT NULL DEFAULT 'website' CHECK (source IN (
    'website', 'spf_assessment', 'calculator', 'referral',
    'banking_page', 'telco_page', 'digital_platforms_page'
  )),
  score           INT NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  status          TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
    'new', 'contacted', 'qualified', 'demo_scheduled',
    'trial', 'won', 'lost'
  )),
  notes           JSONB NOT NULL DEFAULT '[]',
  -- Nurture email tracking
  nurture_step    INT NOT NULL DEFAULT 0,  -- 0 = not started, 1-6 = email sequence position
  nurture_last_sent_at TIMESTAMPTZ,
  -- UTM tracking
  utm_source      TEXT,
  utm_medium      TEXT,
  utm_campaign    TEXT,
  -- Assessment/calculator data
  assessment_data JSONB,  -- stores SPF assessment responses and score
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_email ON leads (email);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_source ON leads (source);
CREATE INDEX IF NOT EXISTS idx_leads_nurture ON leads (nurture_step, nurture_last_sent_at)
  WHERE status NOT IN ('won', 'lost');
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads (created_at DESC);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- Service role only — leads are admin-managed, no user-facing RLS
CREATE POLICY "Service role access leads" ON leads
  FOR ALL USING (auth.role() = 'service_role');

-- =============================================================================
-- Trigger: update leads.updated_at on change
-- =============================================================================
CREATE OR REPLACE FUNCTION update_leads_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_leads_updated_at();
