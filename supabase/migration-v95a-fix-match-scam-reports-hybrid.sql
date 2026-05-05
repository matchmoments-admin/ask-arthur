-- v95a — match_scam_reports_hybrid hotfixes (id ambiguity + RRF aggregate).
--
-- v95 originally shipped two latent bugs in match_scam_reports_hybrid that
-- were only surfaced once PR #126 (similar-reports UI, 2026-05-05) wired
-- /scan/result to the function via /api/analyze/similar. Both fixes were
-- applied as separate hotfix migrations against prod
-- (`fix_match_scam_reports_hybrid_id_ambiguity`,
--  `fix_match_scam_reports_hybrid_rrf_aggregate`) on 2026-05-06; this
-- migration captures the consolidated final state in the repo so a
-- from-scratch apply pipeline produces the same function body as prod.
--
-- Bug 1 — id ambiguity (ERROR 42702):
--   The function declares `RETURNS TABLE (id bigint, …)`. PL/pgSQL puts
--   the OUT-parameter `id` in scope as a variable for the entire function
--   body. The `fused` CTE's inner UNION uses unqualified `id`:
--     select id from bm25 union select id from dense
--   Postgres can't decide whether `id` is the variable or the CTE column
--   and refuses to compile. Fix: `#variable_conflict use_column` directive
--   tells PL/pgSQL to prefer column references over variables on conflict,
--   matching every other reasonable interpretation.
--
-- Bug 2 — RRF aggregate (ERROR 42803):
--   Inside `fused as (select ids.id, max(b.r) as bm25_rank, …)`, the
--   rrf_score expression also referenced b.r and d.r:
--     coalesce(1.0 / (p_rrf_k + b.r), 0)
--   That's not in the GROUP BY, isn't aggregated, and doesn't match the
--   sibling `max(b.r)` in the same projection. Each ids.id joins to at
--   most one row in bm25 and one in dense (both CTEs emit unique ids),
--   so the canonical RRF formula 1/(k+rank) reduces to 1/(k+max(rank))
--   — wrap the references in max() to make the projection valid.
--
-- Idempotent — CREATE OR REPLACE FUNCTION. Applying this on a database
-- that has already run the prod hotfixes is a no-op (same body).
-- No dependent objects rely on the function signature so the replace is
-- transparent.

CREATE OR REPLACE FUNCTION public.match_scam_reports_hybrid(
  p_query_text       text,
  p_query_embedding  vector(1024),
  p_match_count      int  default 50,
  p_min_similarity   real default 0.50,
  p_since_days       int  default 30,
  p_rrf_k            int  default 60
) returns table (
  id                 bigint,
  scam_type          text,
  verdict            text,
  confidence_score   real,
  impersonated_brand text,
  channel            text,
  region             text,
  scrubbed_content   text,
  created_at         timestamptz,
  similarity         real,
  bm25_rank          int,
  dense_rank         int,
  rrf_score          real
)
language plpgsql stable
set search_path = public, pg_catalog
as $$
#variable_conflict use_column
declare
  v_query_tsq tsquery;
begin
  perform set_config('hnsw.ef_search', '80', true);

  -- plainto_tsquery is the safe variant — handles arbitrary user input
  -- without raising on punctuation. Empty / no-match query short-circuits
  -- to dense-only because the bm25 CTE returns zero rows.
  v_query_tsq := plainto_tsquery('english', coalesce(p_query_text, ''));

  return query
  with recency_window as (
    select r.id, r.scam_type, r.verdict, r.confidence_score,
           r.impersonated_brand, r.channel, r.region, r.scrubbed_content,
           r.created_at, r.embedding, r.body_tsv
    from public.scam_reports r
    where r.created_at >= now() - (p_since_days || ' days')::interval
      and r.verdict != 'SAFE'
  ),
  bm25 as (
    select
      w.id,
      row_number() over (order by ts_rank_cd(w.body_tsv, v_query_tsq) desc)::int as r
    from recency_window w
    where w.body_tsv @@ v_query_tsq
    order by ts_rank_cd(w.body_tsv, v_query_tsq) desc
    limit 50
  ),
  dense as (
    select
      w.id,
      (1 - (w.embedding <=> p_query_embedding))::real as sim,
      row_number() over (order by w.embedding <=> p_query_embedding asc)::int as r
    from recency_window w
    where w.embedding is not null
      and (1 - (w.embedding <=> p_query_embedding)) >= p_min_similarity
    order by w.embedding <=> p_query_embedding asc
    limit 50
  ),
  fused as (
    select
      ids.id,
      max(b.r) as bm25_rank,
      max(d.r) as dense_rank,
      coalesce(max(d.sim), 0)::real as similarity,
      (
        coalesce(1.0 / (p_rrf_k + max(b.r)), 0)
        +
        coalesce(1.0 / (p_rrf_k + max(d.r)), 0)
      )::real as rrf_score
    from (
      select id from bm25
      union
      select id from dense
    ) ids
    left join bm25  b on b.id = ids.id
    left join dense d on d.id = ids.id
    group by ids.id
  )
  select
    w.id,
    w.scam_type,
    w.verdict,
    w.confidence_score,
    w.impersonated_brand,
    w.channel,
    w.region,
    w.scrubbed_content,
    w.created_at,
    f.similarity,
    f.bm25_rank,
    f.dense_rank,
    f.rrf_score
  from fused f
  join recency_window w on w.id = f.id
  order by f.rrf_score desc
  limit p_match_count;
end;
$$;
