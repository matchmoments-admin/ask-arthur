-- migration-v46: Performance indexes for B2B dashboard queries

-- check_stats: dashboard time-series query
CREATE INDEX IF NOT EXISTS idx_check_stats_date ON check_stats (date DESC);

-- scam_entities: risk-ordered entity feed
CREATE INDEX IF NOT EXISTS idx_scam_entities_risk_report ON scam_entities (risk_level, report_count DESC);

-- feed_items: dashboard feed panel
CREATE INDEX IF NOT EXISTS idx_feed_items_pub_created ON feed_items (published, created_at DESC) WHERE published = true;

-- feed_ingestion_log: pipeline health (last per feed)
CREATE INDEX IF NOT EXISTS idx_feed_ingest_feed_created ON feed_ingestion_log (feed_name, created_at DESC);
