-- v233: clone-watch — comment-only hardening from the final end-to-end review
--
-- Two documentation fixes on merged-and-immutable migrations (v230/v231),
-- applied forward per the never-edit-a-merged-migration rule. Zero schema or
-- behaviour change — COMMENT ON only.
--
-- 1. SECURITY tripwire (final-review security pass, advisory): the transition
--    archive's evidence jsonb columns store ATTACKER-PAGE-DERIVED strings
--    (urlscan categories / technologies / server headers scraped from the
--    scam site). Nothing renders them today; the comment exists so a future
--    reader who SELECTs them into a view/email/JSX hits the warning at the
--    schema level first.
-- 2. Shape drift (final-review regression pass): v231's duration_kpis comment
--    predates the review fix that split the exclusion counter — the persisted
--    jsonb also carries anomalousInversionsN, and the leg keys are the four
--    named legs, not a generic "leg".

COMMENT ON COLUMN public.clone_watch_scan_transitions.prior_evidence IS
  'Snapshot of urlscan_evidence before the classification change. WARNING: contains attacker-page-derived strings (categories, technologies, server headers scraped from the scam site). NEVER render raw into HTML/JSX/email — route through an allowlist first (see typeKeyFor in apps/web/app/clone-watch/page.tsx for the established pattern). Usually the v224 submit-stage stub; the previous FULL render is the previous transition row''s new_evidence.';

COMMENT ON COLUMN public.clone_watch_scan_transitions.new_evidence IS
  'Snapshot of urlscan_evidence at the classification change. WARNING: contains attacker-page-derived strings (categories, technologies, server headers scraped from the scam site). NEVER render raw into HTML/JSX/email — route through an allowlist first (see typeKeyFor in apps/web/app/clone-watch/page.tsx for the established pattern).';

COMMENT ON COLUMN public.clone_watch_report_summary.duration_kpis IS
  'Vendor-gap duration KPIs for the report month cohort, persisted verbatim from the TS duration-kpis module (cohort-windowed on first_seen_at — EXPECTED to differ from the rolling-window clone_watch_vendor_gap_stats RPC). Shape: {declineToWeaponise|weaponiseToRefile|refileToTakedown|fullLoop: {n:int, medianHours:int|null}, excludedNegativeN:int (decline->weaponise last-touch pathology pairs ONLY), anomalousInversionsN:int (inverted pairs on the other legs — unexpected, investigate if >0), asOf:iso}.';
