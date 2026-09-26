-- v336 — clone-watch attribution: a WHOIS lookup that got no answer is re-asked, not final (#1253)
--
-- WHY. When whoisjson's monthly `batch` guard trips (packages/scam-engine/src/
-- whois.ts, 700 of the 1,000 free lookups — it tripped on 2026-09-20; August
-- used 1,227), lookupWhois returned the same all-null result it returns for a
-- served lookup with no registrar. So did a non-200 and a missing key. The
-- attribution enricher wrote that as the row's FINAL dossier
-- (`whois.source = 'whoisjson'`, registrar null), and its worklist
-- (`attribution IS NULL`) never offered the row again. Prod 2026-09-26: 76 of
-- 366 rows enriched in the last 7 days had no registrar, 74 of them from
-- whoisjson; 130 such rows inside the 35-day window, 448 all time. Lane health
-- counted them as enriched, so nothing showed it.
--
-- "Just don't write the dossier" is NOT the fix: the worklist is oldest-first
-- with a cap of 60, so unwritten rows would re-present at its head every run
-- and pin it (the worklist-gate starvation rule). The dossier is written as
-- before; the row is additionally stamped with WHEN to re-ask.
--
-- WHAT.
--   1. shopfront_clone_alerts.attribution_retry_after timestamptz NULL, with a
--      partial index where it is non-null. NULL = nothing to re-ask (the steady
--      state for every row). Non-null = WHOIS was deferred; the enricher's
--      re-offer step re-runs ONLY the registration lookup once it is <= now().
--   2. apply_clone_alert_attributions(jsonb) — same signature, body now also
--      writes `attribution_retry_after` from each element's optional
--      `attribution_retry_after` (absent / null / '' → NULL). Still writes ONLY
--      rows whose attribution IS NULL.
--   3. apply_clone_alert_whois_reoffers(jsonb) — the re-offer's write:
--      [{ "id", "whois": {...}, "retry_after": ts|null, "campaign_key": text|null }].
--      MERGES only the `whois` key (`attribution || jsonb_build_object('whois', …)`),
--      so kit_siblings, ct, hosting, au_registrant and enriched_at survive. Sets
--      attribution_retry_after to the element's retry_after — NULL clears it
--      (answered, or given up), a later instant pushes it forward (deferred
--      again). campaign_key is replaced when supplied (a registrar that arrives
--      changes the fingerprint; null leaves it alone, as in v331). Writes ONLY
--      rows still DUE for a re-offer (attribution_retry_after IS NOT NULL AND
--      <= now()) that carry an object dossier, so a retried or stale write
--      whose first attempt already cleared the mark — or pushed it forward —
--      is a no-op instead of clobbering the newer state.
--   4. Backfill, by predicate, of rows already saved as final:
--      in the 35-day window, whois.source = 'whoisjson' AND registrar IS NULL,
--      plus any `source = 'deferred'` dossier written before this migration
--      (only possible if the code reached prod first) — stamped with the first
--      instant of next month (UTC), when whoisjson's monthly guard resets.
--      Bounded: the table holds ~3.6k rows and the predicate ~140 (prod
--      2026-09-27), so one statement is fine. Idempotent in effect: it only
--      touches rows whose attribution_retry_after IS NULL. Re-running it AFTER
--      re-offers have run would re-mark rows whose re-ask was a served lookup
--      with no registrar (or a given-up deferral) for one more re-ask — bounded
--      by the same predicate, and never a data change to the dossier.
--      NOTE: next month is right while this month's guard is spent (it is
--      from ~day 20). Applied early in a month, the backfill would wait a month
--      it did not need to; see the PR for the one-line manual alternative.
--
-- Both functions: SECURITY DEFINER, `SET search_path = ''`, FUNCTION-LEVEL
-- statement_timeout (an in-body SET LOCAL is decorative under PostgREST —
-- supabase/CLAUDE.md §4), input capped at 500, REVOKE from PUBLIC/anon/
-- authenticated + EXECUTE to service_role (v324, §7).
--
-- The v315 clone_alert_platform_projection trigger (AFTER UPDATE OF
-- attribution) fires on a re-offer write exactly as on the first write, so a
-- registrar that arrives late is projected onto the Platform Entity too
-- (its COALESCE never overwrites a value another feed supplied).
--
-- Deploy order: apply this, then merge the code right away — both before a
-- 13:30 UTC enricher tick. Then re-run section 4's backfill UPDATE once after
-- the deploy (its predicate only touches rows with attribution_retry_after IS
-- NULL, so a re-run is safe): it catches rows the OLD code wrote as final
-- between apply and deploy. Code that reaches prod first selects a column that
-- does not exist (select-pending records whois_reoffer_due = null) and the old
-- apply function ignores the new key.
--
-- Rollback: DROP FUNCTION apply_clone_alert_whois_reoffers(jsonb); re-apply
-- v331's apply_clone_alert_attributions body; DROP INDEX + ALTER TABLE … DROP
-- COLUMN attribution_retry_after (no data lost — the dossiers keep
-- `source: "deferred"` / "whoisjson" as written). Revert the enricher.

BEGIN;

-- ── 1. The column + its partial index ──────────────────────────────────────
ALTER TABLE public.shopfront_clone_alerts
  ADD COLUMN IF NOT EXISTS attribution_retry_after timestamptz;

COMMENT ON COLUMN public.shopfront_clone_alerts.attribution_retry_after IS
  'When the attribution dossier''s WHOIS block was deferred (whoisjson quota '
  'guard / http error / no key), the instant a re-ask may answer; the '
  'clone-watch-enrich-attribution re-offer step re-runs only the registration '
  'lookup once this is <= now(). NULL = nothing to re-ask. v336 / #1253.';

CREATE INDEX IF NOT EXISTS idx_shopfront_clone_alerts_attribution_retry_after
  ON public.shopfront_clone_alerts (attribution_retry_after)
  WHERE attribution_retry_after IS NOT NULL;

-- ── 2. The first write also stamps the retry instant ───────────────────────
CREATE OR REPLACE FUNCTION public.apply_clone_alert_attributions(
  p_rows jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
SET statement_timeout TO '30s'
AS $function$
DECLARE
  n integer;
BEGIN
  IF p_rows IS NULL
     OR pg_catalog.jsonb_typeof(p_rows) <> 'array'
     OR pg_catalog.jsonb_array_length(p_rows) = 0 THEN
    RETURN 0;
  END IF;
  IF pg_catalog.jsonb_array_length(p_rows) > 500 THEN
    RAISE EXCEPTION 'apply_clone_alert_attributions: % rows exceeds the 500 cap',
      pg_catalog.jsonb_array_length(p_rows);
  END IF;

  WITH src AS (
    SELECT DISTINCT ON ((e ->> 'id')::bigint)
      (e ->> 'id')::bigint AS id,
      e -> 'attribution' AS attribution,
      NULLIF(e ->> 'campaign_key', '') AS campaign_key,
      NULLIF(e ->> 'attribution_retry_after', '')::timestamptz AS retry_after
    FROM pg_catalog.jsonb_array_elements(p_rows) AS e
    WHERE e ? 'id'
      AND pg_catalog.jsonb_typeof(e -> 'attribution') = 'object'
  )
  UPDATE public.shopfront_clone_alerts AS a
  SET attribution = src.attribution,
      campaign_key = COALESCE(src.campaign_key, a.campaign_key),
      attribution_retry_after = src.retry_after
  FROM src
  WHERE a.id = src.id
    AND a.attribution IS NULL;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_clone_alert_attributions(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_clone_alert_attributions(jsonb)
  TO service_role;

COMMENT ON FUNCTION public.apply_clone_alert_attributions(jsonb) IS
  'Batch write of clone-watch attribution dossiers (clone-watch-enrich-attribution): '
  '[{id, attribution, campaign_key?, attribution_retry_after?}] → sets attribution '
  '(+ campaign_key when non-null, + attribution_retry_after) ONLY where attribution '
  'IS NULL, so a retried step never overwrites. Returns rows written. Cap 500. '
  'v331 / #1229; retry column v336 / #1253.';

-- ── 3. The re-offer's merge-only write ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_clone_alert_whois_reoffers(
  p_rows jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
SET statement_timeout TO '30s'
AS $function$
DECLARE
  n integer;
BEGIN
  IF p_rows IS NULL
     OR pg_catalog.jsonb_typeof(p_rows) <> 'array'
     OR pg_catalog.jsonb_array_length(p_rows) = 0 THEN
    RETURN 0;
  END IF;
  IF pg_catalog.jsonb_array_length(p_rows) > 500 THEN
    RAISE EXCEPTION 'apply_clone_alert_whois_reoffers: % rows exceeds the 500 cap',
      pg_catalog.jsonb_array_length(p_rows);
  END IF;

  WITH src AS (
    SELECT DISTINCT ON ((e ->> 'id')::bigint)
      (e ->> 'id')::bigint AS id,
      e -> 'whois' AS whois,
      NULLIF(e ->> 'campaign_key', '') AS campaign_key,
      NULLIF(e ->> 'retry_after', '')::timestamptz AS retry_after
    FROM pg_catalog.jsonb_array_elements(p_rows) AS e
    WHERE e ? 'id'
      AND pg_catalog.jsonb_typeof(e -> 'whois') = 'object'
  )
  UPDATE public.shopfront_clone_alerts AS a
  SET attribution = a.attribution
        OPERATOR(pg_catalog.||) pg_catalog.jsonb_build_object('whois', src.whois),
      campaign_key = COALESCE(src.campaign_key, a.campaign_key),
      attribution_retry_after = src.retry_after
  FROM src
  WHERE a.id = src.id
    AND a.attribution_retry_after IS NOT NULL
    -- Still DUE, not merely marked: a replayed or stale write (a retried step
    -- whose first attempt already pushed this row forward) must not clobber
    -- the newer deferral with an older answer.
    AND a.attribution_retry_after <= pg_catalog.now()
    -- `||` on a non-object would replace the dossier wholesale; the NOT NULL
    -- is explicit because jsonb_typeof(NULL) is NULL, not false.
    AND a.attribution IS NOT NULL
    AND pg_catalog.jsonb_typeof(a.attribution) = 'object';

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_clone_alert_whois_reoffers(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_clone_alert_whois_reoffers(jsonb)
  TO service_role;

COMMENT ON FUNCTION public.apply_clone_alert_whois_reoffers(jsonb) IS
  'WHOIS re-offer write (clone-watch-enrich-attribution, #1253): '
  '[{id, whois, retry_after?, campaign_key?}] → merges ONLY attribution.whois '
  '(kit_siblings etc. kept), sets attribution_retry_after (null clears), '
  'replaces campaign_key when non-null. Only rows still due (retry_after <= now()). '
  'Returns rows written. Cap 500. v336.';

-- ── 4. Backfill the rows already saved as final ─────────────────────────────
UPDATE public.shopfront_clone_alerts
SET attribution_retry_after =
      (pg_catalog.date_trunc('month', pg_catalog.now() AT TIME ZONE 'UTC')
        + interval '1 month') AT TIME ZONE 'UTC'
WHERE attribution_retry_after IS NULL
  AND attribution IS NOT NULL
  AND first_seen_at >= pg_catalog.now() - interval '35 days'
  AND (
    (attribution -> 'whois' ->> 'source' = 'whoisjson'
      AND attribution -> 'whois' ->> 'registrar' IS NULL)
    OR attribution -> 'whois' ->> 'source' = 'deferred'
  );

COMMIT;
