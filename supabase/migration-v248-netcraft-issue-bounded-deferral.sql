-- migration-v248-netcraft-issue-bounded-deferral.sql
--
-- Clone-Watch — the Netcraft issue reporter drops weaponised clones permanently.
--
-- Measured on prod 2026-07-26: of 54 alerts that reached `weaponised`, only 17
-- (31%) were ever re-reported to Netcraft. The single largest loss — 19 alerts,
-- MORE than we have ever filed — is the `unavailable_deferred` drain:
--
--   selectFalseNegativeCandidates() classified a Netcraft per-URL state of
--   `unavailable` as TERMINAL, the reporter stamped
--   submitted_to.netcraft_issue.skipped = 'unavailable_deferred', and the
--   worklist RPC (v221, L85) excludes any row carrying a `skipped` key. The
--   code comment said "defer to PR3"; PR3 never shipped, so the deferral is a
--   permanent drop. All 19 were stamped AFTER weaponising.
--
-- `unavailable` is a timing artifact, not a verdict. Netcraft grades on a single
-- fetch at submission time, so a lookalike that was parked, cloaked or not yet
-- stood up reads `unavailable`. The prod timestamps show it plainly:
-- `id-apple-kc.shop` was submitted 2026-07-20 09:30, graded `unavailable` by the
-- reconciler at 10:00, and was serving phishing by 12:01 the same day.
--
-- This migration ships the DB half of the fix:
--   1. defer_clone_alert_netcraft_issue — a bounded deferral RPC. A deferred
--      alert re-enters the worklist after a cooling-off window and converges via
--      a per-reason round counter, instead of being dropped forever.
--   2. A one-off release of the alerts the old terminal drain already locked out.
--
-- The TS half (netcraft-urls.ts moves `unavailable` from terminal → deferred,
-- and makes it ESCALATABLE when our own scan witnessed weaponisation) ships in
-- the same PR. See docs/plans/clone-watch-brand-value-features.md §F4.

-- ── 1. Bounded deferral ─────────────────────────────────────────────────────
-- Why an RPC rather than merge_clone_alert_submission_bulk (v216): that helper
-- does jsonb_set(submitted_to, ARRAY[p_key], p_value) — it REPLACES the whole
-- netcraft_issue object. Counting rounds would need a read-modify-write in TS,
-- which races two concurrent uuid groups touching the same alert and silently
-- clobbers `attempts`. Doing it in one statement makes the counter correct by
-- construction.
--
-- Convergence: every call bumps rounds.<reason>. Past p_max_rounds the alert is
-- stamped terminal (`skipped = '<reason>_exhausted'`), so the worklist still
-- drains — absence of a stamp is never the retry signal (the v224 lesson).
-- `attempts` and every other key on the object are preserved; only `skipped`
-- and `recheck_after` are rewritten.
CREATE OR REPLACE FUNCTION public.defer_clone_alert_netcraft_issue(
  p_alert_ids bigint[],
  p_reason text,
  p_recheck_after timestamptz,
  p_max_rounds integer DEFAULT 5
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH cur AS (
    SELECT
      sca.id,
      COALESCE(sca.submitted_to -> 'netcraft_issue', '{}'::jsonb) AS ni
    FROM public.shopfront_clone_alerts sca
    WHERE sca.id = ANY(p_alert_ids)
  ),
  nxt AS (
    SELECT
      cur.id,
      cur.ni,
      COALESCE((cur.ni -> 'rounds' ->> p_reason)::int, 0) + 1 AS rounds
    FROM cur
  ),
  built AS (
    SELECT
      nxt.id,
      -- Preserve everything except the two keys this call owns.
      (nxt.ni - 'skipped' - 'recheck_after')
      || pg_catalog.jsonb_build_object(
           'rounds',
           pg_catalog.jsonb_set(
             COALESCE(nxt.ni -> 'rounds', '{}'::jsonb),
             ARRAY[p_reason],
             pg_catalog.to_jsonb(nxt.rounds),
             true
           ),
           'at', pg_catalog.to_jsonb(pg_catalog.now()::text)
         )
      || CASE
           WHEN nxt.rounds > GREATEST(1, p_max_rounds)
             THEN pg_catalog.jsonb_build_object('skipped', p_reason || '_exhausted')
           ELSE pg_catalog.jsonb_build_object(
                  'recheck_after',
                  pg_catalog.to_jsonb(
                    COALESCE(p_recheck_after, pg_catalog.now() + interval '24 hours')::text
                  )
                )
         END AS ni
    FROM nxt
  ),
  upd AS (
    UPDATE public.shopfront_clone_alerts sca
    SET submitted_to = pg_catalog.jsonb_set(
          COALESCE(sca.submitted_to, '{}'::jsonb),
          ARRAY['netcraft_issue'],
          built.ni,
          true
        ),
        updated_at = pg_catalog.now()
    FROM built
    WHERE sca.id = built.id
    RETURNING 1
  )
  SELECT COALESCE(count(*), 0)::int FROM upd;
$function$;

REVOKE EXECUTE ON FUNCTION public.defer_clone_alert_netcraft_issue(bigint[], text, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.defer_clone_alert_netcraft_issue(bigint[], text, timestamptz, integer) IS
  'v248. Bounded, non-terminal deferral for the Netcraft issue reporter: sets recheck_after and bumps rounds.<reason>, converting to a terminal skipped=<reason>_exhausted past p_max_rounds. Replaces the permanent unavailable_deferred drain.';

-- ── 2. Release the alerts the terminal drain already locked out ─────────────
-- 25 rows (19 of them weaponised) carry skipped='unavailable_deferred' and can
-- never re-enter the worklist. Dropping the whole netcraft_issue key is the
-- cleanest re-entry: the v221 predicate tests for issue_reported_at / skipped /
-- failed / attempts / recheck_after, and absence satisfies all five.
--
-- Scope note: the plan approved releasing the 19 weaponised rows. This releases
-- all 25 — the other 6 are the identical defect on non-weaponised alerts, and
-- leaving them stamped would re-create the permanent lock-out the moment they
-- weaponise. Same bounded write.
--
-- shopfront_clone_alerts is not a hot table (~1.9K rows, low write rate) and
-- this touches ~25 of them, so no chunking is required. Reverse: none needed —
-- the stamp carried no information that the next reporter run cannot rebuild.
UPDATE public.shopfront_clone_alerts
SET submitted_to = submitted_to - 'netcraft_issue',
    updated_at = now()
WHERE submitted_to -> 'netcraft_issue' ->> 'skipped' = 'unavailable_deferred';
