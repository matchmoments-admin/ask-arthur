-- Migration v22: Scam clustering — groups related reports by entity overlap,
-- text similarity, brand campaigns, or manual curation.
-- Depends on v21 (scam_reports must exist).

-- =============================================================================
-- Table: scam_clusters
-- =============================================================================
CREATE TABLE IF NOT EXISTS scam_clusters (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cluster_type     TEXT NOT NULL CHECK (cluster_type IN ('entity_overlap', 'text_similarity', 'brand_campaign', 'manual')),
  primary_scam_type TEXT,
  primary_brand    TEXT,
  member_count     INT NOT NULL DEFAULT 0,
  entity_count     INT NOT NULL DEFAULT 0,
  total_loss       NUMERIC(12, 2) NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dormant', 'disrupted')),
  metadata         JSONB NOT NULL DEFAULT '{}',
  first_seen       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scam_clusters_type ON scam_clusters (cluster_type);
CREATE INDEX IF NOT EXISTS idx_scam_clusters_status ON scam_clusters (status);
CREATE INDEX IF NOT EXISTS idx_scam_clusters_brand ON scam_clusters (primary_brand);
CREATE INDEX IF NOT EXISTS idx_scam_clusters_members ON scam_clusters (member_count DESC);

-- =============================================================================
-- Table: cluster_members — junction between clusters and reports
-- =============================================================================
CREATE TABLE IF NOT EXISTS cluster_members (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cluster_id  BIGINT NOT NULL REFERENCES scam_clusters(id) ON DELETE CASCADE,
  report_id   BIGINT NOT NULL REFERENCES scam_reports(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cluster_id, report_id)
);

CREATE INDEX IF NOT EXISTS idx_cluster_members_cluster ON cluster_members (cluster_id);
CREATE INDEX IF NOT EXISTS idx_cluster_members_report ON cluster_members (report_id);

-- =============================================================================
-- RLS: public read, service-role write
-- =============================================================================
ALTER TABLE scam_clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE cluster_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read scam_clusters" ON scam_clusters FOR SELECT USING (true);
CREATE POLICY "Service role write scam_clusters" ON scam_clusters FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Public read cluster_members" ON cluster_members FOR SELECT USING (true);
CREATE POLICY "Service role write cluster_members" ON cluster_members FOR ALL USING (auth.role() = 'service_role');

-- =============================================================================
-- Deferred FK: scam_reports.cluster_id -> scam_clusters(id)
-- This couldn't be added in v21 because scam_clusters didn't exist yet.
-- =============================================================================
ALTER TABLE scam_reports ADD CONSTRAINT fk_scam_reports_cluster
  FOREIGN KEY (cluster_id) REFERENCES scam_clusters(id) ON DELETE SET NULL;
