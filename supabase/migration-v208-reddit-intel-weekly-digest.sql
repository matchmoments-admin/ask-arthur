-- v208 — reddit_intel_weekly_digest
--        (Track B of docs/plans/weekly-intel-dynamic.md)
--
-- WHY: the Monday "Ask Arthur Intel" email read `reddit_intel_themes` ranked by
-- CUMULATIVE member_count. The greedy clusterer collapsed into a single 2000+
-- member attractor sink (see the plan doc's Diagnosis), so the email surfaced the
-- same one theme every week — "[1 emerging scam this week]" was literally always
-- the same scam. The fix: compute "emerging this week" as a pure function of THIS
-- week's classified posts via a weekly Sonnet synthesis, persisted here so the
-- email render is a pure idempotent read and the dashboard / B2B can consume the
-- same canonical object.
--
-- One row per weekly digest. Service-role only — the synthesis engine
-- (packages/scam-engine) writes it; the weekly-email cron + dashboard read it.
-- Idempotent: re-running synthesis for the same window overwrites (get-or-create).
-- Tiny table (~52 rows/year); no hot-path writes, no large index needed.

CREATE TABLE IF NOT EXISTS public.reddit_intel_weekly_digest (
  -- Start of the rolling 7-day window the digest covers (= run date − 7d).
  -- Doubles as the PK, so get-or-create dedupes re-runs on the same run date.
  week_start            date        NOT NULL,
  week_end              date        NOT NULL,

  -- Cohort size the synthesis ran over (posts classified in the 7-day window).
  cohort_post_count     integer     NOT NULL DEFAULT 0,

  -- The ranked "emerging this week" stories. Array of:
  --   { rank, title, narrative, category, representativeBrands[],
  --     noveltySignal: 'new'|'rising'|'ongoing', weeklyReportCount }
  -- weeklyReportCount is code-derived (deterministic category count), never
  -- model-invented — anti-FUD: quantify before adjective. The pull-quote lives
  -- once in scam_of_the_week, not per-story.
  stories               jsonb       NOT NULL DEFAULT '[]'::jsonb,

  -- Deterministic aggregates for the email stats card + "by the numbers" /
  -- "brands impersonated" sentences. Shapes mirror reddit_intel_daily_summary:
  --   top_brands:      [{ brand, mentionCount }]
  --   top_categories:  [{ label, count }]
  top_brands            jsonb       NOT NULL DEFAULT '[]'::jsonb,
  top_categories        jsonb       NOT NULL DEFAULT '[]'::jsonb,

  -- Brands / tactics observed this week that were ABSENT from the trailing
  -- baseline window — the genuinely dynamic novelty signal. { brands[], tactics[] }.
  novelty               jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- Optional pull-quote for the "Scam of the week" callout. { text, speakerRole }.
  scam_of_the_week      jsonb,

  -- Provenance for the email debug strip + prompt-regression triage.
  model_version         text        NOT NULL DEFAULT '',
  prompt_version        text        NOT NULL DEFAULT '',

  generated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT reddit_intel_weekly_digest_pkey PRIMARY KEY (week_start)
);

COMMENT ON TABLE public.reddit_intel_weekly_digest IS
  'One row per ISO week: LLM-synthesised "emerging this week" scam stories over that week''s reddit_post_intel cohort. Canonical source for the weekly email + dashboard. See docs/plans/weekly-intel-dynamic.md (Track B).';

-- RLS: deny-all to anon/authenticated; service_role bypasses RLS so the engine
-- and cron (both service-client) read/write freely. Matches the other
-- reddit_intel_* internal tables.
ALTER TABLE public.reddit_intel_weekly_digest ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "weekly_digest_no_public_access"
  ON public.reddit_intel_weekly_digest;
CREATE POLICY "weekly_digest_no_public_access"
  ON public.reddit_intel_weekly_digest
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);
