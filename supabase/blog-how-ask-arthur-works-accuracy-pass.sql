-- supabase/blog-how-ask-arthur-works-accuracy-pass.sql
--
-- Second pass over the how-ask-arthur-works blog post body, after the
-- callout insertion migration (blog_how_ask_arthur_works_callouts).
--
-- Changes:
--   1. Rename "Part 5 — the things I would change tomorrow" to
--      "Part 5 — things I'll improve" — the list isn't permanent and
--      several items have moved since the original post.
--   2. Soften the intro under Part 5 to acknowledge that some items are
--      partially shipped, not all missing.
--   3. Item 5 (Phase 2b / storeVerifiedScam): the durable Inngest
--      `analyze-completed-report` consumer is now live; only
--      `storeVerifiedScam` itself remains on waitUntil.
--   4. Item 8 (Vonage): migrations v75/v76 applied, provider code is
--      live behind FF_VONAGE_ENABLED — the holdout is env-var setup
--      and compliance sign-off, not an unshipped engineering change.
--   5. Item 9 (multi-region): region detection (sprint-6) is live; only
--      the infrastructure-wide multi-region work remains.
--   6. Threat-feed corpus numbers: post claimed "164,000 URLs and
--      140,000 IPs" which does not match current prod (scam_urls=50,
--      scam_ips=0, feed_items=1401). Rewritten to describe the
--      architecture honestly without inventing numbers that will go
--      stale.
--
-- Idempotent: all replacements are no-ops once applied. Guard is a
-- content check for the new section header "things I'll improve".

UPDATE public.blog_posts
SET
  content = REPLACE(
    REPLACE(
      REPLACE(
        REPLACE(
          REPLACE(
            REPLACE(
              content,
              E'## Part 5 — the things I would change tomorrow',
              E'## Part 5 — things I''ll improve'
            ),
            E'I would be doing a disservice to anyone using this post as a reference if I pretended the stack was finished. Here are the nine things that are missing or undercooked, roughly in the order I would fix them.',
            E'I would be doing a disservice to anyone using this post as a reference if I pretended the stack was finished. None of these are permanent — some are actively in progress, some are planned, some are waiting on a compliance sign-off rather than an engineering change. Here are the nine areas I''m working on, roughly in the order I''d fix them.'
          ),
          E'**5. Phase 2b — the last inline write.** `storeVerifiedScam`, which writes the highest-confidence `HIGH_RISK` submissions into a permanent record, still runs inline via `waitUntil`. It hasn''t moved to Inngest yet because verified scams can carry image evidence, and we haven''t finalised the R2 staging design that lets an Inngest function consume a blob the user uploaded ten seconds ago without re-uploading it. This is a week of design work we keep deferring.',
          E'**5. Phase 2b — the last inline write.** The durable Inngest consumer `analyze-completed-report` now owns the bulk of post-verdict persistence, gated behind `FF_ANALYZE_INNGEST_WEB`. What''s still inline on `waitUntil` is `storeVerifiedScam`, which writes the highest-confidence `HIGH_RISK` submissions — the holdout is the R2 staging design that lets an Inngest function consume image evidence the user uploaded ten seconds ago without re-uploading it. Most of the refactor is done; this is the last inch.'
        ),
        E'**8. Single-telco dependency.** Our phone intelligence is Twilio Lookup v2. We''ve built the schema and feature flags for a Vonage migration (migrations v75 and v76) but the migration hasn''t shipped. Until it does, a Twilio pricing change or outage is a direct product problem.',
        E'**8. Single-telco dependency.** Our phone intelligence runs through Twilio Lookup v2 today. Migrations v75 and v76 have shipped, the Vonage Number Insight + CAMARA SIM-Swap provider code is live behind `FF_VONAGE_ENABLED`, and six phone-footprint sprints have landed the orchestration, Stripe SKUs, consumer UI, and international foundations. What''s left is provisioning Vonage API credentials in prod and flipping the flag — a compliance sign-off task rather than an engineering change.'
      ),
      E'**9. Single-region architecture.** Everything runs in `ap-southeast-2` (Sydney). This is fine for an Australian product, but if the roadmap includes ASEAN — which it probably should — multi-region Postgres and edge-aware routing aren''t trivial retrofits. Better to make the architectural calls *before* the rewrite is forced.',
      E'**9. Single-region architecture.** Region detection via Vercel edge headers shipped in sprint-6 (April 2026), so requests are already tagged with country and region and product decisions can branch on them. What''s not yet in place is the infrastructure layer: multi-region Postgres, per-region edge routing, provider geo-routing. Those aren''t trivial retrofits, and with ASEAN on the roadmap it''s better to make the architectural calls *before* the rewrite is forced.'
    ),
    E'The Claude call is the visible part of the verdict, but it''s not the thing that makes verdicts credible. The thing that makes verdicts credible is having 164,000 malicious URLs and 140,000 malicious IPs to cross-reference against, many of them updated within the hour.',
    E'The Claude call is the visible part of the verdict, but it''s not the thing that makes verdicts credible. The thing that makes verdicts credible is having a corroborating threat-intel corpus to cross-reference against — continuously refreshed by the 16 cron scrapers, deduplicated into `scam_urls` and `scam_entities`, and ready to be joined against any user submission. The corpus is young today (dozens of canonical URLs, a few thousand raw feed items per cycle) and the architecture is designed to scale into the hundreds of thousands as more feeds compound.'
  ),
  updated_at = NOW()
WHERE slug = 'how-ask-arthur-works'
  AND position('things I''ll improve' in content) = 0;

-- Verification: post should now contain the new section header and
-- should NOT contain the stale "164,000 malicious URLs" claim.
DO $$
DECLARE
  has_new_header boolean;
  has_stale_number boolean;
  has_stale_vonage_claim boolean;
BEGIN
  SELECT
    position('things I''ll improve' in content) > 0,
    position('164,000 malicious URLs' in content) > 0,
    position('the migration hasn''t shipped' in content) > 0
  INTO has_new_header, has_stale_number, has_stale_vonage_claim
  FROM public.blog_posts
  WHERE slug = 'how-ask-arthur-works';

  IF NOT has_new_header THEN
    RAISE EXCEPTION 'Accuracy pass failed — new section header not found';
  END IF;
  IF has_stale_number THEN
    RAISE EXCEPTION 'Accuracy pass failed — stale "164,000 malicious URLs" claim still present';
  END IF;
  IF has_stale_vonage_claim THEN
    RAISE EXCEPTION 'Accuracy pass failed — stale Vonage "hasn''t shipped" claim still present';
  END IF;
END $$;
