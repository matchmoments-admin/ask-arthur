-- migration-v329-takedown-metrics-on-vendor-clock.sql
--
-- #1234 (absorbs #1148; #1071's two fixes were verified already live — v292/v293).
-- Takedown and outcome metrics that can be defended. Every number below was
-- measured against prod on 2026-09-26 before this file was written.
--
-- ── 1. "Median time to blocklisting: 0 min" was two clocks subtracted ────────
--
-- clone_watch_takedown_stats (v145) computes
--     submitted_to.netcraft.takedown_at − submitted_to.netcraft.submitted_at
-- Since v314 the first term is NETCRAFT's classification time (its own
-- classification_log) and the second is OURS, written after the POST returns.
-- Netcraft classifies inside that gap, so 30-day output was
--     n=8, median 0, fastest −2 min
-- — a negative takedown time on the public /clone-watch page. Of the 8 rows,
-- 7 are vendor-dated (netcraft_log) and read −2, −1, −1, 0, 0, 0, −2 minutes.
--
-- Netcraft's own receipt time for a submission (its `date`) was read by the
-- reconciler every run and thrown away (v314 used it only as a lower bound).
-- Measured over the 30 submissions of the last 25 days (read-only GETs of
-- /submission/{uuid}): our submitted_at trails Netcraft's receipt by 1–142 s,
-- and Netcraft finishes processing 0 min – 12.1 h after receipt (median ~5 min).
--
-- FIX. record_netcraft_url_verdicts now persists that receipt time:
--   submitted_to.netcraft.received_at          — receipt of the CURRENT uuid
--   submitted_to.netcraft.takedown_received_at — receipt of the submission
--                                                whose log dated takedown_at
-- and clone_watch_takedown_stats is rewritten so every published duration has
-- both ends on ONE event pair that cannot go negative:
--   * Netcraft triage latency (median_minutes …) — takedown_at − takedown_received_at,
--     both Netcraft's clock. Starts at n=0: no row carries the receipt yet.
--   * detection → blocklisting (detect_to_block_*) — weaponised_at (our urlscan
--     witness of live phishing) → takedown_at. Hour-scale, so the seconds of
--     skew between the two clocks cannot change the sign; a row Netcraft had
--     already blocked before we saw it phishing is COUNTED
--     (blocked_before_detection), never averaged in as a negative.
-- The four latency columns are NULL, not 0, when their sample is empty (v145
-- COALESCEd to 0, which is how "no data" rendered as "0 min").
--
-- ── 2. A witnessed-offline clock (the missing "taken_down_at") ─────────────
--
-- Checked first, as asked: a takedown timestamp DOES exist —
-- submitted_to.netcraft.takedown_at, vendor-dated since v314 and witnessed
-- (v219) before that. What does not exist is any record of a weaponised site
-- going OFFLINE. lifecycle `taken_down` means "Netcraft classified it
-- malicious" — every reader says so (outcome-copy "ACTIONED BY NETCRAFT",
-- squatting "Blocklisted … the site may still be online", clone-metrics
-- "Netcraft actioned it") — so it must not also absorb "went offline", or all
-- of those labels start lying. The new clock is:
--   offline_since       — first time our DNS probe proved the name gone (NXDOMAIN)
--   liveness_checked_at — the probe's cadence stamp
-- A second NXDOMAIN read >= 12 h after the first CONFIRMS it, and the alert
-- moves weaponised → dormant (alert_state expired, the v288 terminal sync).
-- `dormant` is already "no longer live, not actioned by anyone we can name";
-- the pair (weaponised_at, offline_since) is what distinguishes an
-- offline-after-phishing clone from a v285 never-scanned one.
--
-- ── 3. The weaponised backlog nothing rechecks ─────────────────────────────
--
-- 142 alerts sit in `weaponised`; 109 were weaponised > 30 days ago; 5 had
-- last_rechecked_at in the last 7 days. Structural: the urlscan recheck lane
-- only admits monitoring/declined, and the reconcile + issue worklists stop at
-- a 30-day submitted_at window (52 of the 142 are outside it). Nothing could
-- ever move a weaponised alert whose site died. list_weaponised_for_liveness /
-- record_weaponised_liveness give the reconcile lane a DNS-only sweep of the
-- whole weaponised set (no urlscan quota; no age cap) — see
-- clone-watch-netcraft-reconcile.ts. `due_total` is returned beside the
-- LIMITed rows so a truncated sweep is counted, not silent
-- (worklist-gate-starvation rule).
--
-- ── 4. No-threat-on-phishing: Netcraft's own escalation path is exhausted ──
--
-- Of the 142 weaponised: Netcraft says `no threats` on 52 and `unavailable`
-- on 37; 47 of the no-threats already carry an issue filed against their
-- CURRENT submission, and 28 carry Netcraft's reason "Already reported and
-- rejected." Zero of the 142 have an enforcement case
-- (shopfront_takedown_attempts is empty — FF_CLONE_ENFORCEMENT is dark) and
-- zero have an onward report. Reconcile's `weaponisedNoThreats` (41 on the
-- last run) re-counts the same rows every run and triggers nothing.
-- list_netcraft_vendor_gap / mark_netcraft_vendor_gap_escalated select and
-- stamp submitted_to.vendor_gap ONCE per alert when Netcraft has explicitly rejected it, or when an issue on the current
-- submission is >= 72 h old and a verdict read after that still says
-- no threats / unavailable; the lane then pages the operator, who owns the
-- human-gated levers (registrar abuse, Safe Browsing). 72 h: of the 9 issue →
-- malicious conversions ever recorded, 4 landed within 71 h (19, 71, 71, 71;
-- then 187 … 551 h). Escalating does not stop Netcraft acting later.
-- Once per ALERT, deliberately NOT per submission (contrast v287): the
-- escalation target is outside Netcraft, so a new Netcraft uuid does not
-- change what the operator must do, and a per-submission scope would re-page
-- on every v250 resubmit.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP FUNCTION IF
-- EXISTS before the one return-type change. No data rewrite; nothing here
-- touches more than the 3.6k-row alerts table. Not applied by this PR.
--
-- REVERSE: DROP FUNCTION the five new functions; re-run v320 §2 for
-- record_netcraft_url_verdicts and v145 §2 + v160's grants for
-- clone_watch_takedown_stats; ALTER TABLE … DROP COLUMN offline_since,
-- liveness_checked_at (only after reverting the reconcile code). Alerts
-- moved weaponised → dormant by the sweep are identifiable
-- (offline_since IS NOT NULL AND weaponised_at IS NOT NULL) and can be put
-- back with one UPDATE (lifecycle_state='weaponised', alert_state='open').

BEGIN;

-- ── 2. Columns ─────────────────────────────────────────────────────────────
ALTER TABLE public.shopfront_clone_alerts
  ADD COLUMN IF NOT EXISTS liveness_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS offline_since timestamptz;

COMMENT ON COLUMN public.shopfront_clone_alerts.liveness_checked_at IS
  'v329. Last DNS liveness read of a WEAPONISED alert by the reconcile lane''s sweep (record_weaponised_liveness). Cadence stamp only — says nothing about the verdict.';
COMMENT ON COLUMN public.shopfront_clone_alerts.offline_since IS
  'v329. First read at which our DNS probe proved a weaponised alert''s name gone (NXDOMAIN on A and NS). Cleared by a later read that finds the name. A second NXDOMAIN >= 12 h later moves the alert weaponised → dormant; this value is then the witnessed offline time (upper bound: the true moment is between the previous read and this one).';

-- ── 1. record_netcraft_url_verdicts — v320 body + Netcraft's receipt clock ──
CREATE OR REPLACE FUNCTION public.record_netcraft_url_verdicts(p_verdicts jsonb)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s'
AS $function$
  WITH v AS (
    SELECT
      (e ->> 'id')::bigint                         AS id,
      NULLIF(e ->> 'url_state', '')                AS url_state,
      NULLIF(e ->> 'reason', '')                   AS reason,
      NULLIF(e ->> 'malicious_at', '')::timestamptz AS malicious_at,
      NULLIF(e ->> 'netcraft_submitted_at', '')::timestamptz AS nc_submitted_at
    FROM pg_catalog.jsonb_array_elements(COALESCE(p_verdicts, '[]'::jsonb)) e
    WHERE (e ->> 'id') IS NOT NULL
  ),
  calc AS (
    SELECT
      sca.id,
      v.url_state,
      v.reason,
      v.malicious_at,
      v.nc_submitted_at                                                     AS received_at,
      -- LEAST ignores NULLs: whichever clock we have, the earlier one wins.
      LEAST(
        (sca.submitted_to -> 'netcraft' ->> 'submitted_at')::timestamptz,
        v.nc_submitted_at
      )                                                                     AS submitted_at,
      (sca.submitted_to -> 'netcraft_issue' ->> 'issue_reported_at')::timestamptz AS issue_at,
      sca.submitted_to
    FROM public.shopfront_clone_alerts sca
    JOIN v ON v.id = sca.id
    WHERE sca.submitted_to ? 'netcraft'
  ),
  upd AS (
    UPDATE public.shopfront_clone_alerts sca
    SET submitted_to = (
      SELECT pg_catalog.jsonb_set(
        c.submitted_to,
        '{netcraft}',
        ((c.submitted_to -> 'netcraft') - 'already_malicious_at_submit')
          || pg_catalog.jsonb_build_object(
               'url_state',        c.url_state,
               'url_state_reason', c.reason,
               'url_state_at',     pg_catalog.now()::text,
               -- v316 backoff input; v320 idempotent under a retried apply.
               'unchanged_reads',  CASE
                 WHEN (c.submitted_to -> 'netcraft' ->> 'url_state') IS DISTINCT FROM c.url_state
                 THEN 0
                 WHEN (c.submitted_to -> 'netcraft' ->> 'url_state_at') IS NOT NULL
                      AND (c.submitted_to -> 'netcraft' ->> 'url_state_at')::timestamptz
                          > pg_catalog.now() - interval '1 hour'
                 THEN COALESCE((c.submitted_to -> 'netcraft' ->> 'unchanged_reads')::int, 0)
                 ELSE COALESCE((c.submitted_to -> 'netcraft' ->> 'unchanged_reads')::int, 0) + 1
               END
             )
          -- v329: Netcraft's receipt time of the CURRENT submission. Was read
          -- every run and discarded; without it no duration can be computed on
          -- Netcraft's clock alone.
          || CASE
               WHEN c.received_at IS NOT NULL
               THEN pg_catalog.jsonb_build_object('received_at', c.received_at::text)
               ELSE '{}'::jsonb
             END
          -- Vendor-dated takedown: first stamp only, never before our submission.
          || CASE
               WHEN c.malicious_at IS NOT NULL
                    AND c.submitted_at IS NOT NULL
                    AND c.malicious_at >= c.submitted_at
                    AND (c.submitted_to -> 'netcraft' ->> 'takedown_at') IS NULL
               THEN pg_catalog.jsonb_build_object(
                      'takedown_at',        c.malicious_at::text,
                      'takedown_at_source', 'netcraft_log'
                    )
                    -- v329: pair the stamp with the receipt of the SAME
                    -- submission, so triage latency never mixes two uuids.
                    || CASE
                         WHEN c.received_at IS NOT NULL
                         THEN pg_catalog.jsonb_build_object('takedown_received_at', c.received_at::text)
                         ELSE '{}'::jsonb
                       END
                    || CASE
                         WHEN c.issue_at IS NOT NULL AND c.malicious_at >= c.issue_at
                         THEN pg_catalog.jsonb_build_object('re_takedown_at', c.malicious_at::text)
                         ELSE '{}'::jsonb
                       END
               ELSE '{}'::jsonb
             END
          -- Already on Netcraft's list before we reported it: not our credit.
          || CASE
               WHEN c.malicious_at IS NOT NULL
                    AND c.submitted_at IS NOT NULL
                    AND c.malicious_at < c.submitted_at
               THEN pg_catalog.jsonb_build_object('already_malicious_at_submit', true)
               ELSE '{}'::jsonb
             END,
        true
      )
      FROM calc c WHERE c.id = sca.id
    ),
    updated_at = pg_catalog.now()
    WHERE sca.id IN (SELECT id FROM calc)
    RETURNING 1
  )
  SELECT COALESCE(count(*), 0)::int FROM upd;
$function$;

REVOKE EXECUTE ON FUNCTION public.record_netcraft_url_verdicts(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_netcraft_url_verdicts(jsonb) TO service_role;

-- ── 3a. Weaponised liveness worklist ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_weaponised_for_liveness(
  p_limit integer DEFAULT 200,
  p_cadence_hours integer DEFAULT 20
)
RETURNS TABLE (id bigint, candidate_domain text, due_total bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s'
AS $function$
  SELECT
    sca.id,
    sca.candidate_domain,
    -- Window count runs BEFORE the LIMIT: a truncated sweep reports how much
    -- it left behind instead of looking complete.
    pg_catalog.count(*) OVER () AS due_total
  FROM public.shopfront_clone_alerts sca
  WHERE sca.lifecycle_state = 'weaponised'
    AND sca.candidate_domain IS NOT NULL
    -- NULL-safe: a never-probed row is admitted by the first disjunct, never
    -- hidden by a NULL comparison in the second.
    AND (
      sca.liveness_checked_at IS NULL
      OR sca.liveness_checked_at
           <= pg_catalog.now() - pg_catalog.make_interval(hours => GREATEST(1, p_cadence_hours))
    )
  ORDER BY sca.liveness_checked_at ASC NULLS FIRST, sca.id ASC
  LIMIT GREATEST(1, LEAST(p_limit, 500));
$function$;

REVOKE ALL ON FUNCTION public.list_weaponised_for_liveness(integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_weaponised_for_liveness(integer, integer)
  TO service_role;

COMMENT ON FUNCTION public.list_weaponised_for_liveness(integer, integer) IS
  'v329. Weaponised alerts due a DNS liveness read (never read, or last read >= p_cadence_hours ago), stalest first; due_total counts every due row before the LIMIT. No age cap — the whole weaponised set rotates.';

-- ── 3b. Weaponised liveness recorder ───────────────────────────────────────
-- p_results: [{ "id": 123, "gone": true | false | null }]
--   gone=false → the name exists: stamp, clear offline_since
--   gone=null  → the resolver proved nothing: stamp only (never resets or confirms)
--   gone=true  → first NXDOMAIN: offline_since = now()
--                NXDOMAIN again >= p_confirm_hours after the first: → dormant
-- Only rows still `weaponised` are touched (a concurrent Netcraft takedown wins).
CREATE OR REPLACE FUNCTION public.record_weaponised_liveness(
  p_results jsonb,
  p_confirm_hours integer DEFAULT 12
)
RETURNS TABLE (
  checked integer,
  present integer,
  gone_unconfirmed integer,
  offline_confirmed integer,
  inconclusive integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s'
AS $function$
  WITH r AS (
    SELECT DISTINCT ON ((e ->> 'id')::bigint)
      (e ->> 'id')::bigint AS id,
      CASE WHEN pg_catalog.jsonb_typeof(e -> 'gone') = 'boolean'
           THEN (e ->> 'gone')::boolean END AS gone
    FROM pg_catalog.jsonb_array_elements(COALESCE(p_results, '[]'::jsonb)) e
    WHERE (e ->> 'id') IS NOT NULL
  ),
  calc AS (
    SELECT
      sca.id,
      CASE
        WHEN r.gone IS NULL THEN 'inconclusive'
        WHEN r.gone = false THEN 'present'
        WHEN sca.offline_since IS NULL THEN 'gone_first'
        WHEN sca.offline_since
             <= pg_catalog.now() - pg_catalog.make_interval(hours => GREATEST(1, p_confirm_hours))
        THEN 'offline_confirmed'
        -- A second NXDOMAIN too soon after the first (e.g. a retried step):
        -- keep waiting; the first observation stands.
        ELSE 'gone_pending'
      END AS outcome
    FROM public.shopfront_clone_alerts sca
    JOIN r ON r.id = sca.id
    WHERE sca.lifecycle_state = 'weaponised'
  ),
  upd AS (
    UPDATE public.shopfront_clone_alerts sca
    SET
      liveness_checked_at = pg_catalog.now(),
      offline_since = CASE c.outcome
        WHEN 'present'    THEN NULL
        WHEN 'gone_first' THEN pg_catalog.now()
        ELSE sca.offline_since
      END,
      lifecycle_state = CASE WHEN c.outcome = 'offline_confirmed'
                             THEN 'dormant' ELSE sca.lifecycle_state END,
      -- v288 clone_alert_terminal_state_sync: dormant requires expired.
      alert_state = CASE WHEN c.outcome = 'offline_confirmed'
                         THEN 'expired' ELSE sca.alert_state END,
      updated_at = CASE WHEN c.outcome = 'offline_confirmed'
                        THEN pg_catalog.now() ELSE sca.updated_at END
    FROM calc c
    WHERE sca.id = c.id
      AND sca.lifecycle_state = 'weaponised'
    RETURNING c.outcome
  )
  SELECT
    count(*)::int,
    (count(*) FILTER (WHERE outcome = 'present'))::int,
    (count(*) FILTER (WHERE outcome IN ('gone_first', 'gone_pending')))::int,
    (count(*) FILTER (WHERE outcome = 'offline_confirmed'))::int,
    (count(*) FILTER (WHERE outcome = 'inconclusive'))::int
  FROM upd;
$function$;

REVOKE ALL ON FUNCTION public.record_weaponised_liveness(jsonb, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_weaponised_liveness(jsonb, integer)
  TO service_role;

COMMENT ON FUNCTION public.record_weaponised_liveness(jsonb, integer) IS
  'v329. Applies DNS liveness reads to WEAPONISED alerts: name present clears offline_since; first NXDOMAIN sets it; a second NXDOMAIN >= p_confirm_hours later moves weaponised → dormant (alert_state expired). A null (inconclusive) read only stamps liveness_checked_at. Only NXDOMAIN counts as gone (liveness.ts isDomainGone).';

-- ── 4. No-threat-on-phishing escalation ────────────────────────────────────
-- Two functions, not one, so the page goes out BEFORE the stamp: list → page
-- → mark. A failed page leaves nothing stamped and the next attempt re-lists
-- the same rows (at-least-once). One list-and-stamp call would have made a
-- lost Telegram message a lost escalation.
--
-- The predicate lives in ONE place (netcraft_vendor_gap_basis) and both
-- functions call it, so "what counts as escalatable" cannot drift between the
-- read and the write.
CREATE OR REPLACE FUNCTION public.netcraft_vendor_gap_basis(
  p_submitted_to jsonb,
  p_min_issue_age_hours integer DEFAULT 72
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN p_submitted_to IS NULL
      OR NOT COALESCE(p_submitted_to -> 'netcraft' ->> 'url_state' IN ('no threats', 'unavailable'), false)
      THEN NULL
    -- Netcraft said so explicitly.
    WHEN COALESCE(p_submitted_to -> 'netcraft' ->> 'url_state_reason', '')
           ILIKE 'already reported and rejected%'
      THEN 'rejected'
    -- We escalated THIS submission, waited, and a verdict read after the wait
    -- still says no. A NULL stamp makes a comparison NULL, which COALESCE
    -- turns into "not escalatable" — it can never satisfy the branch.
    WHEN COALESCE(
           (p_submitted_to -> 'netcraft_issue' ->> 'issue_reported_at')::timestamptz
             >= (p_submitted_to -> 'netcraft' ->> 'submitted_at')::timestamptz
           AND (p_submitted_to -> 'netcraft_issue' ->> 'issue_reported_at')::timestamptz
             <= pg_catalog.now() - pg_catalog.make_interval(hours => GREATEST(1, p_min_issue_age_hours))
           AND (p_submitted_to -> 'netcraft' ->> 'url_state_at')::timestamptz
             >= (p_submitted_to -> 'netcraft_issue' ->> 'issue_reported_at')::timestamptz
                + pg_catalog.make_interval(hours => GREATEST(1, p_min_issue_age_hours)),
           false)
      THEN 'issue_unanswered'
    ELSE NULL
  END;
$function$;

-- SECURITY INVOKER and side-effect free; still revoked so it is not a new
-- PostgREST surface.
REVOKE ALL ON FUNCTION public.netcraft_vendor_gap_basis(jsonb, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.netcraft_vendor_gap_basis(jsonb, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.list_netcraft_vendor_gap(
  p_min_issue_age_hours integer DEFAULT 72,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  id bigint,
  candidate_domain text,
  brand text,
  url_state text,
  basis text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s'
AS $function$
  SELECT
    sca.id,
    sca.candidate_domain,
    COALESCE(sca.target_brand_normalized, sca.inferred_target_domain),
    sca.submitted_to -> 'netcraft' ->> 'url_state',
    public.netcraft_vendor_gap_basis(sca.submitted_to, p_min_issue_age_hours)
  FROM public.shopfront_clone_alerts sca
  WHERE sca.lifecycle_state = 'weaponised'
    AND COALESCE(sca.triage_status, '') <> 'fp'
    -- A site we just saw vanish is the liveness sweep's, not the operator's.
    AND sca.offline_since IS NULL
    AND NOT COALESCE(sca.submitted_to ? 'vendor_gap', false)
    AND public.netcraft_vendor_gap_basis(sca.submitted_to, p_min_issue_age_hours) IS NOT NULL
  -- Freshest phishing first: the most actionable for a human.
  ORDER BY sca.weaponised_at DESC NULLS LAST, sca.id
  LIMIT GREATEST(1, LEAST(p_limit, 200));
$function$;

REVOKE ALL ON FUNCTION public.list_netcraft_vendor_gap(integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_netcraft_vendor_gap(integer, integer)
  TO service_role;

COMMENT ON FUNCTION public.list_netcraft_vendor_gap(integer, integer) IS
  'v329. Weaponised alerts Netcraft still grades no threats / unavailable after its own escalation path is exhausted (netcraft_vendor_gap_basis: an explicit "Already reported and rejected.", or an issue on the current submission >= p_min_issue_age_hours old with a verdict read after that wait), not yet escalated, not seen gone by the liveness sweep. Read-only; mark_netcraft_vendor_gap_escalated stamps after the operator page is sent.';

-- Stamps submitted_to.vendor_gap once per alert. Re-checks the predicate at
-- write time, so an id whose state moved between list and mark is skipped.
CREATE OR REPLACE FUNCTION public.mark_netcraft_vendor_gap_escalated(
  p_alert_ids bigint[],
  p_min_issue_age_hours integer DEFAULT 72
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s'
AS $function$
  WITH upd AS (
    UPDATE public.shopfront_clone_alerts sca
    SET submitted_to = pg_catalog.jsonb_set(
          sca.submitted_to,
          '{vendor_gap}',
          pg_catalog.jsonb_build_object(
            'escalated_at',  pg_catalog.now()::text,
            'escalated_to',  'operator',
            'basis',         public.netcraft_vendor_gap_basis(sca.submitted_to, p_min_issue_age_hours),
            'url_state',     sca.submitted_to -> 'netcraft' ->> 'url_state',
            'netcraft_uuid', sca.submitted_to -> 'netcraft' ->> 'uuid'
          ),
          true
        ),
        updated_at = pg_catalog.now()
    WHERE sca.id = ANY(COALESCE(p_alert_ids, '{}'::bigint[]))
      AND sca.lifecycle_state = 'weaponised'
      AND NOT COALESCE(sca.submitted_to ? 'vendor_gap', false)
      AND public.netcraft_vendor_gap_basis(sca.submitted_to, p_min_issue_age_hours) IS NOT NULL
    RETURNING 1
  )
  SELECT COALESCE(count(*), 0)::int FROM upd;
$function$;

REVOKE ALL ON FUNCTION public.mark_netcraft_vendor_gap_escalated(bigint[], integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_netcraft_vendor_gap_escalated(bigint[], integer)
  TO service_role;

COMMENT ON FUNCTION public.mark_netcraft_vendor_gap_escalated(bigint[], integer) IS
  'v329. Stamps submitted_to.vendor_gap {escalated_at, escalated_to=operator, basis, url_state, netcraft_uuid} ONCE per alert, re-checking netcraft_vendor_gap_basis at write time. Called by the reconcile lane only after the operator page was delivered.';

-- ── 1b. clone_watch_takedown_stats — one clock per duration ────────────────
-- Return type changes (new columns; latency columns NULL on an empty sample),
-- so DROP + CREATE. Callers (public /clone-watch, /admin/clone-watch, weekly
-- digest) read it through apps/web/lib/clone-watch/takedown-stats.ts, which
-- accepts both the v145 and the v329 shape.
DROP FUNCTION IF EXISTS public.clone_watch_takedown_stats(integer);

CREATE FUNCTION public.clone_watch_takedown_stats(p_days integer DEFAULT 30)
RETURNS TABLE (
  window_days integer,
  -- Netcraft classified it malicious, dated inside the window.
  takedowns_total bigint,
  -- Netcraft triage latency: its receipt → its malicious classification.
  median_minutes integer,
  p90_minutes integer,
  fastest_minutes integer,
  slowest_minutes integer,
  computed_at timestamptz,
  timed_n bigint,
  -- Our witness of live phishing (weaponised_at) → Netcraft's classification.
  detect_to_block_n bigint,
  detect_to_block_median_minutes integer,
  detect_to_block_p90_minutes integer,
  blocked_before_detection bigint,
  already_blocklisted_at_submit bigint,
  -- The weaponised cohort (weaponised_at inside the window), by where it is now.
  weaponised_n bigint,
  weaponised_blocklisted bigint,
  weaponised_offline bigint,
  weaponised_open bigint,
  weaponised_vendor_gap bigint,
  weaponised_escalated bigint,
  detect_to_offline_median_minutes integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s'
AS $function$
  WITH w AS (
    SELECT GREATEST(1, LEAST(p_days, 365)) AS days,
           pg_catalog.now() - (GREATEST(1, LEAST(p_days, 365)) * interval '1 day') AS since
  ),
  blk AS (
    SELECT
      (sca.submitted_to -> 'netcraft' ->> 'takedown_at')::timestamptz          AS takedown_at,
      (sca.submitted_to -> 'netcraft' ->> 'takedown_received_at')::timestamptz AS received_at,
      sca.submitted_to -> 'netcraft' ->> 'takedown_at_source'                 AS src,
      sca.weaponised_at
    FROM public.shopfront_clone_alerts sca, w
    WHERE sca.source = 'nrd'
      AND (sca.submitted_to -> 'netcraft' ->> 'takedown_at') IS NOT NULL
      AND (sca.submitted_to -> 'netcraft' ->> 'takedown_at')::timestamptz >= w.since
  ),
  -- Both ends Netcraft's. >= guards a receipt later than the log date, which
  -- would only mean the two came from different submissions.
  triage AS (
    SELECT EXTRACT(EPOCH FROM (takedown_at - received_at)) / 60.0 AS m
    FROM blk
    WHERE src = 'netcraft_log' AND received_at IS NOT NULL AND takedown_at >= received_at
  ),
  -- Only vendor-dated stamps: a v219 witnessed stamp is our first LOOK, up to
  -- a reconcile cadence late, and would inflate the duration.
  detect AS (
    SELECT EXTRACT(EPOCH FROM (takedown_at - weaponised_at)) / 60.0 AS m,
           takedown_at >= weaponised_at AS after_detection
    FROM blk
    WHERE src = 'netcraft_log' AND weaponised_at IS NOT NULL
  ),
  cohort AS (
    SELECT sca.*
    FROM public.shopfront_clone_alerts sca, w
    WHERE sca.source = 'nrd' AND sca.weaponised_at >= w.since
  )
  SELECT
    (SELECT days FROM w)::int,
    (SELECT count(*) FROM blk),
    (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY m))::int FROM triage),
    (SELECT round(percentile_cont(0.9) WITHIN GROUP (ORDER BY m))::int FROM triage),
    (SELECT round(min(m))::int FROM triage),
    (SELECT round(max(m))::int FROM triage),
    pg_catalog.now(),
    (SELECT count(*) FROM triage),
    (SELECT count(*) FROM detect WHERE after_detection),
    (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY m))::int FROM detect WHERE after_detection),
    (SELECT round(percentile_cont(0.9) WITHIN GROUP (ORDER BY m))::int FROM detect WHERE after_detection),
    (SELECT count(*) FROM detect WHERE NOT after_detection),
    (SELECT count(*)
       FROM public.shopfront_clone_alerts sca, w
      WHERE sca.source = 'nrd'
        AND COALESCE((sca.submitted_to -> 'netcraft' ->> 'already_malicious_at_submit')::boolean, false)
        AND (sca.submitted_to -> 'netcraft' ->> 'submitted_at')::timestamptz >= w.since),
    (SELECT count(*) FROM cohort),
    (SELECT count(*) FROM cohort WHERE lifecycle_state = 'taken_down'),
    (SELECT count(*) FROM cohort WHERE lifecycle_state = 'dormant' AND offline_since IS NOT NULL),
    (SELECT count(*) FROM cohort WHERE lifecycle_state = 'weaponised'),
    (SELECT count(*) FROM cohort
      WHERE lifecycle_state = 'weaponised'
        AND submitted_to -> 'netcraft' ->> 'url_state' IN ('no threats', 'unavailable')),
    (SELECT count(*) FROM cohort
      WHERE lifecycle_state = 'weaponised' AND COALESCE(submitted_to ? 'vendor_gap', false)),
    (SELECT round(percentile_cont(0.5) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM (offline_since - weaponised_at)) / 60.0))::int
       FROM cohort
      WHERE lifecycle_state = 'dormant' AND offline_since IS NOT NULL
        AND offline_since >= weaponised_at);
$function$;

REVOKE ALL ON FUNCTION public.clone_watch_takedown_stats(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clone_watch_takedown_stats(integer) TO service_role;

COMMENT ON FUNCTION public.clone_watch_takedown_stats(integer) IS
  'v329. Aggregate-only takedown/outcome stats. takedowns_total = Netcraft malicious classifications dated in the window. median/p90/fastest/slowest_minutes = Netcraft triage latency with BOTH ends on Netcraft''s clock (takedown_received_at → takedown_at), sample timed_n, NULL when empty. detect_to_block_* = weaponised_at → vendor-dated takedown_at; rows Netcraft blocked before we saw phishing are counted in blocked_before_detection, never averaged. weaponised_* = the cohort weaponised in the window by current outcome (blocklisted = lifecycle taken_down; offline = dormant with offline_since; open; open with a no-threat/unavailable verdict; escalated). Read via apps/web/lib/clone-watch/takedown-stats.ts.';

COMMIT;
