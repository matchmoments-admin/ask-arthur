-- v181 — Shareable-link token for the monthly Brand Stewardship Report.
--
-- Adds an opaque, unguessable UUID per report row so a brand recipient can
-- forward a read-only web view of their monthly summary (the clone-watch
-- analytics + lookalike list) to colleagues/supervisors internally, without
-- exposing the admin dashboard or any other brand's row.
--
-- The public share page (/clone-report/[token]) reads this table via the
-- service client by share_token (RLS stays service-role-only; the page never
-- exposes recipient_email or other brands' rows — it selects one row by the
-- random token). The token is the capability — treat it like a bearer secret.
--
-- Small table (one row per brand per month), not a hot write table, so the
-- volatile-default backfill rewrite is safe.

ALTER TABLE public.brand_stewardship_reports
  ADD COLUMN IF NOT EXISTS share_token UUID;

-- Backfill any pre-existing rows (idempotent — only touches NULLs).
UPDATE public.brand_stewardship_reports
  SET share_token = gen_random_uuid()
  WHERE share_token IS NULL;

ALTER TABLE public.brand_stewardship_reports
  ALTER COLUMN share_token SET DEFAULT gen_random_uuid();

ALTER TABLE public.brand_stewardship_reports
  ALTER COLUMN share_token SET NOT NULL;

-- The share page looks up exactly one row by this token — must be unique +
-- indexed for an O(1) capability lookup.
CREATE UNIQUE INDEX IF NOT EXISTS brand_stewardship_reports_share_token_idx
  ON public.brand_stewardship_reports (share_token);

COMMENT ON COLUMN public.brand_stewardship_reports.share_token IS
  'Opaque bearer token for the public read-only share page (/clone-report/[token]). Lets a brand forward their monthly summary internally. Capability-style — anyone with the token can view that one report.';
