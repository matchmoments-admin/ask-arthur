-- v240 — wa_scamnet: publishable → ingest-only (#807)
--
-- WHY: WA ScamNet's copyright notice (scamnet.wa.gov.au/scamnet/Copyright.htm)
-- expressly bars reproduction/re-use "for any commercial purposes whatsoever
-- without prior written permission" — WA state Crown copyright, no Creative
-- Commons grant, unlike the Commonwealth CC-BY sources (Scamwatch CC BY 3.0 AU,
-- ACSC CC BY 4.0). v213 tagged the source publishable on the assumption it
-- followed the Commonwealth pattern; the 2026-07-17 licence review
-- (monetisation wayfinder, ticket T2) disproved that.
--
-- Mechanism: the intel-inbound-email edge function now includes
-- inbound_wa_scamnet in COMPETITOR_INTEL_SOURCES, so new items land
-- quarantined (category='competitor_intel', published=false — the ADR-0021
-- ingest-but-never-publish rail; the tier stays tier_1_regulator because the
-- quarantine is a licensing constraint, not a trust judgement).
--
-- This migration: (1) corrects the feed_sources registry notes, and
-- (2) retags any feed_items rows that may have landed publishable between the
-- licence finding and the edge-function deploy. At authoring time the source
-- had 0 feed_items rows — the UPDATE is a belt-and-braces no-op, kept because
-- it makes the migration safe to apply in any order relative to the deploy.
-- Reverse (if Consumer Protection WA grants written permission): remove the
-- source from COMPETITOR_INTEL_SOURCES and re-run these UPDATEs with the
-- previous values.

UPDATE public.feed_sources
SET notes = 'tier_1_regulator — Consumer Protection WA (state gov). INGEST-ONLY (#807): WA Crown copyright bars commercial reproduction without written permission — quarantined via competitor_intel category despite regulator tier. Publishable again only on written permission.'
WHERE slug = 'inbound_wa_scamnet';

UPDATE public.feed_items
SET category = 'competitor_intel', published = false
WHERE source = 'inbound_wa_scamnet'
  AND (category IS DISTINCT FROM 'competitor_intel' OR published = true);
