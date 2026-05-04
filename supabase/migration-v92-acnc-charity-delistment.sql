-- migration-v92-acnc-charity-delistment.sql
-- Track when an ACNC charity disappears from the source CKAN register so
-- the consumer Charity Check feature can flag "delisted" charities as
-- HIGH_RISK rather than silently treat the row as still valid.
--
-- Why this matters: today, if ACNC delists a fraudulent charity (e.g.
-- the regulator strips registration after a complaint), the ABN row in
-- acnc_charities just stops getting updated — it's not removed and not
-- flagged. /charity-check would still say "registered = true" because
-- the row exists. That's a false-positive risk on a consumer-trust
-- surface. v92 closes the gap.
--
-- Mechanism: scraper tracks every ABN it sees in a fresh CKAN pull,
-- updates last_seen_in_register=NOW() for those, then runs a single
-- UPDATE that sets is_delisted=true for any row whose last_seen_in_register
-- predates the start of this run. Re-listed charities (ABNs that come
-- back) get is_delisted=false and delisted_at=NULL on the next run.
--
-- Idempotent: ALTER TABLE ... IF NOT EXISTS, partial indexes are CREATE
-- INDEX IF NOT EXISTS. Re-running is safe.

-- ── Schema additions ────────────────────────────────────────────────────

alter table public.acnc_charities
  add column if not exists is_delisted          boolean     not null default false,
  add column if not exists last_seen_in_register timestamptz,
  add column if not exists delisted_at           timestamptz;

-- No backfill of last_seen_in_register. The sweep filter is
-- `is_delisted = false AND (last_seen_in_register IS NULL OR < run_started_at)`
-- and only runs after a successful scrape that produced rows (`if rows and
-- status != 'error':` in scrape()). The first successful scrape after this
-- migration touches every ABN currently in CKAN — so NULLs only persist on
-- rows that genuinely aren't in the source, which is exactly the delistment
-- signal we want. We tried a backfill `update ... set last_seen_in_register
-- = updated_at` initially but it timed out on Supabase's statement-timeout
-- ceiling at 63k rows. Letting the scraper own the field is simpler and
-- correct.

-- Partial index on is_delisted = true. Most queries want active charities;
-- the partial index keeps live planner stats sharp without bloating a
-- column that is overwhelmingly false.
create index if not exists idx_acnc_charities_delisted
  on public.acnc_charities (is_delisted)
  where is_delisted = true;

-- BRIN on last_seen_in_register — near-free on insert/update, supports the
-- scraper's "rows with stale last_seen" sweep. BRIN is the right choice
-- here because the column is naturally append-mostly under the new write
-- pattern (NOW() bumps it forward).
create index if not exists idx_acnc_charities_last_seen_brin
  on public.acnc_charities using brin (last_seen_in_register);

-- ── search_charities RPC: surface is_delisted ──────────────────────────
-- Replace the function to add is_delisted to the return shape. Delisted
-- charities still appear in autocomplete (they may match a name the user
-- is typing) but the consumer UI now has the signal it needs to render
-- them with a "DELISTED" badge instead of "VERIFIED".

create or replace function public.search_charities(
  p_query text,
  p_limit int default 8
) returns table (
  abn                 text,
  charity_legal_name  text,
  town_city           text,
  state               text,
  charity_website     text,
  is_delisted         boolean,
  similarity_score    real
)
language sql stable
set search_path = public, pg_catalog
as $$
  select
    abn,
    charity_legal_name,
    town_city,
    state,
    charity_website,
    is_delisted,
    greatest(
      similarity(charity_legal_name, p_query),
      case when charity_legal_name ilike p_query || '%' then 1.0 else 0.0 end
    )::real as similarity_score
  from public.acnc_charities
  where charity_legal_name ilike p_query || '%'
     or charity_legal_name % p_query
  order by similarity_score desc, charity_legal_name asc
  limit p_limit;
$$;

revoke all on function public.search_charities(text, int) from public;
grant execute on function public.search_charities(text, int) to anon, authenticated, service_role;

comment on column public.acnc_charities.is_delisted is
  'True when the ABN was not present in the most recent CKAN pull AND was previously seen. Set by pipeline/scrapers/acnc_register.py after each run. Re-listed charities (ABN reappears) get this flipped back to false.';

comment on column public.acnc_charities.last_seen_in_register is
  'Timestamp of the most recent scrape run in which this ABN appeared in the CKAN datastore. Used by the scraper to identify rows that have disappeared from the source.';

comment on column public.acnc_charities.delisted_at is
  'When is_delisted first transitioned from false→true. Persists across re-listings — i.e. if a charity is delisted, then re-listed, then delisted again, this records the most recent delistment.';
