-- v306: support subscriber FK checks without scanning the delivery history.
-- Additive follow-up to v305's production advisor result; no row rewrite.
SET statement_timeout = '30s';
CREATE INDEX IF NOT EXISTS newsletter_deliveries_subscriber_idx
  ON public.newsletter_deliveries(subscriber_id);
