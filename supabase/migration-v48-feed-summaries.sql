-- migration-v48: Feed digest summaries for scam intelligence

CREATE TABLE IF NOT EXISTS feed_summaries (
  id SERIAL PRIMARY KEY,
  scrape_date DATE NOT NULL,
  summary_text TEXT NOT NULL,
  stats JSONB NOT NULL DEFAULT '{}',
  new_items_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(scrape_date)
);

CREATE INDEX IF NOT EXISTS idx_feed_summaries_date ON feed_summaries (scrape_date DESC);
