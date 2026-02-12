-- Ask Arthur Database Schema
-- Run this in the Supabase SQL Editor

-- ============================================
-- Table: check_stats (daily aggregate counters)
-- ============================================
CREATE TABLE IF NOT EXISTS check_stats (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  total_checks INT NOT NULL DEFAULT 0,
  safe_count INT NOT NULL DEFAULT 0,
  suspicious_count INT NOT NULL DEFAULT 0,
  high_risk_count INT NOT NULL DEFAULT 0,
  region TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (date, region)
);

CREATE INDEX idx_check_stats_date ON check_stats (date);

-- ============================================
-- Table: verified_scams (PII-scrubbed patterns)
-- Only stores HIGH RISK verdicts for research
-- ============================================
CREATE TABLE IF NOT EXISTS verified_scams (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scam_type TEXT NOT NULL,
  channel TEXT,
  summary TEXT NOT NULL,
  red_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  region TEXT,
  confidence_score REAL,
  impersonated_brand TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_verified_scams_type ON verified_scams (scam_type);
CREATE INDEX idx_verified_scams_created ON verified_scams (created_at);
CREATE INDEX idx_verified_scams_region ON verified_scams (region);
CREATE INDEX idx_verified_scams_brand ON verified_scams (impersonated_brand);

-- ============================================
-- Table: waitlist
-- ============================================
CREATE TABLE IF NOT EXISTS waitlist (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  source TEXT DEFAULT 'homepage',
  subscribed_weekly BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- Table: email_subscribers
-- ============================================
CREATE TABLE IF NOT EXISTS email_subscribers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- Function: increment_check_stats()
-- Atomic counter upsert for daily stats
-- ============================================
CREATE OR REPLACE FUNCTION increment_check_stats(
  p_verdict TEXT,
  p_region TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO check_stats (date, total_checks, safe_count, suspicious_count, high_risk_count, region)
  VALUES (
    CURRENT_DATE,
    1,
    CASE WHEN p_verdict = 'SAFE' THEN 1 ELSE 0 END,
    CASE WHEN p_verdict = 'SUSPICIOUS' THEN 1 ELSE 0 END,
    CASE WHEN p_verdict = 'HIGH_RISK' THEN 1 ELSE 0 END,
    p_region
  )
  ON CONFLICT (date, region)
  DO UPDATE SET
    total_checks = check_stats.total_checks + 1,
    safe_count = check_stats.safe_count + CASE WHEN p_verdict = 'SAFE' THEN 1 ELSE 0 END,
    suspicious_count = check_stats.suspicious_count + CASE WHEN p_verdict = 'SUSPICIOUS' THEN 1 ELSE 0 END,
    high_risk_count = check_stats.high_risk_count + CASE WHEN p_verdict = 'HIGH_RISK' THEN 1 ELSE 0 END;
END;
$$;

-- ============================================
-- Row Level Security
-- ============================================

-- check_stats: public can read, only service role can write
ALTER TABLE check_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read stats" ON check_stats FOR SELECT USING (true);
CREATE POLICY "Service role can insert stats" ON check_stats FOR INSERT WITH CHECK (true);
CREATE POLICY "Service role can update stats" ON check_stats FOR UPDATE USING (true);

-- verified_scams: only service role can read/write
ALTER TABLE verified_scams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role can manage scams" ON verified_scams FOR ALL USING (true);

-- waitlist: only service role
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role can manage waitlist" ON waitlist FOR ALL USING (true);

-- email_subscribers: only service role
ALTER TABLE email_subscribers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role can manage subscribers" ON email_subscribers FOR ALL USING (true);
