-- v177 — attribution dossier column on clone-watch alerts
--
-- WHY: confirmed clones are useful to brands/police only with attribution — who
-- registered the domain, when, the hosting IP/ASN reputation, and (highest-value)
-- the other domains sharing the same TLS certificate (one operator's campaign).
-- Most of this is one helper-call away (whois.ts / ct-lookup.ts / abuseipdb.ts /
-- geolocate.ts already ship). This adds a single jsonb column to hold the
-- enriched dossier; the clone-watch-enrich-attribution Inngest fn populates it
-- for tp_confirmed alerts.
--
-- Shape (all fields nullable — enrichment degrades gracefully on missing keys):
--   {
--     "whois":   { "registrar", "registrantCountry", "createdDate", "nameServers": [] },
--     "ct":      { "siblings": [], "hasWildcard": bool, "issuer", "certificateCount" },
--     "ip_rep":  { "abuseConfidenceScore", "totalReports", "isp", "usageType" },
--     "hosting": { "ip", "country", "asn" },   -- copied from urlscan_evidence.server
--     "enriched_at": "<iso>"
--   }
--
-- Purely additive. shopfront_clone_alerts is service-role only (no RLS change).
-- The partial index supports the enricher's "tp_confirmed AND attribution IS NULL"
-- selector without scanning the whole table.
--
-- ROLLBACK: ALTER TABLE public.shopfront_clone_alerts DROP COLUMN IF EXISTS attribution;
--           DROP INDEX IF EXISTS idx_clone_alerts_attribution_pending;

ALTER TABLE public.shopfront_clone_alerts
  ADD COLUMN IF NOT EXISTS attribution jsonb;

COMMENT ON COLUMN public.shopfront_clone_alerts.attribution IS
  'Enriched attribution dossier (whois / ct siblings / ip reputation / hosting) for a tp_confirmed clone. Populated by clone-watch-enrich-attribution. NULL = not yet enriched. v177.';

-- Selector support: confirmed-but-unenriched alerts.
CREATE INDEX IF NOT EXISTS idx_clone_alerts_attribution_pending
  ON public.shopfront_clone_alerts (first_seen_at DESC)
  WHERE triage_status = 'tp_confirmed' AND attribution IS NULL;
