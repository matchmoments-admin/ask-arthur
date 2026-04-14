-- ============================================================
-- v52: Flagged Ads — Community flagging for Facebook ad scams
-- ============================================================
-- Stores community-flagged ads detected by the Chrome extension.
-- Each unique ad (by text hash) has a counter and reporter list
-- to prevent duplicate flags from the same installation.
-- ============================================================

CREATE TABLE flagged_ads (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ad_text_hash TEXT NOT NULL,
  advertiser_name TEXT,
  landing_url TEXT,
  verdict TEXT,
  flag_count INT DEFAULT 1,
  reporter_hashes TEXT[] DEFAULT '{}',
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_flagged_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (ad_text_hash)
);

ALTER TABLE flagged_ads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "flagged_ads_service_all" ON flagged_ads FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX idx_flagged_ads_advertiser ON flagged_ads (advertiser_name);
CREATE INDEX idx_flagged_ads_url ON flagged_ads (landing_url) WHERE landing_url IS NOT NULL;
CREATE INDEX idx_flagged_ads_count ON flagged_ads (flag_count DESC);
