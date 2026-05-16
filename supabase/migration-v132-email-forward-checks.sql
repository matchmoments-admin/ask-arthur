-- migration-v132-email-forward-checks.sql
--
-- Adds the storage table for user-forwarded "is this a scam?" emails. Users
-- forward a suspicious email to check@askarthur-inbound.com; the Cloudflare
-- Email Worker resolves the tag and POSTs the parsed payload to the
-- /api/inbound-email-check Vercel route, which calls analyzeWithClaude(),
-- stores the verdict here, and sends an HTML reply via Resend.
--
-- This table is intentionally separate from feed_items: forward-checks are
-- one-off interactions with a single sender (not feed items for the public
-- /scam-feed), and the analytics shape (per-sender rate limit, reply
-- success/failure) is different from feed ingestion.
--
-- Idempotency: external_id is a hash of the inbound Message-ID. Cloudflare
-- can re-deliver during retries; the UNIQUE constraint short-circuits
-- duplicates without paying for a second Claude call.
--
-- Cost brake: rows here drive both the per-sender daily count (rate limit)
-- and the feature-wide spend cap. Cost is written by the API route after
-- the Claude call returns; null means "request received, analysis not yet
-- completed (or failed)".

CREATE TABLE IF NOT EXISTS public.email_forward_checks (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_id TEXT NOT NULL,
  from_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_md TEXT,
  url TEXT,
  -- Inbound timestamp from the original email (parsed by the Worker), not
  -- the row-insert time. Lets us reconstruct the queue latency from email
  -- send → reply for the cost dashboard.
  received_at TIMESTAMPTZ NOT NULL,
  -- Analysis output. Verdict mirrors the AnalysisResult enum used in
  -- /api/analyze so the cost dashboard can union both feeds.
  verdict TEXT CHECK (verdict IS NULL OR verdict IN ('SAFE', 'UNCERTAIN', 'SUSPICIOUS', 'HIGH_RISK')),
  verdict_confidence NUMERIC(4, 3),
  reasoning TEXT,
  -- Per-row cost in USD. Sum of Claude (Haiku 4.5) + Resend. Written after
  -- the API route completes; null means we never finished the analysis.
  cost_usd NUMERIC(10, 6),
  -- Reply state — when did we send the reply, and did it fail?
  reply_sent_at TIMESTAMPTZ,
  reply_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Idempotency: same Cloudflare Email Routing delivery never doubles up.
  CONSTRAINT email_forward_checks_external_id_uniq UNIQUE (external_id)
);

-- Per-sender rate-limit lookup: "how many emails has this sender sent in
-- the last 24h?" The daily-count check in the API route runs on every
-- inbound, so this index has to be cheap. BTREE on (from_email, created_at
-- DESC) is the standard "find recent rows per key" shape.
CREATE INDEX IF NOT EXISTS idx_email_forward_checks_from_recent
  ON public.email_forward_checks (from_email, created_at DESC);

-- Cost-dashboard scan: "how much have we spent today / this week on this
-- feature?" Partial index excludes the rows where cost wasn't written
-- (failed analyses), which is the same shape the cost-telemetry view uses.
CREATE INDEX IF NOT EXISTS idx_email_forward_checks_cost_recent
  ON public.email_forward_checks (created_at DESC)
  WHERE cost_usd IS NOT NULL;

-- RLS: service-role-only. No public read; no anon insert. The API route
-- holds the service-role key. RLS is enabled with no policies, which
-- denies-by-default to anon / authenticated roles (PostgREST enforces RLS
-- on those roles; service-role bypasses RLS by design).
ALTER TABLE public.email_forward_checks ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.email_forward_checks IS
  'User-forwarded suspicious emails sent to check@askarthur-inbound.com. '
  'Written by the /api/inbound-email-check route after analyzeWithClaude. '
  'Idempotent by external_id; per-sender rate limited via from_email index.';
