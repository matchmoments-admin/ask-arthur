-- migration-v94-feedback-triage-queue.sql
-- Surface the verdict_feedback write-only sink to a human triage queue.
--
-- Today, /api/feedback inserts thumbs-up/down rows into verdict_feedback
-- (schema: v47 + v66 + v67) but nothing reads them. No admin queue, no
-- digest, no retraining loop — every disagreement signal is silently
-- collected and ignored. v94 builds the substrate for a /admin/feedback
-- triage page + daily Telegram digest by exposing a materialised view
-- prioritised by "uncertainty × harm" — the active-learning ordering
-- documented by Feedzai/Sardine for fraud-ML triage.
--
-- Mechanism:
--   * feedback_triage_queue MV joins verdict_feedback to scam_reports,
--     filters to last 30 days of disagreements (excludes user_says='correct'),
--     and computes triage_score = uncertainty × impact_weight.
--     - uncertainty peaks at confidence 0.5 (the model was 50/50 — most
--       valuable for the active-learning loop).
--     - impact_weight: false_negative=3 (missed scam — direct harm),
--       user_reported=2 (community signal), false_positive=1 (annoyance),
--       correct=0 (filtered out by the WHERE clause).
--   * refresh_feedback_triage_queue() is a SECURITY DEFINER RPC so a cron
--     calling it doesn't need direct REFRESH privileges. CONCURRENTLY
--     keeps the admin page readable during refresh.
--
-- Idempotency: CREATE MATERIALIZED VIEW IF NOT EXISTS, CREATE OR REPLACE
-- FUNCTION, CREATE INDEX IF NOT EXISTS. Safe to re-run.
--
-- Source schema reference:
--   * verdict_feedback (v47) — id, reporter_hash, verdict_given,
--     user_says (correct|false_positive|false_negative|user_reported per v67),
--     comment, submitted_content_hash, created_at.
--   * verdict_feedback (v66) — scam_report_id, analysis_id, reason_codes[],
--     training_consent, wants_followup, followup_email, user_agent_family,
--     locale.
--   * scam_reports (v21:15) — confidence_score REAL NOT NULL (already
--     populated end-to-end by report-store.ts:75 → create_scam_report RPC).

begin;

-- ── Materialised view: triage queue ────────────────────────────────────────

create materialized view if not exists feedback_triage_queue as
select
  vf.id                       as feedback_id,
  vf.created_at               as feedback_created_at,
  vf.verdict_given,
  vf.user_says,
  vf.reason_codes,
  vf.training_consent,
  vf.comment,
  vf.locale,
  vf.user_agent_family,
  vf.submitted_content_hash,
  vf.scam_report_id           as report_id,
  vf.analysis_id,
  sr.scrubbed_content,
  sr.confidence_score         as verdict_confidence,
  sr.scam_type,
  sr.impersonated_brand,
  sr.source                   as report_source,
  sr.created_at               as report_created_at,
  -- Uncertainty: 1.0 at confidence 0.5, 0.0 at the extremes 0.0/1.0.
  -- Orphan feedback (no linked report) gets 0.5 — neutral, not zero.
  case
    when sr.confidence_score is null then 0.5
    else 1.0 - abs(sr.confidence_score - 0.5) * 2
  end as uncertainty,
  -- Impact weight: false_negative is the most expensive class to miss
  -- (we said SAFE on something the user knows is a scam → real harm).
  -- user_reported is community-signal escalation. false_positive is
  -- friction without harm.
  case vf.user_says
    when 'false_negative' then 3
    when 'user_reported'  then 2
    when 'false_positive' then 1
    else                       0
  end as impact_weight,
  -- triage_score combines both. Orphan feedback can still rank if
  -- impact_weight is high (e.g. false_negative without scam_report_id
  -- still rates 0.5 × 3 = 1.5).
  (case
     when sr.confidence_score is null then 0.5
     else 1.0 - abs(sr.confidence_score - 0.5) * 2
   end
   *
   case vf.user_says
     when 'false_negative' then 3
     when 'user_reported'  then 2
     when 'false_positive' then 1
     else                       0
   end) as triage_score
from public.verdict_feedback vf
left join public.scam_reports sr on sr.id = vf.scam_report_id
where vf.created_at > now() - interval '30 days'
  and vf.user_says <> 'correct';

-- Unique index required for REFRESH MATERIALIZED VIEW CONCURRENTLY.
create unique index if not exists idx_feedback_triage_feedback_id
  on feedback_triage_queue (feedback_id);

create index if not exists idx_feedback_triage_score
  on feedback_triage_queue (triage_score desc, feedback_created_at desc);

create index if not exists idx_feedback_triage_user_says
  on feedback_triage_queue (user_says, feedback_created_at desc);

-- ── Refresh RPC (SECURITY DEFINER) ─────────────────────────────────────────
-- Cron-callable refresher. CONCURRENTLY needs the unique index above and
-- needs the MV to have at least one row at the time of first concurrent
-- refresh — CREATE MATERIALIZED VIEW populates immediately, so the first
-- REFRESH CONCURRENTLY after this migration is safe.

create or replace function public.refresh_feedback_triage_queue()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  refresh materialized view concurrently feedback_triage_queue;
end;
$$;

comment on function public.refresh_feedback_triage_queue is
  'Refreshes feedback_triage_queue MV concurrently. Called by the feedback-triage-refresh Inngest cron every 5 min.';

revoke all on function public.refresh_feedback_triage_queue() from public;
grant execute on function public.refresh_feedback_triage_queue() to service_role;

-- ── Aggregate view for the daily digest ────────────────────────────────────
-- Read by /api/cron/feedback-digest. Splits last 24h feedback by user_says
-- and verdict_given so the Telegram message can say
-- "47 thumbs-up, 3 false-positive on SAFE, 2 false-negative on SUSPICIOUS".

create or replace view public.feedback_disagreement_24h as
select
  user_says,
  verdict_given,
  count(*)::int as n,
  array_agg(submitted_content_hash) filter (where submitted_content_hash is not null) as content_hashes
from public.verdict_feedback
where created_at > now() - interval '24 hours'
group by user_says, verdict_given;

comment on view public.feedback_disagreement_24h is
  'Last 24h verdict_feedback grouped by (user_says, verdict_given). Read by the feedback-digest cron — silent below 1 disagreement.';

commit;
