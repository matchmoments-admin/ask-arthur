-- v182 — Unsubscribe suppression list for the monthly Brand Stewardship Report.
--
-- The report's recipients are brand security/abuse contacts (known_brands), NOT
-- consumer marketing subscribers (email_subscribers). So the existing one-click
-- unsubscribe (which flips email_subscribers.is_active) is the wrong store. This
-- dedicated, email-keyed list is consulted by the send route before any REAL
-- send, and written by /api/brand-stewardship/unsubscribe (RFC 8058 one-click +
-- in-body link). Keyed by lowercased email so one opt-out covers a contact
-- across every brand they're listed for.
--
-- Tiny table, service-role-only (the send route + unsubscribe handler use the
-- service client; RFC 8058 one-click is authenticated by the HMAC token, not RLS).

CREATE TABLE IF NOT EXISTS public.brand_report_unsubscribes (
  email TEXT PRIMARY KEY,
  unsubscribed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT
);

ALTER TABLE public.brand_report_unsubscribes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brand_report_unsubscribes_service_all
  ON public.brand_report_unsubscribes;
CREATE POLICY brand_report_unsubscribes_service_all
  ON public.brand_report_unsubscribes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.brand_report_unsubscribes IS
  'Email-keyed (lowercased) opt-out list for the Brand Stewardship Report. Checked by the send route before a real send; written by /api/brand-stewardship/unsubscribe. Distinct from the consumer email_subscribers list.';
