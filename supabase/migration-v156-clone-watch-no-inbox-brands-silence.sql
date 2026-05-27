-- v156: silence the 13 remaining bugcrowd_vdp brands by routing to 'none'
--
-- Context: v155 re-routed the big-four banks (NAB, Westpac, ANZ, CBA)
-- from bugcrowd_vdp to fraud_inbox after the 2026-05-27 e2e test
-- confirmed Bugcrowd VDPs reject brand-impersonation reports. The
-- remaining 13 brands on bugcrowd_vdp face the same problem — VDPs are
-- scoped to software vulnerabilities, not clone reports.
--
-- For these brands we don't (yet) have a verified phishing inbox.
-- Setting channel_type='none' means notify-brand short-circuits without
-- paging the admin. Coverage is still provided by:
--   * Netcraft community-blocklist submission (Layer 2 — fires on every
--     TP-confirm, 33-min median takedown)
--   * Scamwatch CSV export to ACCC (Layer 3 — admin uploads monthly)
--
-- Brands re-routed:
--   * Binance Australia
--   * Chemist Warehouse
--   * Coles
--   * Domain
--   * Kmart
--   * Liquorland
--   * Netflix (AU)
--   * Optus              (TODO follow-up: phishing@optus.com.au)
--   * realestate.com.au
--   * Service NSW        (TODO follow-up: investigate phishing@service.nsw.gov.au)
--   * Stan
--   * Target
--   * Telstra            (TODO follow-up: misuse@team.telstra.com)
--
-- Out of scope (separate issue): a v157 migration would set
-- Optus / Telstra / Service NSW back to fraud_inbox once their
-- phishing inboxes have been confirmed live.
--
-- Idempotent: re-running is a no-op once values match.

BEGIN;

UPDATE public.brand_contact_directory
SET channel_type = 'none',
    notes = 'No verified direct phishing channel. Bugcrowd VDP rejects clone reports (vulnerability-only scope). Coverage via Netcraft + Scamwatch CSV. Original Bugcrowd URL kept for reference: ' || COALESCE(recipient, '(none)'),
    updated_at = now()
WHERE brand IN (
    'Binance Australia',
    'Chemist Warehouse',
    'Coles',
    'Domain',
    'Kmart',
    'Liquorland',
    'Netflix (AU)',
    'Optus',
    'realestate.com.au',
    'Service NSW',
    'Stan',
    'Target',
    'Telstra'
  )
  AND channel_type = 'bugcrowd_vdp';

COMMIT;
