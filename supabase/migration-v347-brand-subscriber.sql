-- v347 — Brand Subscriber: one record per paying brand, and what it unlocks (#1295)
--
-- WHY: a paying brand was identified five different ways (Stripe org_id,
-- monitored_brands.brand_normalized, brand_contact_directory.legitimate_domain,
-- known_brands.brand_domain, the store's primary domain). If a brand paid
-- before it had a monitored_brands row, the only thing that happened was a log
-- warning; monitored_brands.plan was telemetry, so a plan entitled the
-- customer to nothing.
--
-- Founder decisions (#1295 comment, 2026-10-13):
--   1. The monitored_brands row IS the Brand Subscriber — one row per
--      (org, Canonical Brand) carrying the legitimate domains, the alert
--      contact and a status. Billing stays on the org
--      (organizations.settings.brand_billing), because one Brand Monitor+
--      subscription covers up to 3 brands. The key is the ADR-0020 Canonical
--      Brand (brand_normalize of the alias-resolved name) — never deriveBrandKey.
--   2. Checkout creates a `pending` row BEFORE the Stripe session; the webhook
--      activates it. A payment with no matching row lands in an admin
--      "unmatched payment" queue, not a log line.
--   3. What a plan unlocks is checked by code — the entitlement Module
--      apps/web/lib/clone-watch/brand-subscriber.ts. The one place SQL repeats
--      that rule (the priority-rescan worklist below) is held to it by
--      apps/web/__tests__/brandSubscriberSql.test.ts, which enumerates every
--      status x verification x plan combination against the TS mapping.
--
-- Prod measured 2026-10-13: monitored_brands 0 rows, brand_billing 0 orgs.
-- Cold table, reshaped freely; every statement is idempotent and safe on 0 rows.
-- Nothing here is destructive (no DROP COLUMN / TABLE).

-- ── 1. The Brand Subscriber columns ──────────────────────────────────────
--
-- subscription_status is NULL for a row that is not a subscriber at all: the
-- house-org rows Ask Arthur watches on its own evidence (v256/v257). Those
-- stay matcher-overlay rows and are never entitled to anything.
ALTER TABLE public.monitored_brands
  ADD COLUMN IF NOT EXISTS subscription_status    text,
  ADD COLUMN IF NOT EXISTS billing_provider       text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS alert_contact_email    text,
  ADD COLUMN IF NOT EXISTS alert_contact_name     text,
  ADD COLUMN IF NOT EXISTS activated_at           timestamptz,
  ADD COLUMN IF NOT EXISTS canceled_at            timestamptz;

ALTER TABLE public.monitored_brands
  DROP CONSTRAINT IF EXISTS monitored_brands_subscription_status_check;
ALTER TABLE public.monitored_brands
  ADD CONSTRAINT monitored_brands_subscription_status_check
  CHECK (subscription_status IN ('pending', 'active', 'lapsed', 'canceled'));

ALTER TABLE public.monitored_brands
  DROP CONSTRAINT IF EXISTS monitored_brands_billing_provider_check;
ALTER TABLE public.monitored_brands
  ADD CONSTRAINT monitored_brands_billing_provider_check
  CHECK (billing_provider IN ('stripe', 'manual'));

-- A shape check, not validation: the checkout route validates with Zod. This
-- only stops an obviously broken value reaching the alert path.
ALTER TABLE public.monitored_brands
  DROP CONSTRAINT IF EXISTS monitored_brands_alert_contact_email_check;
ALTER TABLE public.monitored_brands
  ADD CONSTRAINT monitored_brands_alert_contact_email_check
  CHECK (alert_contact_email IS NULL OR alert_contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

-- The house org (v256) watches brands; it never subscribes.
ALTER TABLE public.monitored_brands
  DROP CONSTRAINT IF EXISTS monitored_brands_house_not_subscriber;
ALTER TABLE public.monitored_brands
  ADD CONSTRAINT monitored_brands_house_not_subscriber
  CHECK (
    org_id <> '00000000-0000-4000-8000-000000000001'::uuid
    OR subscription_status IS NULL
  );

-- An entitled status with no plan would entitle to "nothing in particular".
ALTER TABLE public.monitored_brands
  DROP CONSTRAINT IF EXISTS monitored_brands_entitled_needs_plan;
ALTER TABLE public.monitored_brands
  ADD CONSTRAINT monitored_brands_entitled_needs_plan
  CHECK (subscription_status NOT IN ('active', 'lapsed') OR plan IS NOT NULL);

-- The (org_id, brand_normalized) UNIQUE is v207's; assert it rather than
-- assume it (it is the arbiter the pending-row upsert relies on).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.monitored_brands'::regclass
      AND contype = 'u'
      AND conname = 'monitored_brands_org_id_brand_normalized_key'
  ) THEN
    ALTER TABLE public.monitored_brands
      ADD CONSTRAINT monitored_brands_org_id_brand_normalized_key
      UNIQUE (org_id, brand_normalized);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_monitored_brands_stripe_subscription
  ON public.monitored_brands (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

COMMENT ON COLUMN public.monitored_brands.subscription_status IS
  'v347 Brand Subscriber status: pending (checkout started, not paid) | active | lapsed (Stripe past_due/paused — dunning grace, entitlements kept) | canceled. NULL = not a subscriber (house-org watch rows). Entitlements: apps/web/lib/clone-watch/brand-subscriber.ts.';
COMMENT ON COLUMN public.monitored_brands.alert_contact_email IS
  'v347: the subscriber''s own alert contact. Outranks brand_contact_directory for this brand (directory = unsolicited outreach only). Every send to it passes the Brand Send Gate "subscriber" profile.';
COMMENT ON COLUMN public.monitored_brands.stripe_subscription_id IS
  'v347: the Stripe subscription that pays for this brand. Later webhook events (renewal, dunning, deletion) key on it, tamper-safe — never on metadata alone.';

COMMENT ON TABLE public.monitored_brands IS
  'The Brand Subscriber (v347, #1295): one row per (org, Canonical Brand) — legitimate domains, alert contact, subscription_status. Billing lives on the org (organizations.settings.brand_billing). Also holds the house-org watch rows (v256, subscription_status NULL). Only verified + active rows with a legitimate domain reach the matcher.';

-- ── 2. Unmatched payments ────────────────────────────────────────────────
--
-- A brand payment the webhook could not attach to a Brand Subscriber. Why a
-- new table and not an existing one: stripe_event_log (v70) is an idempotency
-- gate keyed on event id with no org, plan or reason; brand_billing is a
-- per-org jsonb blob that a missing/forged org cannot be written into; and no
-- billing exception queue exists. This is that queue, read by
-- /admin/brand-outreach. Cold (a row per failed attach, de-duplicated).
CREATE TABLE IF NOT EXISTS public.brand_unmatched_payments (
  id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stripe_subscription_id  text NOT NULL,
  stripe_customer_id      text,
  org_id                  uuid,
  brand_subscriber_id     bigint,
  plan                    text,
  billing_status          text,
  reason                  text NOT NULL CHECK (reason IN (
                            'missing_metadata',
                            'ownership_mismatch',
                            'unknown_org',
                            'no_subscriber_row'
                          )),
  first_seen_at           timestamptz NOT NULL DEFAULT now(),
  last_seen_at            timestamptz NOT NULL DEFAULT now(),
  seen_count              integer NOT NULL DEFAULT 1,
  resolved_at             timestamptz,
  resolved_note           text,
  UNIQUE (stripe_subscription_id, reason)
);

CREATE INDEX IF NOT EXISTS idx_brand_unmatched_payments_open
  ON public.brand_unmatched_payments (last_seen_at DESC)
  WHERE resolved_at IS NULL;

-- Service role only: no policy for anon/authenticated (v324 default grants
-- give them nothing; RLS is defence in depth).
ALTER TABLE public.brand_unmatched_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.brand_unmatched_payments FROM anon, authenticated;

COMMENT ON TABLE public.brand_unmatched_payments IS
  'v347 (#1295): brand payments the Stripe webhook could not attach to a Brand Subscriber (monitored_brands row). Shown on /admin/brand-outreach until resolved. One row per (subscription, reason); repeats bump last_seen_at/seen_count.';

CREATE OR REPLACE FUNCTION public.record_brand_unmatched_payment(
  p_stripe_subscription_id text,
  p_stripe_customer_id     text,
  p_org_id                 uuid,
  p_brand_subscriber_id    bigint,
  p_plan                   text,
  p_billing_status         text,
  p_reason                 text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $$
DECLARE
  v_id bigint;
BEGIN
  IF COALESCE(btrim(p_stripe_subscription_id), '') = '' THEN
    RAISE EXCEPTION 'stripe_subscription_id is required' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.brand_unmatched_payments AS u (
    stripe_subscription_id, stripe_customer_id, org_id, brand_subscriber_id,
    plan, billing_status, reason
  )
  VALUES (
    p_stripe_subscription_id, p_stripe_customer_id, p_org_id,
    p_brand_subscriber_id, p_plan, p_billing_status, p_reason
  )
  ON CONFLICT (stripe_subscription_id, reason) DO UPDATE SET
    last_seen_at   = pg_catalog.now(),
    seen_count     = u.seen_count + 1,
    billing_status = EXCLUDED.billing_status,
    -- A repeat after the operator resolved it is a NEW problem: reopen.
    resolved_at    = NULL,
    resolved_note  = NULL
  RETURNING u.id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_brand_unmatched_payment(text, text, uuid, bigint, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_brand_unmatched_payment(text, text, uuid, bigint, text, text, text)
  TO service_role;

-- ── 3. Checkout: the pending row, created BEFORE the Stripe session ──────
--
-- Outcomes: 'created' (new row), 'reopened' (an existing pending/canceled row
-- for the same org+brand, re-pointed at this checkout), 'already_subscribed'
-- (active/lapsed — the route answers 409 and starts no second subscription).
-- A row's domains are only replaced while it is unverified: once verified,
-- legitimate_domains is the matcher's exclusion list and a checkout form must
-- not be able to rewrite it.
CREATE OR REPLACE FUNCTION public.upsert_pending_brand_subscriber(
  p_org_id              uuid,
  p_brand_name          text,
  p_brand_normalized    text,
  p_primary_domain      text,
  p_plan                text,
  p_alert_contact_email text,
  p_created_by          uuid
)
RETURNS TABLE (brand_subscriber_id bigint, outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $$
#variable_conflict use_column
DECLARE
  v_row record;
  v_id  bigint;
BEGIN
  IF p_org_id = '00000000-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION 'the house org cannot subscribe' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(btrim(p_brand_normalized), '') = '' THEN
    RAISE EXCEPTION 'brand_normalized is required' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(btrim(p_primary_domain), '') = '' THEN
    RAISE EXCEPTION 'primary_domain is required' USING ERRCODE = '22023';
  END IF;

  SELECT mb.id, mb.subscription_status, mb.verification_status
  INTO v_row
  FROM public.monitored_brands mb
  WHERE mb.org_id = p_org_id AND mb.brand_normalized = p_brand_normalized
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.monitored_brands (
      org_id, brand_name, brand_normalized, legitimate_domains,
      verification_method, plan, subscription_status, billing_provider,
      alert_contact_email, created_by
    )
    VALUES (
      p_org_id, btrim(p_brand_name), p_brand_normalized,
      ARRAY[lower(btrim(p_primary_domain))],
      'manual', p_plan, 'pending', 'stripe',
      NULLIF(lower(btrim(p_alert_contact_email)), ''), p_created_by
    )
    RETURNING id INTO v_id;
    brand_subscriber_id := v_id;
    outcome := 'created';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_row.subscription_status IN ('active', 'lapsed') THEN
    brand_subscriber_id := v_row.id;
    outcome := 'already_subscribed';
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE public.monitored_brands mb SET
    brand_name          = btrim(p_brand_name),
    plan                = p_plan,
    subscription_status = 'pending',
    billing_provider    = 'stripe',
    alert_contact_email = COALESCE(NULLIF(lower(btrim(p_alert_contact_email)), ''), mb.alert_contact_email),
    legitimate_domains  = CASE
                            WHEN mb.verification_status = 'verified' THEN mb.legitimate_domains
                            ELSE ARRAY[lower(btrim(p_primary_domain))]
                          END,
    canceled_at         = NULL,
    is_active           = TRUE,
    updated_at          = pg_catalog.now()
  WHERE mb.id = v_row.id;

  brand_subscriber_id := v_row.id;
  outcome := 'reopened';
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_pending_brand_subscriber(uuid, text, text, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_pending_brand_subscriber(uuid, text, text, text, text, text, uuid)
  TO service_role;

-- ── 4. Webhook: apply a Stripe subscription state to its Brand Subscriber(s)
--
-- Matches rows of THIS org that are either the row checkout created
-- (p_brand_subscriber_id, from server-set metadata) or rows already carrying
-- this Stripe subscription (renewals, dunning, a Plus plan's other brands).
-- A row already bound to a DIFFERENT live subscription is never hijacked.
-- Deletion passes p_brand_subscriber_id NULL, so it is keyed on the stored
-- subscription id alone (tamper-safe, as the brand_billing branch is).
--
-- Status transition (the semantics the webhook had before v347, kept):
--   billing active            -> active (activated_at set once)
--   billing canceled          -> canceled (canceled_at)
--   billing past_due / paused -> lapsed, but ONLY from active/lapsed: a pending
--                                row whose first payment failed stays pending
--                                (before v347, plan was only ever SET on active).
-- Returns the number of rows matched; 0 is the caller's "unmatched payment".
CREATE OR REPLACE FUNCTION public.apply_brand_subscription(
  p_org_id                 uuid,
  p_brand_subscriber_id    bigint,
  p_stripe_subscription_id text,
  p_plan                   text,
  p_billing_status         text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $$
DECLARE
  v_n integer;
BEGIN
  IF p_billing_status NOT IN ('active', 'past_due', 'paused', 'canceled') THEN
    RAISE EXCEPTION 'invalid billing status %', p_billing_status USING ERRCODE = '22023';
  END IF;
  IF COALESCE(btrim(p_stripe_subscription_id), '') = '' THEN
    RAISE EXCEPTION 'stripe_subscription_id is required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.monitored_brands mb SET
    subscription_status = CASE
      WHEN p_billing_status = 'active'   THEN 'active'
      WHEN p_billing_status = 'canceled' THEN 'canceled'
      WHEN mb.subscription_status IN ('active', 'lapsed') THEN 'lapsed'
      ELSE mb.subscription_status
    END,
    -- An unpaid pending row keeps the plan it was created with; any other
    -- transition takes the plan Stripe is billing.
    plan = CASE
      WHEN p_billing_status IN ('past_due', 'paused')
       AND mb.subscription_status NOT IN ('active', 'lapsed') THEN mb.plan
      ELSE COALESCE(p_plan, mb.plan)
    END,
    billing_provider       = 'stripe',
    stripe_subscription_id = p_stripe_subscription_id,
    activated_at = CASE
      WHEN p_billing_status = 'active' THEN COALESCE(mb.activated_at, pg_catalog.now())
      ELSE mb.activated_at
    END,
    canceled_at = CASE
      WHEN p_billing_status = 'canceled' THEN pg_catalog.now()
      WHEN p_billing_status = 'active'   THEN NULL
      ELSE mb.canceled_at
    END,
    updated_at = pg_catalog.now()
  WHERE mb.org_id = p_org_id
    AND mb.subscription_status IS NOT NULL
    AND (
      mb.stripe_subscription_id = p_stripe_subscription_id
      OR (
        p_brand_subscriber_id IS NOT NULL
        AND mb.id = p_brand_subscriber_id
        AND (
          mb.stripe_subscription_id IS NULL
          OR mb.subscription_status IN ('pending', 'canceled')
        )
      )
    );
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_brand_subscription(uuid, bigint, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_brand_subscription(uuid, bigint, text, text, text)
  TO service_role;

-- ── 5. Priority rescan worklist ──────────────────────────────────────────
--
-- The daily priority rescan an entitled subscriber's live lookalikes get.
-- A SEPARATE worklist, deliberately not a change to
-- list_clone_alerts_for_recheck (two open PRs, v343/v344, redefine that body).
-- The recheck lane reads it inside its existing dns-gate-and-submit step and
-- puts these rows at the head of the SAME urlscan cap — no new spend, no new
-- Inngest step.
--
-- Entitlement predicate (mirror of entitlementsFor().priorityRescan; drift
-- test in brandSubscriberSql.test.ts): is_active, verified, plan set,
-- subscription_status active or lapsed.
--
-- Population: the recheck lane's (NRD, monitoring/declined, not dead-dormant
-- — the v326 predicate, change together) with NO 90-day age cap: a paying
-- brand's old lookalike is still its lookalike. A lookalike belongs to the
-- subscriber when its Canonical Brand key matches OR its inferred target
-- domain is one of the subscriber's legitimate domains.
--
-- Due: last urlscan recheck older than p_cadence_hours, NULL first (COALESCE —
-- a never-rechecked row must not vanish into a NULL comparison). Worklist
-- rotation: the lane's mark_clone_alerts_rechecked stamp on every attempted
-- row moves it out of this predicate for p_cadence_hours.
CREATE OR REPLACE FUNCTION public.list_brand_subscriber_priority_rescans(
  p_limit         integer DEFAULT 45,
  p_cadence_hours integer DEFAULT 24
)
RETURNS TABLE (
  id                      bigint,
  candidate_domain        text,
  candidate_url           text,
  lifecycle_state         text,
  last_rechecked_at       timestamptz,
  first_seen_at           timestamptz,
  recheck_dns_fingerprint text,
  brand_subscriber_id     bigint,
  due_total               bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s'
AS $$
  WITH subs AS (
    SELECT mb.id AS sub_id, mb.brand_normalized, mb.legitimate_domains
    FROM public.monitored_brands mb
    WHERE mb.is_active
      AND mb.verification_status = 'verified'
      AND mb.plan IS NOT NULL
      AND mb.subscription_status IN ('active', 'lapsed')
  ),
  due AS (
    SELECT DISTINCT ON (sca.id)
      sca.id, sca.candidate_domain, sca.candidate_url, sca.lifecycle_state,
      sca.last_rechecked_at, sca.first_seen_at, sca.recheck_dns_fingerprint,
      s.sub_id
    FROM public.shopfront_clone_alerts sca
    JOIN subs s
      ON sca.target_brand_normalized = s.brand_normalized
      OR sca.inferred_target_domain = ANY (s.legitimate_domains)
    WHERE sca.source = 'nrd'
      AND sca.lifecycle_state IN ('monitoring', 'declined')
      AND NOT (
        sca.urlscan_uuid IS NULL
        AND sca.urlscan_failure_streak >= 8
        AND COALESCE(sca.urlscan_evidence ->> 'status', '') = '400'
      )
      AND COALESCE(sca.last_rechecked_at, '-infinity'::timestamptz)
          < pg_catalog.now() - pg_catalog.make_interval(hours => GREATEST(1, p_cadence_hours))
    ORDER BY sca.id, s.sub_id
  )
  SELECT d.id, d.candidate_domain, d.candidate_url, d.lifecycle_state,
         d.last_rechecked_at, d.first_seen_at, d.recheck_dns_fingerprint,
         d.sub_id, pg_catalog.count(*) OVER ()
  FROM due d
  ORDER BY d.last_rechecked_at ASC NULLS FIRST, d.id ASC
  LIMIT GREATEST(0, LEAST(p_limit, 200));
$$;

REVOKE ALL ON FUNCTION public.list_brand_subscriber_priority_rescans(integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_brand_subscriber_priority_rescans(integer, integer)
  TO service_role;

COMMENT ON FUNCTION public.list_brand_subscriber_priority_rescans(integer, integer) IS
  'v347 (#1295): live lookalikes (NRD monitoring/declined, not dead-dormant, any age) of entitled Brand Subscribers whose last urlscan recheck is older than p_cadence_hours (default 24), NULL first. Read by clone-watch-lifecycle-recheck, which scans them first inside its existing cap. due_total counted before the LIMIT.';
