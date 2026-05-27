-- v154: foreign-key clone_alert_notification_queue.brand → brand_contact_directory.brand
--
-- The two prod bugs of 2026-05-27 (#468 send-endpoint cross-validation,
-- #469/v153 record_brand_notification_sent post-send stamp) both stemmed
-- from string-match drift between clone_alert_notification_queue.brand
-- and brand_contact_directory.brand. With no FK, the queue could hold
-- rows whose `brand` value didn't exist in the directory, and the email
-- send path (which assumes a 1:1 directory lookup) would either 409 or
-- silently fail to update last_notified_at.
--
-- The audit on 2026-05-27 surfaced 5 such orphan rows in prod, all
-- pre-fix test enqueues with `recipient = brendan.milton1211@gmail.com`
-- — they would never have shipped to a real brand inbox.
--
-- This migration:
--   1. DELETEs the 5 known-orphan test rows (matched by id + recipient +
--      brand to ensure we don't accidentally drop production data).
--   2. VERIFIES no other orphans remain — raises EXCEPTION if so, with
--      the orphan brand list so the operator can resolve before retry.
--   3. ADDs the FK constraint with ON UPDATE CASCADE / ON DELETE
--      NO ACTION (renaming a brand in the directory cascades to the
--      queue; deleting a directory row is blocked while queue rows
--      still reference it — operator must clean up queue rows first).
--
-- Idempotent: re-running is safe.
--   * The DELETE is by id list (re-run deletes zero rows).
--   * The FK addition is guarded by a pg_constraint catalog check.
--   * The verification step short-circuits if zero orphans remain.

BEGIN;

-- ── 1. Cleanup known-orphan test rows (audit 2026-05-27) ────────────
--
-- Audit listed 5 orphan rows: id IN (3,4,5,6,7) with the brand values
-- below. Matched on three fields so a future row with the same id but
-- different shape is not affected.
DELETE FROM public.clone_alert_notification_queue
WHERE id = ANY (ARRAY[3, 4, 5, 6, 7]::bigint[])
  AND recipient = 'brendan.milton1211@gmail.com'
  AND brand IN (
    'ask-arthur-test-brand',
    'kogan-test-protection',
    'hellostake-dashboard-test',
    'dominos.com.au'
  );

-- ── 2. Verify zero orphans remain ───────────────────────────────────
--
-- If any orphans still exist, raise EXCEPTION with the brand list. The
-- transaction rolls back and the FK is NOT added — operator must
-- reconcile before re-running.
DO $$
DECLARE
  v_orphans int;
  v_orphan_brands text;
BEGIN
  SELECT COUNT(*), string_agg(DISTINCT brand, ', ')
    INTO v_orphans, v_orphan_brands
  FROM public.clone_alert_notification_queue q
  WHERE NOT EXISTS (
    SELECT 1 FROM public.brand_contact_directory d WHERE d.brand = q.brand
  );

  IF v_orphans > 0 THEN
    RAISE EXCEPTION 'Cannot add FK: % orphan queue rows reference missing directory brands (%). Resolve by either deleting the rows or adding the missing directory entries, then re-run this migration.',
      v_orphans, v_orphan_brands;
  END IF;
END $$;

-- ── 3. Add FK (idempotent via pg_constraint catalog check) ──────────
--
-- ON UPDATE CASCADE — renaming a brand in the directory follows through
--   to all queue rows so the daily-batch cron continues to find them.
-- ON DELETE NO ACTION — deleting a directory row is blocked if queue
--   rows still reference it. This is intentional: an admin removing a
--   brand directory entry should clean up the queue first, not orphan
--   the rows.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'clone_alert_notification_queue_brand_fkey'
      AND conrelid = 'public.clone_alert_notification_queue'::regclass
  ) THEN
    ALTER TABLE public.clone_alert_notification_queue
      ADD CONSTRAINT clone_alert_notification_queue_brand_fkey
      FOREIGN KEY (brand)
      REFERENCES public.brand_contact_directory(brand)
      ON UPDATE CASCADE
      ON DELETE NO ACTION;
  END IF;
END $$;

COMMIT;
