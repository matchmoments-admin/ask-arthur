-- v295: give brand_coverage_history the key it actually has to join on (#1075).
--
-- v294 keyed coverage on `brand_normalized` (brandNormalize of the display
-- name: "Apple" -> "apple"). That joins to shopfront_clone_alerts
-- .target_brand_normalized, which is right for the alert table — and WRONG for
-- the table the trend gate actually reads.
--
-- `clone_watch_monthly_brand_stats.brand` stores the brand's PRIMARY DOMAIN,
-- because the whole chain is keyed that way:
--   lexical-match.ts   emits legitimate_domain = entry.legitimate_domains[0]
--   nrd-daily-ingest   writes that into shopfront_clone_alerts.inferred_target_domain
--   aggregateClonesByDomain / getCloneWatchTrendRows  key on it
-- Verified in prod: the top rows are 'apple.com', 'hellostake.com',
-- 'target.com.au' — not 'apple', 'stake', 'target'.
--
-- Had this shipped, EVERY brand would have joined to nothing, returned
-- `coverage_unknown`, and the gate — which fails closed by design — would have
-- suppressed all trend claims while looking like it was working correctly. A
-- silent total-suppression bug is worse than a loud one, because the fix looks
-- like "the gate is too strict" rather than "the key is wrong".
--
-- This is the second key-format mismatch of this class found in one day: the
-- brand-contact directory stores display names ("Australia Post") while alerts
-- store normalized keys ("australiapost"), and a naive join there reported 0 of
-- 203 brands reachable. Hence: carry BOTH keys explicitly, and let the callers
-- name which one they need rather than guessing.
--
-- Safe to apply: v294 shipped minutes earlier and the table is still empty (the
-- backfill had not been run), so no data migration is required.

BEGIN;

ALTER TABLE public.brand_coverage_history
  -- The brand's primary domain, lowercased: watchlist legitimate_domains[0].
  -- THE join key for clone_watch_monthly_brand_stats.brand and for
  -- shopfront_clone_alerts.inferred_target_domain.
  ADD COLUMN IF NOT EXISTS brand_domain text;

COMMENT ON COLUMN public.brand_coverage_history.brand_domain IS
  'Watchlist legitimate_domains[0], lowercased. Joins to clone_watch_monthly_brand_stats.brand and shopfront_clone_alerts.inferred_target_domain. Prefer this key for anything reading the monthly stats; brand_normalized joins to shopfront_clone_alerts.target_brand_normalized instead. Keeping both is deliberate — the two halves of the pipeline are keyed differently (v295).';

COMMENT ON COLUMN public.brand_coverage_history.brand_normalized IS
  'brandNormalize() of the display name ("Apple" -> "apple"). Joins to shopfront_clone_alerts.target_brand_normalized. NOT the key for clone_watch_monthly_brand_stats — see brand_domain.';

CREATE INDEX IF NOT EXISTS brand_coverage_history_domain_idx
  ON public.brand_coverage_history (brand_domain);

COMMIT;
