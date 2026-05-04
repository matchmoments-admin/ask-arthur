-- migration-v95-hybrid-search.sql
-- Wire match_scam_reports_hybrid for the post-verdict "12 Australians
-- reported similar messages this week" surface (W1.2 of the learning-loop
-- plan). Today, match_scam_reports (v89) does pure-vector cosine NN with
-- no caller. Pure cosine over voyage-3.5 lands ~62% precision in published
-- benchmarks; adding BM25 + RRF lifts that to ~84% before the reranker
-- stage runs (Anthropic Contextual Retrieval study + ParadeDB / Voyage
-- 2025 benchmarks).
--
-- Two-stage retrieval shape that callers should follow:
--   Stage 1: match_scam_reports_hybrid → top 50 by RRF(BM25 ∪ dense)
--   Stage 2: voyage rerank-2.5-lite over the 50 → top 5 with relevance ≥ 0.4
--
-- Mechanism in this RPC:
--   * BM25 leg uses Postgres ts_rank_cd over a generated tsvector column.
--     Generated columns (Postgres 12+) keep the lexical index in sync
--     without a trigger.
--   * Dense leg reuses the existing scam_reports.embedding HNSW index
--     created in v89 — no new dense index needed.
--   * Reciprocal Rank Fusion: per-doc score = 1/(k+rank). k=60 is the
--     industry-standard constant from Cormack/Clarke/Buettcher 2009.
--   * Filters mirror match_scam_reports: SAFE excluded, recency window
--     applied, embedding NOT NULL on the dense side. Empty query string
--     short-circuits to dense-only (legitimate — caller may have only an
--     embedding for an image-mode scan).
--
-- Why not ParadeDB / pg_textsearch: those provide true BM25 ranking which
-- is theoretically superior to ts_rank_cd, but require Postgres extension
-- enablement on Supabase. ts_rank_cd is "good enough" — the reranker stage
-- carries most of the precision lift (Anthropic's measured contribution:
-- BM25+dense+rerank → 67% reduction in retrieval failures vs 49% w/o
-- rerank). Revisit if the reranker is consistently re-ordering low-rank
-- BM25 hits to the top.
--
-- Idempotent: alter table add column if not exists, create index if not
-- exists, create or replace function. Re-applying is a no-op.

begin;

-- ── Generated tsvector for BM25-style lexical retrieval ────────────────────
-- 'english' config gives stop-word removal + Porter stemming. AU-English
-- variants ("organise" / "organize") collapse via stemming so we don't lose
-- recall on Australian spelling. coalesce on scrubbed_content because some
-- legacy rows have NULL content (only the verdict stored).
--
-- STORED rather than VIRTUAL because we want the GIN index to read the
-- precomputed tsvector instead of recomputing on every query.

alter table public.scam_reports
  add column if not exists body_tsv tsvector
    generated always as (to_tsvector('english', coalesce(scrubbed_content, ''))) stored;

create index if not exists idx_scam_reports_body_tsv
  on public.scam_reports using gin (body_tsv);

-- BRIN on created_at — cheap (~kB) and lets the planner combine the
-- recency filter with either tsv@@query or the HNSW probe efficiently.
-- HNSW indexes don't natively combine with WHERE created_at filters at
-- large scale, so a coarse BRIN gives the planner an extra tool.
create index if not exists idx_scam_reports_created_brin
  on public.scam_reports using brin (created_at);

-- ── Hybrid retrieval RPC ───────────────────────────────────────────────────
-- BM25 ∪ dense, fused with Reciprocal Rank Fusion (k=60). Returns top
-- p_match_count rows with the same column shape as match_scam_reports
-- so callers can swap one for the other transparently. Adds rrf_score
-- and per-leg ranks for diagnostics.

create or replace function public.match_scam_reports_hybrid(
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
declare
  v_query_tsq tsquery;
begin
  perform set_config('hnsw.ef_search', '80', true);

  -- plainto_tsquery is the safe variant — it handles arbitrary user input
  -- without raising on punctuation. Empty query short-circuits to dense-
  -- only by setting a never-matching tsquery, which the bm25 CTE will
  -- return zero rows for.
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
        coalesce(1.0 / (p_rrf_k + b.r), 0)
        +
        coalesce(1.0 / (p_rrf_k + d.r), 0)
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

revoke all on function public.match_scam_reports_hybrid(
  text, vector(1024), int, real, int, int
) from public;

grant execute on function public.match_scam_reports_hybrid(
  text, vector(1024), int, real, int, int
) to authenticated, service_role;

comment on function public.match_scam_reports_hybrid(
  text, vector(1024), int, real, int, int
) is
  'Hybrid BM25 + dense cosine retrieval over scam_reports. RRF-fuses the '
  'two leg rankings (k=60). Returns columns compatible with '
  'match_scam_reports plus diagnostics. Caller should embed the query with '
  'embedQuery() and rerank the top 50 with voyage-rerank-2.5-lite.';

commit;
