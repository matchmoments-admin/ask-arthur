-- Migration v283: pack-agnostic registry checks + applicant/case grouping
--
-- Two shape changes made NOW because document_check_records holds ZERO rows
-- (the feature is dark). Both get materially more expensive the moment a
-- pilot has data: one is a column rename, the other adds the grouping key
-- every record would otherwise be missing.
--
-- 1. abn_summary → registry_checks. The column (and the type behind it) was
--    AU-shaped: a UK/NZ jurisdiction pack has no ABN and no field to write
--    into, so the "packs are data, not code" promise would have broken at
--    the database. Rows are now [{kind,identifier,status,entityName}] —
--    `kind` names the register, ADR-0009 statuses preserved.
--
-- 2. case_ref: the caller's applicant / application / tenancy id. The
--    market's unit of work is the APPLICATION (3 payslips + a bank
--    statement = one leasing decision), not the document; without this a
--    property manager cannot ask "show me everything for this applicant".
--    Opaque to us — never parsed, never treated as an identity.
--
-- Parent AND archive twin change together in this migration:
-- archive_secondary_tables_batch moves rows with a positional
-- INSERT ... SELECT *, so any column drift between the two 42601s the
-- nightly archiver (the v247 flagged_ads incident).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'document_check_records'
      AND column_name = 'abn_summary'
  ) THEN
    ALTER TABLE public.document_check_records
      RENAME COLUMN abn_summary TO registry_checks;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'document_check_records_archive'
      AND column_name = 'abn_summary'
  ) THEN
    ALTER TABLE public.document_check_records_archive
      RENAME COLUMN abn_summary TO registry_checks;
  END IF;
END $$;

ALTER TABLE public.document_check_records
  ADD COLUMN IF NOT EXISTS case_ref TEXT;
ALTER TABLE public.document_check_records_archive
  ADD COLUMN IF NOT EXISTS case_ref TEXT;

-- "Every check for this applicant" is the B2B feed's primary grouping read.
CREATE INDEX IF NOT EXISTS idx_document_check_records_org_case
  ON public.document_check_records (org_id, case_ref, checked_at)
  WHERE org_id IS NOT NULL AND case_ref IS NOT NULL;

COMMENT ON COLUMN public.document_check_records.registry_checks IS
  'Jurisdiction-pack register results: [{kind,identifier,status,entityName}]. kind names the register (abn today; company_number/vat/ird for future packs). Public-register facts only — never document content.';
COMMENT ON COLUMN public.document_check_records.case_ref IS
  'Caller-supplied applicant/application grouping key (B2B). Opaque: never parsed or rendered as an identity.';
COMMENT ON TABLE public.document_check_records IS
  'Metadata-only document-check evidence (ADR-0022 pattern). Retention differs by source: web keeps FLAGGED checks only (anonymous consumer, data minimisation); api keeps EVERY check (the paying org is the controller and is buying an audit trail). Never document bytes, never extracted text.';
