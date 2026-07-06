-- v195 — seed known_brands into the canonical brand-alias layer
--        (Phase 0 of docs/plans/brand-convergence-seam.md)
--
-- WHY: brand-alerts.ts (createBrandAlert) joins a scam's free-text brand to
-- known_brands by EXACT string, so a Claude-emitted "nab" never matches the
-- 'NAB' contact row. Seeding every known_brands.brand_name into brand_aliases
-- (keyed by brand_normalize) lets the read-side resolver map any casing/spacing
-- variant of a known brand to its canonical name — closing the exact-match gap
-- for every consumer of the v174 layer, not just the two Inngest fns.
--
-- Mirrors v174 §4b (the brand_contact_directory self-seed): dynamic, so new
-- known_brands rows need no hardcoding here. canonical_brand is the human
-- display name (brand_name), consistent with the v174 seed values ('NAB',
-- '7-Eleven'). source='directory' — known_brands is a brand contact registry,
-- the same class as brand_contact_directory (v143).
--
-- SCOPE: purely additive reference data. No table altered, no write path
-- touched. ON CONFLICT DO NOTHING keeps watchlist/manual rows authoritative and
-- makes re-apply idempotent. Not a hot table.
--
-- ROLLBACK (run manually if ever needed — the rows are harmless canonical
-- mappings, so removal is optional):
--   DELETE FROM public.brand_aliases
--   WHERE source = 'directory'
--     AND alias_normalized IN (
--       SELECT public.brand_normalize(brand_name) FROM public.known_brands
--     );

INSERT INTO public.brand_aliases (alias_normalized, canonical_brand, source)
SELECT public.brand_normalize(kb.brand_name), kb.brand_name, 'directory'
FROM public.known_brands kb
WHERE public.brand_normalize(kb.brand_name) IS NOT NULL
ON CONFLICT (alias_normalized) DO NOTHING;
