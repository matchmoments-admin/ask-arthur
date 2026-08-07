-- v267: normalize the historical cost_telemetry twilio tag split — Tier 3
-- item 11 (wayfinder #903; enterprise-review P2).
--
-- Prod carried both 'twilio-lookup' (canonical, 6 rows) and 'twilio_lookup'
-- (1 legacy row from the pre-canonicalisation route-level logger) as distinct
-- feature tags, so any exact-match analysis of the vendor undercounts. The
-- emitters were already unified in code (apps/web/app/api/analyze/route.ts
-- carries the canonicalisation note); this normalizes the data.
-- Idempotent: re-running matches zero rows.

UPDATE cost_telemetry
   SET feature = 'twilio-lookup'
 WHERE feature = 'twilio_lookup';
