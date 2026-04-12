-- migration-v49: Brand impersonation alert system

CREATE TABLE IF NOT EXISTS known_brands (
  id SERIAL PRIMARY KEY,
  brand_name TEXT NOT NULL UNIQUE,
  brand_domain TEXT,
  brand_category TEXT,
  security_contact_email TEXT,
  security_contact_url TEXT
);

INSERT INTO known_brands (brand_name, brand_domain, brand_category, security_contact_email, security_contact_url) VALUES
  ('Google', 'google.com.au', 'tech', 'safebrowsing-report@google.com', 'https://safebrowsing.google.com/safebrowsing/report_general/'),
  ('ANZ', 'anz.com.au', 'bank', 'hoax@anz.com', 'https://www.anz.com.au/security/report-fraud/'),
  ('Commonwealth Bank', 'commbank.com.au', 'bank', 'hoax@cba.com.au', 'https://www.commbank.com.au/support/security/report-fraud.html'),
  ('Westpac', 'westpac.com.au', 'bank', 'fraud@westpac.com.au', 'https://www.westpac.com.au/security-fraud/'),
  ('NAB', 'nab.com.au', 'bank', 'fraudreport@nab.com.au', 'https://www.nab.com.au/personal/accounts/security-and-fraud'),
  ('Telstra', 'telstra.com.au', 'telco', 'cyber@team.telstra.com', 'https://www.telstra.com.au/support/security'),
  ('Optus', 'optus.com.au', 'telco', 'scam.team@optus.com.au', NULL),
  ('myGov', 'my.gov.au', 'gov', 'security@servicesaustralia.gov.au', 'https://www.servicesaustralia.gov.au/report-scam'),
  ('Australia Post', 'auspost.com.au', 'gov', 'scams@auspost.com.au', 'https://auspost.com.au/help-and-support/scams-and-fraud'),
  ('ATO', 'ato.gov.au', 'gov', 'security@ato.gov.au', NULL),
  ('Amazon', 'amazon.com.au', 'retailer', 'stop-spoofing@amazon.com', NULL)
ON CONFLICT (brand_name) DO NOTHING;

CREATE TABLE IF NOT EXISTS brand_impersonation_alerts (
  id SERIAL PRIMARY KEY,
  brand_name TEXT NOT NULL,
  brand_category TEXT,
  scam_type TEXT,
  delivery_method TEXT,
  scam_content_hash TEXT,
  confidence_score REAL,
  scammer_phones TEXT[],
  scammer_urls TEXT[],
  scammer_emails TEXT[],
  evidence_summary TEXT,
  outreach_status TEXT NOT NULL DEFAULT 'pending' CHECK (outreach_status IN ('pending', 'drafted', 'sent', 'responded')),
  outreach_contact TEXT,
  outreach_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brand_alerts_brand ON brand_impersonation_alerts(brand_name);
CREATE INDEX IF NOT EXISTS idx_brand_alerts_status ON brand_impersonation_alerts(outreach_status);
CREATE INDEX IF NOT EXISTS idx_brand_alerts_created ON brand_impersonation_alerts(created_at DESC);
