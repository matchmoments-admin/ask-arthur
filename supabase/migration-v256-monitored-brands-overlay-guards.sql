-- v256 — close the monitored_brands overlay's two structural gaps
--
-- CONTEXT: v207 created monitored_brands as the runtime overlay the NRD clone
-- matcher merges in behind FF_BRAND_DYNAMIC_WATCHLIST. It was built for paid
-- Brand Monitor + partnership pilots. It is currently EMPTY, which is why
-- neither gap below has bitten yet — both are reachable the moment a row
-- exists.
--
-- GAP 1 — a verified brand with NO legitimate domains reaches the matcher.
--   legitimate_domains is `text[] NOT NULL DEFAULT '{}'`, so '{}' is not just
--   allowed, it is the DEFAULT. list_active_monitored_brands returned it
--   unfiltered and the old in-code merge did `legitimate_domains ?? []`.
--   That array is the matcher's EXCLUSION list: with it empty, the brand's own
--   website matches its own brand token and is reported as a clone of itself.
--   The customer's first clone alert would be their own homepage.
--
-- GAP 2 — org_id is NOT NULL, so there is nowhere to put a brand that has no
--   customer. Discovery-promoted brands (a brand Arthur decides to watch off
--   its own evidence) have no org. Without a home they cannot use the overlay
--   at all, which is what forced promotion to remain a compile-time array edit
--   + PR + deploy — and is why, in a month, zero of 51 candidates were ever
--   promoted.
--
-- Cold table (0 rows). Idempotent.

-- ── 1. A house org for brands Arthur watches on its own evidence ──────────
--
-- monitored_brands.org_id is `uuid NOT NULL` with NO foreign key (verified
-- against pg_constraint: only a PK, the (org_id, brand_normalized) UNIQUE, and
-- three CHECKs). There is no `orgs` table in this schema at all — org identity
-- lives in org_members. So the house org needs no parent row; it is a reserved
-- sentinel UUID, documented here and used by the promotion path.
--
--     00000000-0000-4000-8000-000000000001
--
-- The (org_id, brand_normalized) UNIQUE then does useful work for free: the
-- house org can hold each brand at most once, while a real customer can still
-- register the same brand under their own org.
--
-- Note what this does NOT do: the v207 RLS read policy resolves membership via
-- org_members, and no user is a member of the house org, so house brands are
-- readable by service_role only. That is the intended blast radius — these are
-- Arthur's own monitoring decisions, not a customer's data.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'orgs'
  ) THEN
    -- Defensive: if an `orgs` table is introduced later, this migration
    -- re-applied would seed the parent row rather than leaving a dangling id.
    EXECUTE $seed$
      INSERT INTO public.orgs (id, name)
      VALUES ('00000000-0000-4000-8000-000000000001', 'Ask Arthur (house)')
      ON CONFLICT (id) DO NOTHING
    $seed$;
  END IF;
END $$;

COMMENT ON TABLE public.monitored_brands IS
  'Org-scoped brand registry for paid Brand Monitor + partnership pilots '
  '(v207), plus brands Ask Arthur watches on its own evidence under the house '
  'org 00000000-0000-4000-8000-000000000001 (v256). Only verified + active '
  'rows WITH at least one legitimate domain are monitored. See '
  'docs/plans/clone-watch-enforcement-and-monetisation.md Wave 3.';

-- ── 2. No monitored brand without an exclusion list ───────────────────────
--
-- Enforced in BOTH places on purpose. The CHECK stops a bad row existing at
-- all; the RPC predicate stops any row that predates the constraint (or that a
-- future ALTER weakens) from reaching the matcher. A single guard here is one
-- deploy away from the self-clone bug.
--
-- The constraint permits an empty array while verification_status <> 'verified'
-- so a brand can be registered before its domains are confirmed — it simply
-- cannot be MONITORED in that state.
ALTER TABLE public.monitored_brands
  DROP CONSTRAINT IF EXISTS monitored_brands_verified_needs_domains;
ALTER TABLE public.monitored_brands
  ADD CONSTRAINT monitored_brands_verified_needs_domains
  CHECK (
    verification_status <> 'verified'
    OR COALESCE(cardinality(legitimate_domains), 0) > 0
  );

CREATE OR REPLACE FUNCTION public.list_active_monitored_brands()
RETURNS TABLE (
  brand text,
  brand_normalized text,
  legitimate_domains text[],
  aliases text[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
  SELECT brand_name, brand_normalized, legitimate_domains, aliases
  FROM public.monitored_brands
  WHERE is_active
    AND verification_status = 'verified'
    -- Belt and braces with the CHECK above: never hand the matcher a brand it
    -- has no way to exclude the real site for.
    AND COALESCE(cardinality(legitimate_domains), 0) > 0;
$$;

REVOKE EXECUTE ON FUNCTION public.list_active_monitored_brands()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_active_monitored_brands()
  TO service_role;

COMMENT ON FUNCTION public.list_active_monitored_brands() IS
  'Matcher worklist: verified + active overlay brands that have at least one '
  'legitimate domain (v207, domain guard added v256). An empty '
  'legitimate_domains array is the matcher''s exclusion list being empty, '
  'which makes the brand''s own site match as a clone of itself.';
