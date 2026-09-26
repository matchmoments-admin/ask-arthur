-- v334 — change-triggered rechecks: a free DNS fingerprint gates the urlscan
-- rescan (#1229 part 2a)
--
-- WHY. The recheck lane (clone-watch-lifecycle-recheck.ts) urlscan-rescans
-- monitoring/declined NRD lookalikes to catch the declined -> weaponised flip.
-- At its designed cadence (6 h; 24 h past 45 days; 168 h dead / 8+ rechecks /
-- audit samples) the pool asks for ~3,800 rescans a day. urlscan's unlisted
-- quota is 60/min, 100/h, 1,000/day, and the lane spends 90 per run x 4 runs.
-- Measured 2026-09-26: 90 rechecked / 78–81 submitted per run, due_total
-- 1,354–1,441, pool 2,072. A bigger cap cannot close a 4x gap.
--
-- Most rows have not changed between rechecks. The lane now reads a DNS
-- fingerprint (A [+ AAAA when no A] reduced to /24 and /48, + NS, each sorted
-- — liveness.ts probeStockDns, no paid call; compared by NS equality and
-- address-prefix overlap, recheck-dns-gate.ts, because parking and anycast
-- pools rotate addresses on every query) for a large slice of the due pool, and urlscans
-- only rows whose fingerprint CHANGED since their last urlscan rescan, whose
-- DNS read was inconclusive (SERVFAIL / timeout — the gate fails toward
-- scanning), that have no baseline yet, or that are FLOOR-due (a mandatory
-- rescan every 7 days under 14 days old, every 30 days after). An unchanged,
-- not-floor-due row gets a cheap stamp that moves it back in the queue and no
-- urlscan call. Weaponisation detection stays urlscan-only.
--
-- WHAT.
--
--   1. Two nullable columns on shopfront_clone_alerts (metadata-only ALTER,
--      no rewrite, no default):
--        recheck_dns_fingerprint  text        — the fingerprint observed when
--                                               the row was last urlscan-
--                                               RESCANNED (the baseline).
--        recheck_dns_checked_at   timestamptz — the last DNS read by the lane.
--      last_rechecked_at KEEPS its meaning ("last urlscan recheck attempt"):
--      recheck_count, the v317 weekly tier and the floor all key on it, and
--      list_clone_alerts_pending_urlscan_submit / advance_clone_lifecycle
--      read it too. A DNS read never touches it.
--
--   2. list_clone_alerts_for_recheck — re-created from the LIVE v330 body
--      (pg_get_functiondef, 2026-09-26), every branch kept: v326 dead
--      dormancy + 45-day taper, v317 recheck_count >= 8 weekly, v330 audit
--      sample weekly clock, v328 due_total. Changes:
--        * the queue clock is GREATEST(<v330 clock>, recheck_dns_checked_at)
--          — a DNS-unchanged stamp moves the row back exactly like a rescan
--          did. GREATEST ignores NULLs; both NULL stays NULL = never checked =
--          due, first (NULL-comparison trap: never compare the raw columns).
--        * LIMIT clamp 500 -> 1000 (the lane fetches 1,000 and DNS-reads 600).
--        * four more OUT columns: first_seen_at (the floor's age split),
--          recheck_dns_fingerprint, recheck_dns_checked_at, queue_clock_at.
--      Parameters are unchanged, but OUT columns changed, so this is DROP +
--      CREATE in one transaction. Callers still on the old code keep working:
--      they pass the same arguments and ignore the extra columns, and nothing
--      they write moves recheck_dns_checked_at, so their queue is the v330 one.
--
--   3. record_clone_recheck_dns(p_unchanged_ids bigint[], p_scanned jsonb) —
--      the lane's DNS bookkeeping, ONE call per run:
--        * p_unchanged_ids: DNS unchanged, not floor-due, NOT urlscanned —
--          recheck_dns_checked_at = now(). Nothing else: no recheck_count bump
--          (that counts urlscan rechecks), no updated_at, no lifecycle.
--        * p_scanned: [{"id": 1, "fp": "v1|a=...|..." | null}] for every row
--          the urlscan batch attempted — the baseline becomes what DNS said
--          at this rescan, and recheck_dns_checked_at = now(). A null fp (DNS
--          inconclusive) KEEPS the previous baseline (COALESCE): the rescan
--          still happened, and discarding a good baseline would only force an
--          extra rescan next time.
--      Caps its input (1,000 ids / 500 rows) so a caller bug cannot become an
--      unbounded write. Rows the budget or the cap left out are deliberately
--      NOT passed: they stay due and lead the next run (a changed row keeps
--      reading "changed" until it is scanned — its baseline only moves then).
--
-- Worklist-gate starvation rule: the one caller-applied gate is "DNS
-- unchanged", and every row it rejects is stamped here — it cannot re-present
-- at the head forever. Rows the gate PASSES but the 90 cap leaves out stay
-- unstamped on purpose; each run scans 90 of them, so the set drains.
--
-- Function-level statement_timeout on both (an in-body SET LOCAL is
-- decorative under PostgREST — supabase/CLAUDE.md §4). Grants per v324 /
-- supabase/CLAUDE.md §7: REVOKE from PUBLIC, anon, authenticated; EXECUTE to
-- service_role only.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, DROP FUNCTION IF EXISTS + CREATE,
-- CREATE OR REPLACE. Re-running is a no-op.
--
-- Rollback: re-apply the list_clone_alerts_for_recheck section of v330 (DROP
-- this one first — the OUT columns differ), DROP FUNCTION
-- record_clone_recheck_dns(bigint[], jsonb), and revert the lane. The two
-- columns can stay (nothing else reads them); dropping them needs an ADR per
-- supabase/CLAUDE.md §3 and loses only the DNS baselines.
--
-- Deploy order: APPLY THIS BEFORE MERGING the code. New code against the old
-- schema gets no fingerprint columns (every row reads "no baseline" and is
-- scanned — today's behaviour) and PGRST202 from record_clone_recheck_dns,
-- which the lane records as a lane error and throws for the step's retry.

BEGIN;

ALTER TABLE public.shopfront_clone_alerts
  ADD COLUMN IF NOT EXISTS recheck_dns_fingerprint text,
  ADD COLUMN IF NOT EXISTS recheck_dns_checked_at timestamptz;

COMMENT ON COLUMN public.shopfront_clone_alerts.recheck_dns_fingerprint IS
  'v334: DNS fingerprint (A [+AAAA when no A] as /24 and /48 prefixes, + NS; sorted; compared structurally in recheck-dns-gate.ts) observed at the last recheck urlscan rescan — the baseline the recheck lane compares against. NULL = no baseline yet.';
COMMENT ON COLUMN public.shopfront_clone_alerts.recheck_dns_checked_at IS
  'v334: last DNS read by the recheck lane. Part of the recheck queue clock (GREATEST with last_rechecked_at); last_rechecked_at stays the urlscan-recheck clock.';

DROP FUNCTION IF EXISTS public.list_clone_alerts_for_recheck(integer, integer, integer);

CREATE FUNCTION public.list_clone_alerts_for_recheck(p_limit integer DEFAULT 50, p_cadence_hours integer DEFAULT 6, p_dead_cadence_hours integer DEFAULT 168)
 RETURNS TABLE(id bigint, candidate_domain text, candidate_url text, lifecycle_state text, urlscan_classification text, recheck_count integer, last_rechecked_at timestamp with time zone, signals jsonb, attribution jsonb, clf_is_clone boolean, clf_confidence real, clf_attack_intent text, clf_clone_tactic text, brand_category text, due_total bigint, first_seen_at timestamp with time zone, recheck_dns_fingerprint text, recheck_dns_checked_at timestamp with time zone, queue_clock_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '30s'
AS $function$
  SELECT
    sca.id, sca.candidate_domain, sca.candidate_url, sca.lifecycle_state,
    sca.urlscan_classification, sca.recheck_count, sca.last_rechecked_at,
    sca.signals, sca.attribution, cwc.is_clone, cwc.confidence,
    cwc.attack_intent, cwc.clone_tactic, kb.brand_category,
    -- v328: rows due in total, computed over the filtered set BEFORE the
    -- LIMIT — the backlog the batch cap leaves, on every returned row.
    pg_catalog.count(*) OVER () AS due_total,
    -- v334: the DNS gate's inputs.
    sca.first_seen_at, sca.recheck_dns_fingerprint, sca.recheck_dns_checked_at,
    clk.at AS queue_clock_at
  FROM public.shopfront_clone_alerts sca
  LEFT JOIN public.clone_watch_classifications cwc ON cwc.alert_id = sca.id
  LEFT JOIN LATERAL (
    SELECT kb2.brand_category FROM public.known_brands kb2
    WHERE kb2.brand_domain = sca.inferred_target_domain LIMIT 1
  ) kb ON true
  -- v330: is this a not-a-clone audit sample still judged is_clone=false?
  LEFT JOIN LATERAL (
    -- Same fail-closed rule as apply_clone_urlscan_verdict: a sample stays an
    -- audit row until it is explicitly re-judged is_clone=true.
    SELECT (cwc.is_clone IS NOT TRUE AND EXISTS (
      SELECT 1 FROM public.clone_watch_not_a_clone_samples nac
      WHERE nac.alert_id = sca.id
    )) AS nac_audit
  ) aud ON true
  -- v334: the queue clock, defined ONCE. v330's clock (an audit sample's
  -- starts at its audit scan), moved forward by the lane's DNS-unchanged
  -- stamp. GREATEST ignores NULLs: NULL only when neither clock exists.
  LEFT JOIN LATERAL (
    SELECT GREATEST(
      CASE WHEN aud.nac_audit THEN COALESCE(sca.last_rechecked_at, sca.urlscan_scanned_at)
           ELSE sca.last_rechecked_at END,
      sca.recheck_dns_checked_at
    ) AS at
  ) clk ON true
  WHERE sca.source = 'nrd'
    AND sca.lifecycle_state IN ('monitoring', 'declined')
    AND sca.first_seen_at > pg_catalog.now() - pg_catalog.make_interval(days => 90)
    -- v326: dead-domain dormancy (see header). Same predicate as
    -- count_clone_recheck_dormant_dead — change both together.
    AND NOT (
      sca.urlscan_uuid IS NULL
      AND sca.urlscan_failure_streak >= 8
      AND COALESCE(sca.urlscan_evidence ->> 'status', '') = '400'
    )
    AND (
      clk.at IS NULL
      OR clk.at
         < pg_catalog.now() - pg_catalog.make_interval(
             hours => CASE
               WHEN sca.urlscan_evidence ->> 'status' = '400'
                 THEN GREATEST(1, p_dead_cadence_hours)
               -- v330: sampled not-a-clones are low-yield — weekly.
               WHEN aud.nac_audit
                 THEN GREATEST(p_cadence_hours, 168)
               -- v317: a row rechecked 8+ times without leaving the pool has
               -- shown nothing to watch for; weekly, not every 6 h.
               WHEN sca.recheck_count >= 8
                 THEN GREATEST(p_cadence_hours, 168)
               -- v326: older than 45 days → daily (79% of flips happen earlier).
               WHEN sca.first_seen_at < pg_catalog.now() - pg_catalog.make_interval(days => 45)
                 THEN GREATEST(p_cadence_hours, 24)
               ELSE GREATEST(1, p_cadence_hours)
             END
           )
    )
  ORDER BY clk.at ASC NULLS FIRST,
           sca.id ASC
  -- v334: 500 -> 1000 (the lane over-fetches 1,000 and DNS-reads 600).
  LIMIT GREATEST(1, LEAST(p_limit, 1000));
$function$;

COMMENT ON FUNCTION public.list_clone_alerts_for_recheck(integer, integer, integer) IS
  'Recheck worklist (clone-watch-lifecycle-recheck): monitoring/declined NRD alerts < 90 days, dead-dormant held out (v326), due by the cadence CASE, stalest first, LIMIT clamped to 1000 (v334). due_total = rows due before the LIMIT (v328). Sampled not-a-clones (v330) run weekly, clocked from their audit scan. v334: queue clock = GREATEST(that clock, recheck_dns_checked_at); returns the DNS gate inputs.';

REVOKE ALL ON FUNCTION public.list_clone_alerts_for_recheck(integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_clone_alerts_for_recheck(integer, integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.record_clone_recheck_dns(
  p_unchanged_ids bigint[],
  p_scanned jsonb
)
RETURNS TABLE(unchanged_stamped integer, fingerprints_written integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
SET statement_timeout TO '30s'
AS $function$
#variable_conflict use_column
DECLARE
  n_unchanged integer := 0;
  n_scanned integer := 0;
BEGIN
  IF p_unchanged_ids IS NOT NULL AND pg_catalog.cardinality(p_unchanged_ids) > 1000 THEN
    RAISE EXCEPTION 'record_clone_recheck_dns: % unchanged ids exceeds the 1000 cap',
      pg_catalog.cardinality(p_unchanged_ids);
  END IF;
  IF p_scanned IS NOT NULL AND pg_catalog.jsonb_typeof(p_scanned) <> 'array' THEN
    RAISE EXCEPTION 'record_clone_recheck_dns: p_scanned must be a JSON array';
  END IF;
  IF p_scanned IS NOT NULL AND pg_catalog.jsonb_array_length(p_scanned) > 500 THEN
    RAISE EXCEPTION 'record_clone_recheck_dns: % scanned rows exceeds the 500 cap',
      pg_catalog.jsonb_array_length(p_scanned);
  END IF;

  IF p_unchanged_ids IS NOT NULL AND pg_catalog.cardinality(p_unchanged_ids) > 0 THEN
    UPDATE public.shopfront_clone_alerts
    SET recheck_dns_checked_at = pg_catalog.now()
    WHERE id = ANY (p_unchanged_ids);
    GET DIAGNOSTICS n_unchanged = ROW_COUNT;
  END IF;

  IF p_scanned IS NOT NULL AND pg_catalog.jsonb_array_length(p_scanned) > 0 THEN
    UPDATE public.shopfront_clone_alerts sca
    SET recheck_dns_fingerprint = COALESCE(x.fp, sca.recheck_dns_fingerprint),
        recheck_dns_checked_at = pg_catalog.now()
    FROM pg_catalog.jsonb_to_recordset(p_scanned) AS x(id bigint, fp text)
    WHERE sca.id = x.id;
    GET DIAGNOSTICS n_scanned = ROW_COUNT;
  END IF;

  RETURN QUERY SELECT n_unchanged, n_scanned;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_clone_recheck_dns(bigint[], jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_clone_recheck_dns(bigint[], jsonb)
  TO service_role;

COMMENT ON FUNCTION public.record_clone_recheck_dns(bigint[], jsonb) IS
  'Recheck DNS gate bookkeeping (v334, #1229): stamps recheck_dns_checked_at on DNS-unchanged ids (nothing else), and writes the baseline fingerprint (null keeps the old one) + stamp for rows the urlscan batch attempted. Caps 1000 ids / 500 rows.';

COMMIT;
