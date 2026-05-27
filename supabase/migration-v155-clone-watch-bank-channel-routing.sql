-- v155: re-route big-four banks from bugcrowd_vdp to fraud_inbox
--
-- Why this is wrong: v150 standardised on `bugcrowd_vdp` for the big-four
-- banks (NAB, Westpac, ANZ) and security_txt for CBA's `vulnerability@`
-- inbox. Both routes assume the receiving program accepts phishing /
-- clone reports.
--
-- Real-world test on 2026-05-27: NAB's Bugcrowd program explicitly
-- rejects phishing/clone reports — VDPs are scoped to vulnerability
-- disclosure (e.g. CSRF in their app), not "we found a clone of your
-- consumer site." Same is true for ANZ + Westpac per their published
-- VDP scopes. CBA's `vulnerability@cba.com.au` is the security-research
-- inbox (RFC 9116 contact), not a phishing channel — phishing reports go
-- to `hoaxes@cba.com.au`.
--
-- This migration:
--   * Updates NAB, Westpac, ANZ from bugcrowd_vdp → fraud_inbox with
--     their published phishing-report addresses (per the v143b seed
--     notes which already listed them as TODO-verify candidates, and
--     per each bank's public security pages).
--   * Updates CBA from security_txt → fraud_inbox so the right team
--     receives the clone alerts (the security-research inbox would
--     otherwise just forward + delay).
--
-- The Bugcrowd URLs in `notes` are preserved so admins can still find
-- them if a real vulnerability comes through clone-watch (rare but
-- possible). The recipient is the email; `notes` is documentation.
--
-- Failure mode if an address bounces: Resend returns an error, the send
-- endpoint logs it, the row stays in 'pending' for retry. Worst case is
-- a no-op (no email sent) until we update the directory with the
-- correct address in v156.
--
-- The Netcraft submission lane (33-min median takedown) still fires
-- independently of this routing — that's the actual protection layer.
-- The brand-direct email is the courtesy "your brand is being cloned"
-- nudge.
--
-- Idempotent: the four UPDATEs target specific brand PKs by name, so
-- re-running is a no-op once the values match.

BEGIN;

UPDATE public.brand_contact_directory
SET channel_type = 'fraud_inbox',
    recipient = 'phishing@nab.com.au',
    evidence_format = 'plain_email',
    notes = 'NAB phishing inbox per nab.com.au/security. v150 routed via Bugcrowd VDP — that program rejects clone reports (VDP scope is software vulnerabilities, not brand impersonation). Bugcrowd URL kept for reference: https://bugcrowd.com/nationalaustraliabankog. Covers ubank, Medfin, Advantedge.',
    updated_at = now()
WHERE brand = 'NAB';

UPDATE public.brand_contact_directory
SET channel_type = 'fraud_inbox',
    recipient = 'hoax@westpac.com.au',
    evidence_format = 'plain_email',
    notes = 'Westpac published phishing/hoax inbox. v150 routed via Bugcrowd VDP — wrong scope (vulnerability disclosure only). Bugcrowd URL: https://bugcrowd.com/engagements/westpac-vdp-pro. Covers St.George, Bank of Melbourne, BankSA.',
    updated_at = now()
WHERE brand = 'Westpac';

UPDATE public.brand_contact_directory
SET channel_type = 'fraud_inbox',
    recipient = 'hoax@cybersecurity.anz.com',
    evidence_format = 'plain_email',
    notes = 'ANZ phishing-only inbox. Already documented in v150 notes as the alt fraud channel; promoting it to the primary recipient. Bugcrowd URL kept for reference: https://bugcrowd.com/anz-vdp.',
    updated_at = now()
WHERE brand = 'ANZ';

UPDATE public.brand_contact_directory
SET channel_type = 'fraud_inbox',
    recipient = 'hoaxes@cba.com.au',
    evidence_format = 'plain_email',
    notes = 'CBA published phishing/hoaxes inbox. Previously routed to vulnerability@cba.com.au via security_txt — that is the security-research channel (RFC 9116 contact), not the phishing intake. CommBank Group: covers CBA + Bankwest (separate hoax form).',
    updated_at = now()
WHERE brand = 'CBA';

COMMIT;
