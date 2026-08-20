-- v280: claimed AI-origin metadata on image-check evidence records
--
-- Adds origin_metadata JSONB — the detectMetadataOrigin() payload
-- ({claimed, source, generator, digitalSourceType}; XMP DigitalSourceType /
-- CreatorTool + EXIF Software, packages/scam-engine/src/metadata-origin.ts)
-- — to image_check_records. This is the CLAIMED tier of the AI-origin
-- ladder, distinct from content_credentials (the C2PA/signed tier).
--
-- The archive twin gets the same column IN THE SAME MIGRATION:
-- archive_secondary_tables_batch moves rows with a positional
-- INSERT ... SELECT *, so a column added only to the parent would 42601 the
-- nightly archiver (the v247 flagged_ads_archive incident). Both tables
-- append the column last, keeping column positions aligned.

ALTER TABLE public.image_check_records
  ADD COLUMN IF NOT EXISTS origin_metadata JSONB;

ALTER TABLE public.image_check_records_archive
  ADD COLUMN IF NOT EXISTS origin_metadata JSONB;
