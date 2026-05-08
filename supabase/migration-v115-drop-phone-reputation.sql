-- Migration v115: drop unused phone_reputation table (Phase 4.7)
--
-- The phone_reputation table was created in v35 as an early phone-threat
-- registry. It has been fully superseded by phone_footprints (v75) which
-- captures the same domain (per-phone threat assessment) with a richer
-- pillar-score model + retention + RLS.
--
-- Pre-flight verification (2026-05-08):
--   - SELECT count(*) FROM phone_reputation → 0 rows ever written.
--   - pg_constraint check: 0 foreign keys referencing phone_reputation.
--   - grep across apps/, packages/, pipeline/: zero readers in app code.
--   - The single Kotlin reference at
--     apps/mobile/modules/call-screen/android/.../ScamCallScreeningService.kt:48
--     queries a table by the same name in a local SQLite database
--     (`arthur_threats.db`), not Postgres. That local SQLite schema is
--     defined in apps/mobile/lib/offline-db.ts which only creates
--     `threat_domains` + `sync_meta` — the Kotlin reference is dead/
--     aspirational and silently fails to a default-allow path. Mobile
--     team can clean up separately.
--
-- Reversible: if a future feature wants this table back, restore via
-- migration-v35-phone-reputation.sql. No data loss because the table
-- has been empty since creation.

DROP TABLE IF EXISTS public.phone_reputation CASCADE;

-- Verification (run manually after apply):
--   SELECT to_regclass('public.phone_reputation');  -- → NULL
--   SELECT count(*) FROM information_schema.tables
--     WHERE table_schema='public' AND table_name='phone_reputation';  -- → 0
