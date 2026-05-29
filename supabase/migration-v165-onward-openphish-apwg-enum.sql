-- v165 — Add OpenPhish + APWG as onward-reporting destinations.
--
-- Extends the public.onward_destination enum (created in v119) with two
-- URL-blocklist intakes that accept unsolicited phishing-URL reports by email:
--   - 'openphish' → report@openphish.com
--   - 'apwg'      → reportphishing@apwg.org
--
-- The report.onward.openphish / report.onward.apwg Inngest workers
-- (onward-openphish.ts / onward-apwg.ts) consume these; both are gated by
-- FF_ONWARD_OPENPHISH / FF_ONWARD_APWG (default OFF) so no email sends until
-- the destinations are deliberately enabled.
--
-- IMPORTANT: this migration ONLY adds the enum values. It does NOT use them
-- (no cast to ::onward_destination, no get_onward_destinations rewrite). New
-- enum values cannot be referenced in the same transaction that adds them
-- (Postgres "unsafe use of new value of enum type"), so any RPC change that
-- emits these destinations must ship in a SEPARATE, later migration applied
-- after this one commits.
--
-- Idempotent: ADD VALUE IF NOT EXISTS is a no-op when the value already
-- exists, so re-running is safe.

ALTER TYPE public.onward_destination ADD VALUE IF NOT EXISTS 'openphish';
ALTER TYPE public.onward_destination ADD VALUE IF NOT EXISTS 'apwg';
