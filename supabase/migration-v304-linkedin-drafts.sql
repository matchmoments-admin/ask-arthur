-- Manual company-page publishing. No cron or automatic retry consumes this table.
-- Additive / idempotent rollback: disable LINKEDIN_STUDIO_PUBLISH_ENABLED;
-- retain drafts and publish receipts for reconciliation.
SET statement_timeout = '30s';
CREATE TABLE IF NOT EXISTS public.linkedin_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  commentary text NOT NULL CHECK (length(commentary) BETWEEN 1 AND 3000),
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','publishing','published','uncertain')),
  author_urn text,
  post_urn text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  attempted_at timestamptz,
  published_at timestamptz
);
ALTER TABLE public.linkedin_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.linkedin_drafts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.linkedin_drafts TO service_role;
DROP POLICY IF EXISTS linkedin_drafts_service ON public.linkedin_drafts;
CREATE POLICY linkedin_drafts_service ON public.linkedin_drafts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Stable IDs make seed reapplication safe; never overwrite an operator's edits.
INSERT INTO public.linkedin_drafts (id, title, commentary) VALUES
('a47a0001-0000-4000-8000-000000000001', 'Delivery texts: pause and check',
'Waiting for a parcel makes a delivery text feel plausible. Our first check: open the delivery service independently and compare the tracking details.

Arthur’s Watch is one free weekly email with a practical scam-checking habit you can share with family and friends.

Join at https://askarthur.au/subscribe'),
('a47a0001-0000-4000-8000-000000000002', 'Lookalike shops: check beyond the logo',
'A familiar logo is a starting point, not a completed check. Before paying a new online shop, compare its address with a route you trust and look beyond its own website.

A low price is a reason to investigate, not proof of a scam. A padlock does not prove who runs a shop.

Get practical checking habits in Arthur’s Watch: https://askarthur.au/subscribe'),
('a47a0001-0000-4000-8000-000000000003', 'Keep security codes private',
'Someone asks for the code that just arrived on your phone. Pause and read what the code is actually for.

Keep security codes private, including when asking someone else to assess a suspicious message. Remove them from screenshots before sharing.

More practical checking habits in Arthur’s Watch: https://askarthur.au/subscribe'),
('a47a0001-0000-4000-8000-000000000004', 'Already replied? Take the next step',
'Already replied to a suspicious message? Start with what was shared and what needs attention now. A calm next step helps more than blame.

If money or bank details are involved, contact your bank promptly through its app or a number you obtained independently. You do not need to wait for a scam-checker result.

Join Arthur’s Watch for practical scam-awareness tips: https://askarthur.au/subscribe')
ON CONFLICT (id) DO NOTHING;
