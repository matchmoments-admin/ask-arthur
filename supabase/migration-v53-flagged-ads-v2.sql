-- ============================================================
-- v53: Flagged Ads v2 — risk scoring and auto-escalation
-- ============================================================
-- Adds risk_score, status, and landing_page_domain columns.
-- Auto-escalation trigger promotes status based on community
-- flag count and risk score thresholds.
-- ============================================================

ALTER TABLE flagged_ads
  ADD COLUMN IF NOT EXISTS risk_score SMALLINT DEFAULT 0
    CHECK (risk_score >= 0 AND risk_score <= 100),
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'under_review', 'confirmed_scam', 'false_positive')),
  ADD COLUMN IF NOT EXISTS landing_page_domain TEXT;

-- Backfill domain from existing landing_url values
UPDATE flagged_ads
SET landing_page_domain = substring(landing_url from 'https?://([^/]+)')
WHERE landing_url IS NOT NULL AND landing_page_domain IS NULL;

-- Index on domain for lookups
CREATE INDEX IF NOT EXISTS idx_flagged_ads_domain
  ON flagged_ads (landing_page_domain) WHERE landing_page_domain IS NOT NULL;

-- Index on status for admin queries
CREATE INDEX IF NOT EXISTS idx_flagged_ads_status
  ON flagged_ads (status, last_flagged_at DESC);

-- Auto-escalation trigger:
-- 3+ reports → under_review
-- 10+ reports with risk_score >= 70 → confirmed_scam
CREATE OR REPLACE FUNCTION auto_escalate_flagged_ad()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.flag_count >= 10 AND NEW.risk_score >= 70 THEN
    NEW.status = 'confirmed_scam';
  ELSIF NEW.flag_count >= 3 AND NEW.status = 'pending' THEN
    NEW.status = 'under_review';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER flagged_ads_auto_escalate
  BEFORE UPDATE ON flagged_ads
  FOR EACH ROW EXECUTE FUNCTION auto_escalate_flagged_ad();
