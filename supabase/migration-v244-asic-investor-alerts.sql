-- v244 — ASIC Investor Alert List: entity registry + lookup (PR-A1)
--
-- WHY: pipeline/scrapers/asic_investor_alerts.py already runs daily and writes
-- ASIC-flagged *domains* into scam_urls (so URL Guard already flags them). But
-- the entity *names* (e.g. "Tag Markets", "Sonic AI") land nowhere queryable —
-- scam_entities.entity_type has no company/name type, and the ASIC list is a
-- regulator-confirmed registry with its own add/remove lifecycle. This is a
-- dedicated, small, cold registry so a "is THIS platform ASIC-listed?" name
-- lookup works across web/extension/bots (PR-A2), keyed off the same
-- brand_normalize() canonical the brand-convergence Seam uses (v174).
--
-- Source: ASIC Moneysmart Investor Alert List (CC BY 4.0). Attribute "Source: ASIC".
--
-- RLS: regulator OPEN data — public SELECT of ACTIVE rows (a future public
-- "check this platform" page can read directly). Writes are service-role only
-- (the scraper connects as the DB service role). is_active flips false when a
-- snapshot no longer lists the entity (delisted), so anon never sees stale
-- de-listings.
--
-- Function rules (supabase/CLAUDE.md §4): write RPCs are SECURITY DEFINER +
-- search_path='' + fully-qualified refs; the read RPC is SECURITY INVOKER +
-- search_path='public, pg_catalog' (relies on the table's public-read policy)
-- + #variable_conflict use_column. Idempotent (IF NOT EXISTS / CREATE OR REPLACE).

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.asic_investor_alerts (
  id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_name             text NOT NULL,
  entity_name_normalized  text NOT NULL,               -- brand_normalize(entity_name)
  aliases                 text[] NOT NULL DEFAULT '{}', -- brand_normalize()'d alias tokens
  domains                 text[] NOT NULL DEFAULT '{}', -- registrable domains (normalized app-side)
  alert_type              text,                         -- ASIC's free-text classification
  asic_url                text,
  first_seen              timestamptz NOT NULL DEFAULT now(),
  last_seen               timestamptz NOT NULL DEFAULT now(),
  snapshot_date           date NOT NULL,
  is_active               boolean NOT NULL DEFAULT true,
  raw                     jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_name_normalized)
);

-- Array-membership lookups (alias/domain match). Table is small + cold, so GIN
-- is cheap and there is no hot-path write concern (daily snapshot only).
CREATE INDEX IF NOT EXISTS idx_asic_alerts_domains
  ON public.asic_investor_alerts USING gin (domains);
CREATE INDEX IF NOT EXISTS idx_asic_alerts_aliases
  ON public.asic_investor_alerts USING gin (aliases);
-- Active-only scans (the common lookup path).
CREATE INDEX IF NOT EXISTS idx_asic_alerts_active
  ON public.asic_investor_alerts (entity_name_normalized)
  WHERE is_active;

COMMENT ON TABLE public.asic_investor_alerts IS
  'ASIC Moneysmart Investor Alert List entity registry (v244, PR-A1). One row per regulator-flagged unlicensed/impersonating entity. Populated by pipeline/scrapers/asic_investor_alerts.py (daily). is_active flips false on delisting. Source: ASIC (CC BY 4.0).';

-- ---------------------------------------------------------------------------
-- RLS: public read of active rows; service-role writes.
-- ---------------------------------------------------------------------------
ALTER TABLE public.asic_investor_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS asic_alerts_public_read ON public.asic_investor_alerts;
CREATE POLICY asic_alerts_public_read ON public.asic_investor_alerts
  FOR SELECT
  TO anon, authenticated
  USING (is_active);
-- No INSERT/UPDATE/DELETE policy: only service_role (RLS bypass) writes.

-- ---------------------------------------------------------------------------
-- Write RPC: upsert one entity (SECURITY DEFINER, search_path='')
-- Called per-row by the scraper's bulk_upsert_asic_alerts() batcher.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bulk_upsert_asic_alert(
  p_entity_name   text,
  p_aliases       text[],
  p_domains       text[],
  p_alert_type    text,
  p_asic_url      text,
  p_snapshot_date date,
  p_raw           jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_norm    text;
  v_aliases text[];
  v_is_new  boolean;
BEGIN
  v_norm := public.brand_normalize(p_entity_name);
  IF v_norm IS NULL OR length(v_norm) = 0 THEN
    RETURN jsonb_build_object('skipped', true);
  END IF;

  -- Normalize alias tokens through the same canonical (drop empties).
  SELECT COALESCE(array_agg(DISTINCT n) FILTER (WHERE n <> ''), '{}'::text[])
    INTO v_aliases
    FROM (
      SELECT public.brand_normalize(x) AS n
      FROM unnest(COALESCE(p_aliases, '{}'::text[])) AS x
    ) t;

  INSERT INTO public.asic_investor_alerts AS a
    (entity_name, entity_name_normalized, aliases, domains, alert_type,
     asic_url, snapshot_date, is_active, raw, first_seen, last_seen)
  VALUES
    (p_entity_name, v_norm, v_aliases, COALESCE(p_domains, '{}'::text[]),
     p_alert_type, p_asic_url, p_snapshot_date, true, p_raw, now(), now())
  ON CONFLICT (entity_name_normalized) DO UPDATE SET
    entity_name = EXCLUDED.entity_name,
    aliases     = (SELECT COALESCE(array_agg(DISTINCT z), '{}'::text[])
                     FROM unnest(a.aliases || EXCLUDED.aliases) AS z WHERE z <> ''),
    domains     = (SELECT COALESCE(array_agg(DISTINCT d), '{}'::text[])
                     FROM unnest(a.domains || EXCLUDED.domains) AS d WHERE d <> ''),
    alert_type    = COALESCE(EXCLUDED.alert_type, a.alert_type),
    asic_url      = COALESCE(EXCLUDED.asic_url, a.asic_url),
    snapshot_date = EXCLUDED.snapshot_date,
    last_seen     = now(),
    is_active     = true,
    raw           = COALESCE(EXCLUDED.raw, a.raw)
  RETURNING (xmax = 0) INTO v_is_new;

  RETURN jsonb_build_object('is_new', v_is_new);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bulk_upsert_asic_alert(text, text[], text[], text, text, date, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_upsert_asic_alert(text, text[], text[], text, text, date, jsonb)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Write RPC: deactivate entities not seen in the latest snapshot (delisted).
-- Table is small + cold (hundreds–low-thousands of rows) — single UPDATE is safe.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.deactivate_stale_asic_alerts(p_snapshot_date date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.asic_investor_alerts
     SET is_active = false
   WHERE is_active
     AND snapshot_date < p_snapshot_date;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.deactivate_stale_asic_alerts(date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_stale_asic_alerts(date)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Read RPC: "is this name/domain ASIC-listed?" (SECURITY INVOKER)
-- Matches exact name, exact alias, domain-substring, or a length-gated name
-- partial (so "tagmarkets" hits "tag markets pty ltd"). Relies on the table's
-- public-read policy for anon/authenticated; service_role sees inactive too.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lookup_asic_investor_alert(p_query text)
RETURNS TABLE (
  id          bigint,
  entity_name text,
  alert_type  text,
  asic_url    text,
  domains     text[],
  match_type  text,
  is_active   boolean
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
#variable_conflict use_column
DECLARE
  v_q_norm text := public.brand_normalize(COALESCE(p_query, ''));
  v_q_low  text := lower(COALESCE(p_query, ''));
BEGIN
  IF v_q_norm IS NULL OR length(v_q_norm) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.entity_name,
    a.alert_type,
    a.asic_url,
    a.domains,
    CASE
      WHEN a.entity_name_normalized = v_q_norm THEN 'name'
      WHEN v_q_norm = ANY (a.aliases) THEN 'alias'
      WHEN EXISTS (SELECT 1 FROM unnest(a.domains) d WHERE d <> '' AND position(d IN v_q_low) > 0) THEN 'domain'
      ELSE 'name_partial'
    END AS match_type,
    a.is_active
  FROM public.asic_investor_alerts a
  WHERE
    a.entity_name_normalized = v_q_norm
    OR v_q_norm = ANY (a.aliases)
    OR EXISTS (SELECT 1 FROM unnest(a.domains) d WHERE d <> '' AND position(d IN v_q_low) > 0)
    OR (length(v_q_norm) >= 5 AND a.entity_name_normalized LIKE '%' || v_q_norm || '%')
  ORDER BY a.is_active DESC, a.entity_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_asic_investor_alert(text)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.lookup_asic_investor_alert(text) IS
  'Is this name/domain ASIC-listed? Matches exact name / alias / domain-substring / length-gated name-partial against asic_investor_alerts. SECURITY INVOKER (public-read policy governs anon visibility to active rows). PR-A2 helper: packages/scam-engine/src/asic-lookup.ts.';
