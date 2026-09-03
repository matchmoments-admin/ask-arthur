-- v296: persist per-brand targeting characterisation (#1075).
--
-- clone_watch_monthly_brand_stats (v193) has stored per-brand VOLUME and
-- OUTCOME since June — clones, reported_to_netcraft, likely_phishing, parked,
-- taken_down, declined, escalated, weaponised. What it has never stored is
-- SHAPE: how the lookalike names were built, which TLDs they used, where they
-- were really hosted, whether they shared infrastructure. Every one of those
-- facts is recorded per-alert and thrown away at aggregation time.
--
-- Shape is the half of the picture that survives churn, which is the point: a
-- clone that lived four days and died is still evidence of how a brand is being
-- attacked. Volume answers "how much", these answer "how".
--
-- Each distribution is stored as jsonb carrying its OWN denominator and an
-- explicit unknown bucket (see targeting-intelligence.ts `Mix`), because the
-- underlying fields have very different coverage and a reader must not be able
-- to mistake a partial field for a complete one. Measured on August 2026
-- (1,032 alerts):
--     clone_tactic     99.9%
--     campaign_key     ~56% after dedupe (the rest are the v235 'insufficient'
--                      sentinel — explicitly not a fingerprint)
--     hosting ASN      53%, of which ~63% are reverse proxies whose recorded
--                      country is a CDN edge, not the operator
--     attack_intent    scan-corroborated only: 52 of 1,032
--
-- Scalars are added only where a number is a DENOMINATOR or a headline — the
-- things a reader needs to sanity-check a percentage without parsing jsonb.
--
-- Cold table, a few hundred rows a month, rewritten wholesale by writeTrendRows
-- (delete-then-insert per period). No new indexes: the PK (period_month, brand)
-- serves "a month", and the existing (brand, period_month DESC) index serves
-- "one brand's history".

BEGIN;

ALTER TABLE public.clone_watch_monthly_brand_stats
  -- Denominator for every tactic claim: rows the classifier judged DELIBERATE.
  -- `clones` is the raw match count and includes the ~14% it rejects as
  -- coincidental, so the two must never be used interchangeably.
  ADD COLUMN IF NOT EXISTS deliberate_clones integer,
  -- How the NAMES are built. Publishable: the classifier's whole input is
  -- {brand, candidate_domain, candidate_url}, and tactic is a property of that
  -- string. Shape: {top:[{key,n}], other, unknown, total}.
  ADD COLUMN IF NOT EXISTS tactic_mix jsonb,
  -- What SCANNED clones were doing. Restricted to rows a real urlscan graded
  -- likely_phishing — the classifier never loads a page, so its intent label
  -- cannot carry this claim alone. `total` inside the object is the
  -- corroborated n, which is small and must be published beside any share.
  ADD COLUMN IF NOT EXISTS intent_mix jsonb,
  -- Registration TLDs. The most defensible family here: derived from the domain
  -- string, 100% coverage, no model and no vendor involved.
  ADD COLUMN IF NOT EXISTS tld_mix jsonb,
  -- Origin hosting, with reverse-proxied rows EXCLUDED from the location
  -- distributions and counted separately. Shape carries frontedN /
  -- unattributedN / originVisibleN so a location claim can quote its real base.
  ADD COLUMN IF NOT EXISTS hosting_mix jsonb,
  -- Lookalikes OF THIS BRAND sharing one registrar/nameserver/ASN/cert
  -- fingerprint. NOT an actor id — the same key across unrelated brands is an
  -- infrastructure bucket, which is why this is only ever computed per-brand.
  ADD COLUMN IF NOT EXISTS clusters jsonb,
  -- Denominator for any cluster share.
  ADD COLUMN IF NOT EXISTS fingerprinted_clones integer,
  -- Headline scalar: biggest within-brand shared-infrastructure group.
  ADD COLUMN IF NOT EXISTS largest_cluster integer;

COMMENT ON COLUMN public.clone_watch_monthly_brand_stats.deliberate_clones IS
  'Rows the Haiku classifier judged deliberate (is_clone=true) — the denominator for tactic_mix. Distinct from `clones`, the raw match count, which includes the ~14% judged coincidental (144 of 1,032 in August 2026). Never use them interchangeably.';

COMMENT ON COLUMN public.clone_watch_monthly_brand_stats.intent_mix IS
  'Attack-intent distribution over SCAN-CORROBORATED rows only (urlscan_classification = likely_phishing). The classifier sees only {brand, candidate_domain, candidate_url} and never loads the page, so an intent label on an unscanned row is a guess about content nobody saw. The object carries its own small n — publish it beside any share.';

COMMENT ON COLUMN public.clone_watch_monthly_brand_stats.hosting_mix IS
  'Origin hosting. Reverse-proxied rows (Cloudflare, Akamai, Fastly, CDN edges) are EXCLUDED from the ASN/country distributions and counted in frontedN, because their recorded location is an edge POP, not the operator. August 2026: 341 fronted, 490 unattributed, 201 origin-visible of 1,032.';

COMMENT ON COLUMN public.clone_watch_monthly_brand_stats.clusters IS
  'Lookalikes of THIS brand sharing one infrastructure fingerprint (registrar + nameserver roots + ASN + cert issuer, v235). NOT an actor identifier: the same key across unrelated brands is a common hosting stack, so this is only meaningful scoped per-brand. Copy must say "share one fingerprint", never "one campaign" or "one actor".';

COMMIT;
