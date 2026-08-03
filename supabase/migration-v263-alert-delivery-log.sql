-- migration-v263-alert-delivery-log.sql
--
-- NUMBERING NOTE. This file was authored as v260 and APPLIED TO PRODUCTION under
-- that name on 2026-07-30 02:48 UTC. While this branch was open, another session
-- merged `migration-v260-brand-alias-classifier-variants.sql` to `main` first and
-- claimed the number. The file was renumbered to v263 so that
-- `ls supabase/migration-v*.sql | sort -V | tail -1` stays meaningful; the prod
-- `supabase_migrations` ledger still records this as `v260_alert_delivery_log`.
-- The objects below already exist in prod — DO NOT re-apply expecting a change.
-- One knowing divergence: the COMMENT ON TABLE string below was updated to say
-- v263, so it points at a file that exists; prod's stored comment still reads
-- "migration-v260 header" until this file is next re-run. Cosmetic either way.
--
-- WHY. As of 2026-07-30 nothing in this database recorded that an operator alert
-- was delivered. An information_schema sweep for %alert%/%digest%/%notif%/%cron%/
-- %sent%/%deliver% returned 9 tables, all domain-purpose. Every alert funnels
-- through sendAdminTelegramMessage(), which returned Promise<void>, caught every
-- error into logger.error, and returned normally; `logger` is console-only, no
-- cron route emits to Axiom, and Vercel runtime-log retention is ~1 day. So
-- "did the alert fire?" was an unanswerable question across ~35 call sites.
--
-- That is what let the following go unnoticed:
--   * 83 consecutive skipped DR backups (a `skipped` conclusion pages nobody)
--   * 20 consecutive deep-investigation failures over 138 days
--   * acsc latched in backoff for 80 days with zero successes ever
--   * health-digest printing "all clear" while 3 non-muted feeds were 31-86
--     days dead
--
-- THE LOAD-BEARING PROPERTY. Every alerter writes exactly ONE row per firing,
-- INCLUDING the no-issue case (condition_met = false). This is what makes a
-- MISSING row mean "the alerter did not run" rather than "nothing was wrong".
-- Without it, silence stays indistinguishable from death — which is precisely
-- how phishstats reached 89 days at zero successes without anyone noticing.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.alert_delivery_log (
  id             bigserial PRIMARY KEY,

  -- Stable identifier for the alerter, matching the cron route directory name
  -- (e.g. 'health-digest', 'cost-daily-check'). Free text rather than an enum so
  -- adding an alerter never needs a migration — the CI invariant that every
  -- alerter appears here is the enforcement, not the type system.
  alerter        text        NOT NULL,

  fired_at       timestamptz NOT NULL DEFAULT now(),

  -- Did the alerter find something worth reporting? FALSE is the common, healthy
  -- case and MUST still be recorded. Do not "optimise" these rows away.
  condition_met  boolean     NOT NULL,

  -- 'telegram' | 'slack' | 'email' | 'founder_brief' | 'none'
  channel        text        NOT NULL DEFAULT 'telegram',

  --   sent             delivery confirmed by the transport
  --   no_alert_needed  ran, condition_met = false, nothing to send
  --   skipped_no_config  a required credential/chat id was absent
  --   muted            a feature flag suppressed a send that WAS needed
  --   failed           the transport rejected it or threw
  --
  -- 'muted' and 'no_alert_needed' are deliberately distinct: the first means a
  -- real alert was suppressed, the second means there was nothing to say. The
  -- audit's draft enum collapsed them, which would have hidden exactly the
  -- FF_LEGACY_DIGEST_TELEGRAM case it was written to expose.
  outcome        text        NOT NULL
                 CHECK (outcome IN ('sent','no_alert_needed','skipped_no_config','muted','failed')),

  error          text,
  latency_ms     integer,

  -- Short hash of the message body. Lets an operator tell "it sent the same
  -- thing 40 times" from "it sent 40 different things" without storing message
  -- content (which can carry scam text and user-adjacent detail).
  payload_digest text,

  metadata       jsonb       NOT NULL DEFAULT '{}'::jsonb
);

-- Drives the liveness query in the acceptance test (latest row per alerter,
-- and 7-day counts per alerter).
CREATE INDEX IF NOT EXISTS idx_alert_delivery_log_alerter_fired
  ON public.alert_delivery_log (alerter, fired_at DESC);

-- Drives "which alerters failed recently" without scanning the healthy rows.
CREATE INDEX IF NOT EXISTS idx_alert_delivery_log_failures
  ON public.alert_delivery_log (fired_at DESC)
  WHERE outcome IN ('failed','skipped_no_config','muted');

COMMENT ON TABLE public.alert_delivery_log IS
  'One row per operator-alerter firing, including no-issue firings. A missing row means the alerter did not run — never that nothing was wrong. See migration-v263 header.';
COMMENT ON COLUMN public.alert_delivery_log.condition_met IS
  'FALSE rows are required, not noise: they are what distinguishes a healthy alerter from a dead one.';

-- Service-role only. RLS on with no policies: the service key bypasses RLS, and
-- anon/authenticated get nothing. Matches the convention for operational tables
-- that no end user should read.
ALTER TABLE public.alert_delivery_log ENABLE ROW LEVEL SECURITY;

-- VOLUME. The busiest alerter is pg-stuck-query-watchdog at */5, i.e. ~2,016
-- rows/week; all 8 together are ~4,100/week or ~215k/year. That is small for
-- Postgres and both indexes are narrow, so no retention sweep ships here. If it
-- ever matters, delete where fired_at < now() - interval '180 days' and keep a
-- monthly rollup — but note that pruning makes older liveness questions
-- unanswerable, which is the whole point of the table.
