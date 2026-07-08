-- v210 — Allow category='competitor_intel' on feed_items.
--
-- Why: v209 added the competitor consumer scam-newsletter source class
-- (ADR-0021). The Edge Function stamps those rows category='competitor_intel'
-- so the admin promote action can refuse them (they must never reach the public
-- /scam-feed). But feed_items_category_check did not include that value, so the
-- insert failed with 23514 — competitor emails would have been silently lost as
-- db_write_failed 500s. This extends the check. 'competitor_intel' is a
-- handling/provenance marker, consistent with the existing non-scam-type values
-- 'informational' and 'other' already in this column.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS / ADD CONSTRAINT.

ALTER TABLE public.feed_items DROP CONSTRAINT IF EXISTS feed_items_category_check;
ALTER TABLE public.feed_items ADD CONSTRAINT feed_items_category_check
  CHECK (category = ANY (ARRAY[
    'phishing', 'romance_scam', 'investment_fraud', 'tech_support',
    'impersonation', 'shopping_scam', 'phone_scam', 'email_scam', 'sms_scam',
    'employment_scam', 'advance_fee', 'rental_scam', 'sextortion',
    'informational', 'other',
    'competitor_intel'  -- v210: source-class marker for ADR-0021 newsletters
  ]));
