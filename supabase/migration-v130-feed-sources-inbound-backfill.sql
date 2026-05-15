-- v130 — Backfill feed_sources rows for the 12 v128 inbound_* slugs.
--
-- Why: v127 (PR-A1) seeded a single channel-level 'inbound_email' row,
-- and v129 seeded the 5 high-signal additions (ATO, SANS, TLDR, THN,
-- SecurityWeek). But the 12 original v128 inbound slugs (PR-A3) were
-- never given individual feed_sources rows — the constraint allows them
-- and feed_items already holds rows for inbound_scamwatch / inbound_acsc
-- / inbound_krebs, but the registry can't show them. Consequences:
--   * /api/cron/scraper-brake-alert can't include inbound_* in its
--     consecutive-failures monitoring.
--   * A future "what sources do we ingest?" admin view would miss
--     ~half the inbound channel.
--   * The add-inbound-email-source skill's step 3 ("seed a feed_sources
--     row") only works for new additions, not the 12 originals.
--
-- This migration is pure backfill: 12 INSERTs ON CONFLICT (slug) DO
-- NOTHING. enabled=false matches the v129 default — operator flips on
-- as subscriptions land per docs/ops/inbound-email-config.md §11.3.
--
-- Idempotent. No DDL, no constraint changes.

INSERT INTO public.feed_sources (slug, name, url, source_type, category, jurisdiction, enabled, poll_schedule, notes) VALUES
  -- ── Tier 1: AU government regulators ───────────────────────────────────
  ('inbound_scamwatch', 'Scamwatch alerts (email subscription)',
   'https://www.scamwatch.gov.au/about-us/news-and-alerts/subscribe-to-scam-alert-emails',
   'email', 'narrative', 'AU', false, 'event-driven',
   'PR-A3 v128. ACCC scam-alerts via Mailchimp. Primary AU scam-alert channel — no public RSS exists. Use scamwatch+ingest@askarthur-inbound.com.'),

  ('inbound_acsc', 'ACSC Alert Service (email subscription)',
   'https://www.cyber.gov.au/about-us/about-asd-acsc/alert-service',
   'email', 'narrative', 'AU', false, 'event-driven',
   'PR-A3 v128. Mirrors the public RSS but useful as a backup channel. Use acsc+ingest@askarthur-inbound.com.'),

  ('inbound_austrac', 'AUSTRAC media releases (email subscription)',
   'https://www.austrac.gov.au/subscribing-media-release-alerts',
   'email', 'narrative', 'AU', false, 'event-driven',
   'PR-A3 v128. Money-mule typology reports. Coexists with the AUSTRAC RSS scraper (PR-B3) when that ships. Use austrac+ingest@askarthur-inbound.com.'),

  ('inbound_oaic', 'OAIC newsletter (email subscription)',
   'https://www.oaic.gov.au/contact-us/subscribe',
   'email', 'narrative', 'AU', false, 'event-driven',
   'PR-A3 v128. NDB-adjacent privacy/data-breach context. Use oaic+ingest@askarthur-inbound.com.'),

  ('inbound_afp', 'AFP media releases (email subscription)',
   'https://www.afp.gov.au/news-centre/subscribe',
   'email', 'narrative', 'AU', false, 'event-driven',
   'PR-A3 v128. Cybercrime op announcements (JPC3, Operation Firestorm). Coexists with AFP RSS scraper (PR-B5). Use afp+ingest@askarthur-inbound.com.'),

  ('inbound_acma', 'ACMA scam + spam updates (email subscription)',
   'https://www.acma.gov.au/subscribe-acma-updates',
   'email', 'narrative', 'AU', false, 'event-driven',
   'PR-A3 v128. Telco-blocking stats + joint Scamwatch/ACMA alerts. Coexists with ACMA HTML scraper (PR-B2). Use acma+ingest@askarthur-inbound.com.'),

  -- ── Tier 2: industry CERTs and victim-support services ────────────────
  ('inbound_idcare', 'IDCARE Insights (email subscription)',
   'https://www.idcare.org/contact',
   'email', 'narrative', 'AU', false, 'event-driven',
   'PR-A3 v128. Victim-support context + post-incident guidance. Manual subscription request via contact form. Use idcare+ingest@askarthur-inbound.com.'),

  ('inbound_auscert', 'AusCERT digest (members-only email)',
   'https://www.auscert.org.au/contact-us/',
   'email', 'narrative', 'AU', false, 'event-driven',
   'PR-A3 v128. Week-in-Review digest. Requires paid membership (~A$1k/yr small-org tier). Use auscert+ingest@askarthur-inbound.com.'),

  -- ── Tier 1: international regulators ──────────────────────────────────
  ('inbound_ftc', 'FTC Consumer Alerts (GovDelivery subscription)',
   'https://public.govdelivery.com/accounts/USFTCCONSUMER/subscriber/new',
   'email', 'narrative', 'US', false, 'event-driven',
   'PR-A3 v128. Top US consumer-protection editorial. ~3 posts/week. GovDelivery wraps every link in lnks.gd redirects — Worker resolveTrackingUrl handles. Use ftc+ingest@askarthur-inbound.com.'),

  -- ── Tier 3: curated journalism / editorial ────────────────────────────
  ('inbound_riskybiz', 'Risky Biz News (Substack subscription)',
   'https://risky.biz/subscribe/',
   'email', 'narrative', 'INT', false, 'event-driven',
   'PR-A3 v128. Sydney-based cybersecurity commentary. Backup for the Substack RSS feed (PR-D1). Use riskybiz+ingest@askarthur-inbound.com.'),

  ('inbound_krebs', 'Krebs on Security (email subscription)',
   'https://krebsonsecurity.com/',
   'email', 'narrative', 'INT', false, 'event-driven',
   'PR-A3 v128. International scam commentary. Backup for the WordPress RSS feed (PR-D1). Use krebs+ingest@askarthur-inbound.com.'),

  -- ── Tier 4 (effectively): fallback when tag doesn''t match a subscription ─
  ('inbound_generic', 'Inbound email — unknown sender (fallback bucket)',
   NULL,
   'email', 'narrative', 'INT', false, 'event-driven',
   'PR-A3 v128. Receives mail whose recipient tag does not match any KNOWN_TAG in the Worker. Should be near-zero volume in steady state. If this row starts trending non-zero, treat as either a new source to add OR abuse — see PR-A4 (#236) for the sender-domain allowlist that will gate this further.')
ON CONFLICT (slug) DO NOTHING;

-- ── Verification (run after apply) ────────────────────────────────────────
--
-- SELECT slug, enabled FROM public.feed_sources WHERE slug LIKE 'inbound_%' ORDER BY slug;
-- Expect 18 rows: 1 channel-level (inbound_email from v127) + 12 v128 + 5 v129.
