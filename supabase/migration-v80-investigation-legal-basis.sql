-- Migration v80: legal/consent basis for deep-investigation outputs.
--
-- The deep-investigation workflow (.github/workflows/deep-investigation.yml)
-- runs nmap / dnsrecon / nikto / whatweb / sslscan / whois against
-- third-party hosts that have been flagged as scam infrastructure. Under
-- Australian law (Criminal Code Act s.477.1, Privacy Act 1988) the legal
-- basis for sustained operations is unsettled — a passive whois lookup is
-- low risk, but active probing with nmap/nikto is greyer.
--
-- This migration records, on each `scam_entities` row, the basis under
-- which its most recent `investigation_data` was collected. The default
-- 'public_interest_research_unverified' is a deliberate flag: it means the
-- basis has NOT been formally reviewed by external counsel. Once advice
-- lands, individual rows can be elevated to 'public_interest_research' or
-- 'specific_consent', and the deep-investigation pipeline can be flipped
-- on at scale via vars.ENABLE_DEEP_INVESTIGATION='true'.
--
-- Companion change: deep-investigation.yml gains a legal-posture comment
-- block warning operators not to enable scheduled runs without sign-off.

ALTER TABLE scam_entities
  ADD COLUMN IF NOT EXISTS legal_basis TEXT NOT NULL DEFAULT 'public_interest_research_unverified',
  ADD COLUMN IF NOT EXISTS consent_basis TEXT;

COMMENT ON COLUMN scam_entities.legal_basis IS
  'Basis under which the most recent investigation_data was collected. ' ||
  'Default ''public_interest_research_unverified'' means the basis has not ' ||
  'been formally reviewed by counsel. Elevate per-row to ' ||
  '''public_interest_research'' or ''specific_consent'' once advice lands.';

COMMENT ON COLUMN scam_entities.consent_basis IS
  'Optional reference (URL, ticket id, contract id) to the specific consent ' ||
  'that authorised this investigation, when consent is the operative basis.';
