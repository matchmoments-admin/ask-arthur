-- v348 — One watched-brand roster: a paying brand gets a known_brands row (#1304)
--
-- WHY: known-brands-discover enumerated only the static AU_BRAND_WATCHLIST, so
-- a Brand Subscriber (monitored_brands, v347) — or a house-org overlay brand
-- (v256/v257) — never got a known_brands row. known_brands is where a brand's
-- category (the weaponisation-risk input, read by brand_domain — #1305's
-- lowest-id-non-null rule) and its RFC 9116 security contact live, so a paying
-- brand's lookalikes scored without category points and the brand never got a
-- security.txt probe.
--
-- Decision (#1304): the ACTIVE WATCHLIST (static seed ∪ the monitored_brands
-- overlay, read through getActiveWatchlist) is the one per-brand roster, and
-- known-brands-discover enumerates it, matching known_brands on the Canonical
-- Brand (ADR-0020) or the brand's domain. A Brand Subscriber does not wait for
-- the roster (its row joins the overlay only once verified): activation seeds
-- its known_brands row here — category from the operator, NO contact — and
-- triggers one discover run to probe its domain. The cron stays PARKED (#1230).
--
-- Prod measured 2026-10-13 (read-only): known_brands 307 rows / 294 domains;
-- 236 contact_type='none' rows, every one written by the discover probe
-- ("Probed — no security.txt contact found."); 0 of 293 static entries lack a
-- row by Canonical Brand (1 lacks one by domain: Google, google.com vs the
-- v49 row's google.com.au); monitored_brands 0 rows.
--
-- Idempotent; nothing destructive. The backfill touches 266 rows of a cold
-- 307-row table in one statement.

-- ── 1. probed_at: "has discovery looked at this brand?" ─────────────────
--
-- Without it a seeded row (contact_type 'none', not yet probed) and a probed
-- miss (contact_type 'none') are the same row, and the discover worklist
-- cannot tell which to probe. Coverage rule (selectDiscoverCandidates in
-- known-brands-discover.ts): a row covers its brand when it has a contact OR
-- probed_at is set. The probe RPC below stamps probed_at on EVERY probe, which
-- is what moves a candidate out of the worklist (worklist-gate starvation rule).
ALTER TABLE public.known_brands
  ADD COLUMN IF NOT EXISTS probed_at timestamptz;

-- Backfill so today's coverage is unchanged: every existing 'none' row is a
-- probed miss (measured above), and the discovery hits were probed when they
-- were verified. Rows with a curated contact stay NULL — they are covered by
-- their contact, and were never probed. Re-running is a no-op (IS NULL guard).
UPDATE public.known_brands
SET probed_at = COALESCE(last_verified_at, pg_catalog.now())
WHERE probed_at IS NULL
  AND (contact_type = 'none' OR verified_by = 'security_txt_discovery');

COMMENT ON COLUMN public.known_brands.probed_at IS
  'v348 (#1304): when known-brands-discover last probed this brand''s /.well-known/security.txt. NULL + contact_type ''none'' = a row seeded for a Brand Subscriber that discovery has not probed yet (it is at the head of the discover worklist). Stamped by record_known_brand_probe on every probe.';

-- ── 2. Seed a Brand Subscriber's row on activation ──────────────────────
--
-- Called by apps/web/lib/clone-watch/known-brand-seed.ts from the two
-- activation paths: admin onboarding (POST /api/admin/brands) and the Stripe
-- webhook (apply_brand_subscription -> active).
--
-- Outcomes:
--   'not_subscriber'         no row, or not active/lapsed (pending, canceled,
--                            a house-org watch row) — nothing written.
--   'no_domain'              the subscriber has no legitimate domain.
--   'existing'               a known_brands row already describes this brand
--                            (Canonical Brand, raw name or one of its domains);
--                            nothing changed.
--   'existing_category_set'  as above, and the operator's category filled a
--                            gap: no row for that domain had one.
--   'created'                a new row: the subscriber's name + primary domain,
--                            the operator's category, contact_type 'none',
--                            inactive, probed_at NULL (= probe me).
--
-- Never overwrites a curated category or contact. Never copies the
-- subscriber's alert contact here: that contact lives on monitored_brands and
-- is routed through the Brand Send Gate "subscriber" profile (#1295 decision
-- 4); known_brands' contact is the brand's PUBLIC security contact, which
-- onward brand-abuse reports go to, and only discovery or a human sets it.
CREATE OR REPLACE FUNCTION public.seed_known_brand_for_subscriber(
  p_brand_subscriber_id bigint,
  p_brand_key           text,
  p_brand_category      text
)
RETURNS TABLE (known_brand_id integer, outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $$
#variable_conflict use_column
DECLARE
  v_sub      record;
  v_domains  text[];
  v_primary  text;
  v_match    record;
  v_category text := NULLIF(lower(btrim(p_brand_category)), '');
  v_id       integer;
BEGIN
  SELECT mb.id, mb.brand_name, mb.brand_normalized, mb.legitimate_domains,
         mb.subscription_status
  INTO v_sub
  FROM public.monitored_brands mb
  WHERE mb.id = p_brand_subscriber_id;

  IF NOT FOUND OR v_sub.subscription_status IS NULL
     OR v_sub.subscription_status NOT IN ('active', 'lapsed') THEN
    known_brand_id := NULL; outcome := 'not_subscriber'; RETURN NEXT; RETURN;
  END IF;

  SELECT COALESCE(pg_catalog.array_agg(d ORDER BY o), '{}')
  INTO v_domains
  FROM (
    SELECT lower(btrim(x)) AS d, o
    FROM pg_catalog.unnest(v_sub.legitimate_domains) WITH ORDINALITY AS t(x, o)
    WHERE COALESCE(btrim(x), '') <> ''
  ) s;
  v_primary := v_domains[1];
  IF v_primary IS NULL THEN
    known_brand_id := NULL; outcome := 'no_domain'; RETURN NEXT; RETURN;
  END IF;

  -- Does a row already describe this brand? Domain first (it is the key the
  -- risk category is read by), then the Canonical Brand / raw name.
  SELECT kb.id, lower(kb.brand_domain) AS domain
  INTO v_match
  FROM public.known_brands kb
  WHERE lower(kb.brand_domain) = ANY (v_domains)
     OR public.brand_normalize(COALESCE(public.resolve_brand(kb.brand_name), kb.brand_name))
        = v_sub.brand_normalized
     OR public.brand_normalize(kb.brand_name) = public.brand_normalize(v_sub.brand_name)
  ORDER BY (lower(kb.brand_domain) = v_primary) DESC NULLS LAST,
           (lower(kb.brand_domain) = ANY (v_domains)) DESC NULLS LAST,
           kb.id
  LIMIT 1;

  IF FOUND THEN
    -- Fill a category gap only. "Gap" is #1305's rule read backwards: the
    -- category of a domain is the lowest-id NON-NULL one, so a domain with any
    -- categorised row already has its answer and is left alone.
    IF v_category IS NOT NULL AND v_match.domain IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.known_brands kb
      WHERE lower(kb.brand_domain) = v_match.domain
        AND kb.brand_category IS NOT NULL
    ) THEN
      UPDATE public.known_brands kb
      SET brand_category = v_category
      WHERE kb.id = v_match.id AND kb.brand_category IS NULL;
      known_brand_id := v_match.id; outcome := 'existing_category_set'; RETURN NEXT; RETURN;
    END IF;
    known_brand_id := v_match.id; outcome := 'existing'; RETURN NEXT; RETURN;
  END IF;

  INSERT INTO public.known_brands (
    brand_name, brand_domain, brand_key, brand_category,
    contact_type, security_contact_email, security_contact_url,
    is_active, last_verified_at, verified_by, probed_at, notes
  )
  VALUES (
    btrim(v_sub.brand_name), v_primary, NULLIF(btrim(p_brand_key), ''), v_category,
    'none', NULL, NULL,
    FALSE, NULL, NULL, NULL,
    'Seeded from Brand Subscriber #' || v_sub.id || ' (v348) — awaiting security.txt probe.'
  )
  ON CONFLICT (brand_name) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    -- Lost a race to a concurrent writer of the same name.
    SELECT kb.id INTO v_id FROM public.known_brands kb WHERE kb.brand_name = btrim(v_sub.brand_name);
    known_brand_id := v_id; outcome := 'existing'; RETURN NEXT; RETURN;
  END IF;

  known_brand_id := v_id; outcome := 'created'; RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_known_brand_for_subscriber(bigint, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_known_brand_for_subscriber(bigint, text, text)
  TO service_role;

COMMENT ON FUNCTION public.seed_known_brand_for_subscriber(bigint, text, text) IS
  'v348 (#1304): on Brand Subscriber activation, ensure a known_brands row describes the brand. Matches on domain, Canonical Brand or raw name; fills only a category gap on a match; otherwise inserts an inactive contact-less row with probed_at NULL so known-brands-discover probes it next. Never writes a contact.';

-- ── 3. Record a security.txt probe ──────────────────────────────────────
--
-- Replaces the discover fn's `upsert(..., ignoreDuplicates)`, which could not
-- fill in a seeded row (its name already existed, so the write was dropped and
-- the row stayed unprobed — at the head of the worklist forever). Every call
-- stamps probed_at, hit or miss, which is the rotation guarantee.
--
--   no row by that name     -> insert (exactly what the upsert wrote before)
--   unprobed 'none' row     -> fill contact + probed_at (the seeded case)
--   any other row           -> probed_at := COALESCE(probed_at, now()) only;
--                              a curated contact is never overwritten.
--
-- A found contact activates the row unless another ACTIVE row already holds
-- its brand_key (known_brands_brand_key_active_idx): then the contact is kept
-- but the row stays inactive, outcome 'contact_key_conflict'.
CREATE OR REPLACE FUNCTION public.record_known_brand_probe(
  p_brand_name   text,
  p_brand_domain text,
  p_brand_key    text,
  p_email        text,
  p_url          text
)
RETURNS TABLE (known_brand_id integer, outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $$
#variable_conflict use_column
DECLARE
  v_email   text := NULLIF(lower(btrim(p_email)), '');
  v_url     text := NULLIF(btrim(p_url), '');
  v_has     boolean;
  v_type    text;
  v_row     record;
  v_active  boolean;
  v_id      integer;
  v_now     timestamptz := pg_catalog.now();
  v_domain  text := lower(btrim(p_brand_domain));
BEGIN
  IF COALESCE(btrim(p_brand_name), '') = '' OR COALESCE(v_domain, '') = '' THEN
    RAISE EXCEPTION 'brand_name and brand_domain are required' USING ERRCODE = '22023';
  END IF;
  v_has  := v_email IS NOT NULL OR v_url IS NOT NULL;
  v_type := CASE WHEN v_email IS NOT NULL THEN 'email'
                 WHEN v_url IS NOT NULL THEN 'webform'
                 ELSE 'none' END;

  SELECT kb.id, kb.contact_type, kb.probed_at
  INTO v_row
  FROM public.known_brands kb
  WHERE kb.brand_name = btrim(p_brand_name)
  FOR UPDATE;

  -- An active row may take this brand_key only if no OTHER active row holds it.
  v_active := v_has AND NOT EXISTS (
    SELECT 1 FROM public.known_brands kb
    WHERE kb.brand_key = NULLIF(btrim(p_brand_key), '')
      AND kb.is_active
      AND kb.id IS DISTINCT FROM v_row.id
  );

  IF v_row.id IS NULL THEN
    INSERT INTO public.known_brands (
      brand_name, brand_domain, brand_key, contact_type,
      security_contact_email, security_contact_url, is_active,
      last_verified_at, verified_by, source_url, notes, probed_at
    )
    VALUES (
      btrim(p_brand_name), v_domain, NULLIF(btrim(p_brand_key), ''), v_type,
      v_email, v_url, v_active,
      CASE WHEN v_has THEN v_now END,
      CASE WHEN v_has THEN 'security_txt_discovery' END,
      CASE WHEN v_has THEN 'https://' || v_domain || '/.well-known/security.txt' END,
      CASE WHEN v_has THEN 'Auto-discovered from RFC 9116 security.txt.'
           ELSE 'Probed — no security.txt contact found.' END,
      v_now
    )
    RETURNING id INTO v_id;
    known_brand_id := v_id;
    outcome := CASE WHEN NOT v_has THEN 'inserted_none'
                    WHEN v_active THEN 'inserted_contact'
                    ELSE 'contact_key_conflict' END;
    RETURN NEXT; RETURN;
  END IF;

  IF v_row.contact_type = 'none' AND v_row.probed_at IS NULL THEN
    UPDATE public.known_brands kb SET
      contact_type           = v_type,
      security_contact_email = v_email,
      security_contact_url   = v_url,
      is_active              = v_active,
      last_verified_at       = CASE WHEN v_has THEN v_now END,
      verified_by            = CASE WHEN v_has THEN 'security_txt_discovery' END,
      source_url             = CASE WHEN v_has THEN 'https://' || v_domain || '/.well-known/security.txt' END,
      notes                  = CASE WHEN v_has THEN 'Auto-discovered from RFC 9116 security.txt.'
                                    ELSE 'Probed — no security.txt contact found.' END,
      probed_at              = v_now
    WHERE kb.id = v_row.id;
    known_brand_id := v_row.id;
    outcome := CASE WHEN NOT v_has THEN 'seed_probed_none'
                    WHEN v_active THEN 'seed_probed_contact'
                    ELSE 'contact_key_conflict' END;
    RETURN NEXT; RETURN;
  END IF;

  UPDATE public.known_brands kb
  SET probed_at = COALESCE(kb.probed_at, v_now)
  WHERE kb.id = v_row.id;
  known_brand_id := v_row.id; outcome := 'existing_untouched'; RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.record_known_brand_probe(text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_known_brand_probe(text, text, text, text, text)
  TO service_role;

COMMENT ON FUNCTION public.record_known_brand_probe(text, text, text, text, text) IS
  'v348 (#1304): the one writer of a known-brands-discover probe result. Inserts a new row, fills an unprobed seeded row, or only stamps probed_at on any other row (curated contacts never overwritten). Always stamps probed_at — the discover worklist''s rotation guarantee.';
