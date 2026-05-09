-- Migration v120 — Postgres stuck-query watchdog RPCs
--
-- Incident 2026-05-09: a single ACNC-sweep backend hung for 20 hours holding
-- row locks on acnc_charities. PostgREST + GoTrue stalled behind it; the
-- entire site returned 504 MIDDLEWARE_INVOCATION_TIMEOUT for ~hours before
-- it was noticed. This migration exposes pg_stat_activity to the
-- postgres-stuck-query-watchdog Inngest cron (runs every 5 min) so the next
-- zombie is caught and Telegram-paged within 5 min, and optionally
-- auto-terminated at 60 min (gated by PG_WATCHDOG_AUTO_TERMINATE env flag).
--
-- Two SECURITY DEFINER functions, both service_role only — never anon/auth.
--
-- search_path = pg_catalog, public is required because pg_stat_activity and
-- pg_terminate_backend live in pg_catalog. Per CLAUDE.md: empty search_path
-- would hide these system relations from unqualified references.

create or replace function public.list_long_running_queries(min_minutes int)
returns table (
  pid               int,
  minutes           numeric,
  application_name  text,
  query_preview     text
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select pid,
         round(extract(epoch from (now() - query_start))::numeric / 60, 1) as minutes,
         application_name,
         left(query, 200) as query_preview
  from pg_stat_activity
  where state = 'active'
    and pid != pg_backend_pid()
    and now() - query_start > make_interval(mins => min_minutes)
    -- Routine maintenance — never alert on these.
    and query !~* '^(autovacuum|VACUUM|ANALYZE|REINDEX)';
$$;

comment on function public.list_long_running_queries(int) is
  'Returns active backends whose current query has run >= min_minutes. '
  'Used by the postgres-stuck-query-watchdog Inngest cron. Excludes '
  'autovacuum and other routine maintenance.';

revoke all on function public.list_long_running_queries(int) from public, anon, authenticated;
grant execute on function public.list_long_running_queries(int) to service_role;


create or replace function public.terminate_stuck_query(target_pid int)
returns boolean
language sql
security definer
set search_path = pg_catalog, public
as $$
  select pg_terminate_backend(target_pid);
$$;

comment on function public.terminate_stuck_query(int) is
  'Sends SIGTERM to the given backend pid. Returns true if the signal was '
  'sent (does not block on rollback completion). Service-role only — '
  'called by postgres-stuck-query-watchdog when a backend exceeds the '
  'auto-terminate threshold and PG_WATCHDOG_AUTO_TERMINATE=true.';

revoke all on function public.terminate_stuck_query(int) from public, anon, authenticated;
grant execute on function public.terminate_stuck_query(int) to service_role;
