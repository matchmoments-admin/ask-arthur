-- v318 — clone takedowns report through the onward routing brain
--        (PR 6 of docs/plans/clone-watch-deepening-2026-09-23.md;
--         ADR-0018 amendment 2026-09-23)
--
-- WHY: clone enforcement kept a SECOND reporting ledger. The auto blocklist send
-- (clone-watch-enforcement-execute) redeclared the APWG/OpenPhish intake
-- addresses, sent through its own loop and recorded the send only in
-- shopfront_takedown_attempts + cost_telemetry. Consequences:
--   * no per-URL dedup across the two ledgers — a URL flagged by clone-watch
--     AND by a HIGH_RISK scam report went to the same blocklist twice, which is
--     the ADR-0018 F9 amplification risk that blocks FF_ONWARD_AUTO_REPORT;
--   * /admin/onward-reports never showed a clone send;
--   * report-brand-stewardship counted only onward_report_log, so clone sends
--     were missing from the brand's "reported" total.
-- After this migration a clone send is an onward_report_log row
-- (source='clone_alert'), produced by enforcement-execute and SENT by the same
-- report.onward.<destination> workers as every other onward report.
--
-- Prod state measured 2026-09-23 (read-only): onward_report_log 0 rows,
-- shopfront_takedown_attempts 0 rows, FF_CLONE_ENFORCEMENT off. Nothing to
-- backfill; every statement below is additive or a CREATE OR REPLACE, except
-- the DROP FUNCTION in §7 (see there).
--
-- APPLY NOTES
--   §1 (ALTER TYPE … ADD VALUE) is safe inside a transaction on Postgres ≥ 12
--   PROVIDED the new label is not USED in the same transaction. Nothing in
--   this file uses 'netcraft' as a literal (the enqueue RPC casts caller text
--   at call time), so the whole file can run as one batch. If a runner
--   complains, run §1 alone first, then the rest.
--
-- Idempotent: re-running is a no-op.

-- ── §1. netcraft becomes an onward destination ───────────────────────────
-- Netcraft is the clone lane's main takedown vendor but was never an onward
-- destination, so its submissions cannot appear in the one ledger. This adds
-- the label only; the Netcraft submit lane becomes a producer in a follow-up
-- (it is being reshaped by PR 3 of the same plan).
ALTER TYPE public.onward_destination ADD VALUE IF NOT EXISTS 'netcraft';

-- ── §2. source + clone subject + per-URL key ─────────────────────────────
ALTER TABLE public.onward_report_log
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'scam_report';
ALTER TABLE public.onward_report_log
  ADD COLUMN IF NOT EXISTS clone_alert_id bigint
    REFERENCES public.shopfront_clone_alerts(id) ON DELETE SET NULL;
ALTER TABLE public.onward_report_log
  ADD COLUMN IF NOT EXISTS url_key text;

ALTER TABLE public.onward_report_log
  DROP CONSTRAINT IF EXISTS onward_report_log_source_check;
ALTER TABLE public.onward_report_log
  ADD CONSTRAINT onward_report_log_source_check
  CHECK (source IN ('scam_report', 'clone_alert'));

-- Every row names what it reports. Keyed on `source` rather than "scam_report_id
-- OR clone_alert_id" because clone_alert_id is ON DELETE SET NULL: the v152
-- purge_old_fp_clone_alerts sweep deletes FP alerts after 90 days, and a row
-- recording that we REPORTED a later-FP URL is exactly the evidence the
-- ADR-0018 reversal trigger needs — it must survive, and a "one of the two
-- ids" CHECK would instead abort the purge chunk. A clone row keeps url_key
-- (NOT NULL here) so it still says what was reported once its alert is gone.
-- The producer (enqueue_onward_url_reports, §4) requires clone_alert_id at insert.
ALTER TABLE public.onward_report_log
  DROP CONSTRAINT IF EXISTS onward_report_log_subject_check;
ALTER TABLE public.onward_report_log
  ADD CONSTRAINT onward_report_log_subject_check
  CHECK (
    (source = 'scam_report' AND scam_report_id IS NOT NULL AND clone_alert_id IS NULL)
    OR (source = 'clone_alert' AND scam_report_id IS NULL AND url_key IS NOT NULL)
  );

-- Cross-source per-URL dedup (ADR-0018 F9): one row per (destination,
-- destination_key, url_key). Deliberately NOT partial — NULLs are distinct
-- under the default NULLS DISTINCT, so rows without a url_key (every
-- non-URL destination, user-initiated rows) never collide, and a full index
-- stays inferable by ON CONFLICT. The v119 (scam_report_id, destination,
-- destination_key) dedup is kept: it still guards the user-click path.
CREATE UNIQUE INDEX IF NOT EXISTS onward_report_log_url_dedup_idx
  ON public.onward_report_log (destination, destination_key, url_key);

-- FK index (ON DELETE SET NULL scans by it) + the admin/stewardship join.
CREATE INDEX IF NOT EXISTS onward_report_log_clone_alert_idx
  ON public.onward_report_log (clone_alert_id)
  WHERE clone_alert_id IS NOT NULL;

COMMENT ON COLUMN public.onward_report_log.source IS
  'What produced the row: scam_report (v119 user-click / bot / auto-report producers) or clone_alert (v318 clone-watch-enforcement-execute). One ledger for both — ADR-0018 amendment 2026-09-23.';
COMMENT ON COLUMN public.onward_report_log.clone_alert_id IS
  'The shopfront_clone_alerts row reported (source=clone_alert). ON DELETE SET NULL so the proof of a send outlives the FP purge; url_key still names the URL.';
COMMENT ON COLUMN public.onward_report_log.url_key IS
  'public.onward_url_key(<reported URL>) — the per-URL dedup key across sources. Written only by enqueue_onward_url_reports; NULL for non-URL destinations and user-click rows.';

-- ── §3. the ONE URL canonicaliser ────────────────────────────────────────
-- Both the enqueue RPC and the clone worklist gate compute the key here, so the
-- worklist's exclusion predicate and the insert's conflict predicate cannot
-- drift apart (the v224 worklist-gate lesson). Lower-cased, scheme dropped,
-- query + fragment dropped (they can carry victim PII and are never part of
-- what a blocklist actions), trailing slashes dropped. Over-merging two URLs
-- that differ only in path case is the safe direction for a dedup key.
CREATE OR REPLACE FUNCTION public.onward_url_key(p_url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT NULLIF(
    pg_catalog.regexp_replace(
      pg_catalog.regexp_replace(
        pg_catalog.lower(
          pg_catalog.split_part(pg_catalog.split_part(pg_catalog.btrim(p_url), '#', 1), '?', 1)
        ),
        '^[a-z][a-z0-9+.-]*://', ''
      ),
      '/+$', ''
    ),
    ''
  );
$$;

REVOKE EXECUTE ON FUNCTION public.onward_url_key(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.onward_url_key(text) TO service_role;

-- ── §4. the ONE enqueue path for URL-blocklist rows ──────────────────────
-- Inserts queued rows for both producers (report-onward-auto-report,
-- shopfront-clone-enforcement-execute) and returns ONLY the rows it inserted,
-- so the caller fires exactly one report.onward.<destination> event per new
-- row. ON CONFLICT DO NOTHING without a target absorbs a conflict on EITHER
-- unique index — a PostgREST upsert names one conflict target and would abort
-- the whole batch on a url_key collision. Duplicates inside one batch are
-- absorbed the same way.
--
-- p_rows: jsonb array of
--   { source, scam_report_id?, clone_alert_id?, destination, destination_key, url }
CREATE OR REPLACE FUNCTION public.enqueue_onward_url_reports(p_rows jsonb)
RETURNS TABLE (
  id uuid,
  source text,
  scam_report_id bigint,
  clone_alert_id bigint,
  destination text,
  destination_key text,
  url_key text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
  IF p_rows IS NULL OR pg_catalog.jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'enqueue_onward_url_reports: p_rows must be a jsonb array'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_to_recordset(p_rows)
      AS r(source text, scam_report_id bigint, clone_alert_id bigint, url text)
    WHERE public.onward_url_key(r.url) IS NULL
       OR (r.source = 'clone_alert' AND r.clone_alert_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'enqueue_onward_url_reports: every row needs a url, and a clone_alert row needs clone_alert_id'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  INSERT INTO public.onward_report_log AS l (
    source, scam_report_id, clone_alert_id, destination, destination_key,
    url_key, status, provider
  )
  SELECT
    r.source,
    r.scam_report_id,
    r.clone_alert_id,
    r.destination::public.onward_destination,
    r.destination_key,
    public.onward_url_key(r.url),
    'queued'::public.onward_status,
    'inngest'
  FROM pg_catalog.jsonb_to_recordset(p_rows) AS r(
    source text, scam_report_id bigint, clone_alert_id bigint,
    destination text, destination_key text, url text
  )
  ON CONFLICT DO NOTHING
  RETURNING l.id, l.source, l.scam_report_id, l.clone_alert_id,
            l.destination::text, l.destination_key, l.url_key;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enqueue_onward_url_reports(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_onward_url_reports(jsonb) TO service_role;

-- ── §5. the clone producer's worklist ────────────────────────────────────
-- Weaponised lookalikes (our scanner confirmed live phishing) that still lack a
-- row for at least one requested destination. The exclusion matches the
-- insert's conflict predicate — the same alert OR the same url_key under that
-- destination — so an alert whose URL was already reported from a scam report
-- is excluded here instead of re-presenting at the head of the list forever
-- while the insert silently no-ops (docs: worklist-gate starvation rule).
-- p_max_age_days bounds it to recent weaponisations: the old per-case path only
-- acted on alerts that weaponised while FF_CLONE_ENFORCEMENT was on, and this
-- keeps flag-flip day from reporting a three-month backlog (139 weaponised,
-- 15 in the last 14 days on 2026-09-23). Freshest first.
CREATE OR REPLACE FUNCTION public.list_clone_alerts_pending_onward(
  p_destinations text[],
  p_limit integer DEFAULT 25,
  p_max_age_days integer DEFAULT 14
)
RETURNS TABLE (
  clone_alert_id bigint,
  candidate_url text,
  candidate_domain text,
  target_brand_normalized text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT a.id, a.candidate_url, a.candidate_domain, a.target_brand_normalized
  FROM public.shopfront_clone_alerts a
  WHERE a.lifecycle_state = 'weaponised'
    AND a.weaponised_at >= pg_catalog.now()
        - pg_catalog.make_interval(days => GREATEST(1, p_max_age_days))
    AND public.onward_url_key(a.candidate_url) IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.unnest(p_destinations) AS d(dest)
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.onward_report_log l
        WHERE l.destination::text = d.dest
          AND (l.clone_alert_id = a.id
               OR l.url_key = public.onward_url_key(a.candidate_url))
      )
    )
  ORDER BY a.weaponised_at DESC, a.id DESC
  LIMIT GREATEST(1, LEAST(p_limit, 100));
$$;

REVOKE EXECUTE ON FUNCTION public.list_clone_alerts_pending_onward(text[], integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_clone_alerts_pending_onward(text[], integer, integer)
  TO service_role;

-- ── §6. the shared daily cap counts the new enqueue event ────────────────
-- enforcement-execute no longer sends; it ENQUEUES, and the onward worker
-- sends minutes later. It records 'enforcement.queued' (not 'reported') per
-- enqueued row, so the cap still counts every commitment at decision time
-- while 'reported' keeps meaning a send actually went out (the human admin
-- path). Body otherwise unchanged from v205.
CREATE OR REPLACE FUNCTION public.count_todays_takedown_submissions()
RETURNS int
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
  SELECT COALESCE(sum(units), 0)::int
  FROM public.cost_telemetry
  WHERE created_at >= date_trunc('day', now())
    AND (
      (feature = 'clone_enforcement'
         AND operation IN ('enforcement.reported', 'enforcement.queued'))
      OR (feature = 'shopfront_clone_submit_netcraft')
    );
$$;

REVOKE EXECUTE ON FUNCTION public.count_todays_takedown_submissions()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_todays_takedown_submissions()
  TO service_role;

-- ── §7. retire the auto-case worklist ────────────────────────────────────
-- DESTRUCTIVE (a function, not data). Justification: ADR-0018 amendment
-- 2026-09-23 — auto channels (APWG/OpenPhish) no longer open cases in
-- shopfront_takedown_attempts; §5 replaces this worklist and its only caller
-- (enforcement-execute) is rewritten in the same PR.
-- Reverse path: re-apply supabase/migration-v205-enforcement-pending-send.sql
-- (CREATE OR REPLACE, idempotent).
DROP FUNCTION IF EXISTS public.list_enforcement_cases_pending_send(int);

-- ── §8. shopfront_takedown_attempts: case workflow, not a send ledger ────
-- Kept (not dropped): it is still the HUMAN-GATED case workflow — GSB /
-- SmartScreen deep-links and registrar / hosting abuse with four-eyes approval
-- (/admin/clone-watch enforcement tab). What changes is that it no longer
-- records auto blocklist sends. 0 rows on 2026-09-23.
COMMENT ON TABLE public.shopfront_takedown_attempts IS
  'Human-gated enforcement CASE workflow (v201): one case per (clone_alert, channel) for GSB/SmartScreen deep-links and registrar/hosting abuse (four-eyes). DEPRECATED as a send ledger (v318, ADR-0018 amendment 2026-09-23): auto APWG/OpenPhish sends are onward_report_log rows with source=clone_alert and open no case here. The admin registrar/hosting send still records its send here — moving that to onward_report_log is a tracked follow-up.';
