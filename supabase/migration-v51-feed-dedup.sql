-- ============================================================
-- v51: Feed Dedup — Remove duplicate user_report feed items
-- ============================================================
-- When a HIGH_RISK verdict creates both a verified_scams row and a
-- scam_reports row (linked via scam_reports.verified_scam_id), both
-- feed sync crons independently wrote a feed_items row for the same
-- event. This migration removes the duplicate user_report rows.
--
-- Going forward, syncUserReportsToFeed filters out scam_reports
-- where verified_scam_id IS NOT NULL, preventing new duplicates.
-- ============================================================

DELETE FROM feed_items
WHERE source = 'user_report'
  AND external_id IN (
    SELECT sr.id::text
    FROM scam_reports sr
    WHERE sr.verified_scam_id IS NOT NULL
  );
