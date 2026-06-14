-- v180: make known_brands accept what known-brands-discover writes
--
-- Fixes two schema mismatches that made the known-brands-discover Inngest
-- function (shipped in #587) a silent no-op — it probed brands but wrote ZERO
-- rows on every run. Surfaced by the 2026-06-14 post-resync smoke test (table
-- stuck at 40 rows, "discovered 0"), root-caused by inspecting the function's
-- upsert against the live schema.
--
-- (1) ON CONFLICT arbiter. The function upserts with `ON CONFLICT (brand_name)`,
--     but the only unique index on known_brands was `known_brands_brand_key_active_idx`
--     on brand_key (partial, WHERE is_active, from v119). Postgres requires the
--     arbiter to match a unique constraint exactly, so every upsert raised
--     42P10 ("no unique or exclusion constraint matching the ON CONFLICT
--     specification"). brand_name was 40/40 distinct, so a full UNIQUE applies
--     cleanly.
--
-- (2) contact_type CHECK. The function writes contact_type='none' for the miss
--     ledger row (a probed brand with no security.txt, so it isn't re-probed),
--     but `known_brands_contact_type_ck` only allowed ('email','webform',
--     'inproduct'). 'none' is the intended sentinel — widen the check rather
--     than change the function's ledger semantics.
--
-- Both errors were caught by the function's own try/catch and logged as warns,
-- so the failure was invisible to /admin/costs and the run "succeeded". Each
-- statement is idempotent — safe to re-run.

-- (1) UNIQUE (brand_name) so ON CONFLICT (brand_name) has a matching arbiter.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.known_brands'::regclass
      AND conname = 'known_brands_brand_name_key'
  ) THEN
    ALTER TABLE public.known_brands
      ADD CONSTRAINT known_brands_brand_name_key UNIQUE (brand_name);
  END IF;
END $$;

-- (2) Allow the 'none' sentinel contact_type for probed-but-no-contact rows.
ALTER TABLE public.known_brands
  DROP CONSTRAINT IF EXISTS known_brands_contact_type_ck;
ALTER TABLE public.known_brands
  ADD CONSTRAINT known_brands_contact_type_ck
  CHECK (contact_type = ANY (ARRAY['email'::text, 'webform'::text, 'inproduct'::text, 'none'::text]));
