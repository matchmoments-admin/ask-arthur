-- migration-v247-flagged-ads-archive-brand-cols.sql
--
-- Fix: archive-shadows-retention Inngest cron has failed EVERY day since the
-- brand-convergence work appended `impersonated_brand` + `impersonated_brand_key`
-- to public.flagged_ads (v243 / #824 lineage), because
-- archive_secondary_tables_batch() (migration-v118) archives that table with a
-- POSITIONAL `INSERT INTO public.flagged_ads_archive SELECT * FROM src` where
-- `src` is `DELETE FROM public.flagged_ads ... RETURNING *`.
--
--   flagged_ads         = 18 cols (… impersonated_celebrity, impersonated_brand,
--                                    impersonated_brand_key)
--   flagged_ads_archive = 16 cols (… impersonated_celebrity)
--
-- SELECT * now yields 18 expressions into a 16-column target →
--   "INSERT has more expressions than target columns" (Postgres 42601).
-- flagged_ads is the FIRST of six archive steps in the function, so the whole
-- retention run aborts before any of the six shadow tables archive anything.
-- Symptom in Axiom: message='fn.error', fields.fn='archive-shadows-retention',
-- once per day (05:0x UTC) since ~2026-07-18.
--
-- Diagnosis confirmed against prod: only flagged_ads/flagged_ads_archive drifted;
-- the other five pairs (deepfake_detections, media_analyses, scan_results,
-- verdict_feedback, brand_impersonation_alerts) match column-for-column.
--
-- Forward fix per supabase/CLAUDE.md rule #1 (merged migrations are immutable):
-- append the two missing columns to the archive table, in the SAME trailing
-- order they hold in flagged_ads, so the positional `SELECT *` realigns
-- (position 17 → impersonated_brand, position 18 → impersonated_brand_key).
--
-- Safe: nullable TEXT column adds are metadata-only (no table rewrite, no lock
-- of consequence on an append-only archive table). Idempotent. No RLS change —
-- flagged_ads_archive keeps its existing policy. No reverse script needed
-- (adding nullable columns is non-destructive).

ALTER TABLE public.flagged_ads_archive
  ADD COLUMN IF NOT EXISTS impersonated_brand      TEXT,
  ADD COLUMN IF NOT EXISTS impersonated_brand_key  TEXT;

-- Smoke (safe to run — batch size 0 exercises the code path without moving rows
-- once real data is present; with a real batch it now succeeds instead of 42601):
--   SELECT * FROM public.archive_secondary_tables_batch(1);
