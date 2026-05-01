// Weekly aggregation of Reddit-intel data for the Mon weekly email.
//
// Aggregates the last 7 days of reddit_intel_daily_summary into a single
// payload the email template can render. Also pulls top themes that have
// crossed the naming threshold so the email can show what's emerging.
//
// Kept in its own file (not in apps/web/lib/reddit-intel.ts which is added
// in the dashboard PR) to avoid merge conflicts when both PRs land in
// parallel — they're independent surfaces consuming the same schema.

import { createServiceClient } from "@askarthur/supabase/server";

export interface WeeklyRedditIntel {
  /** ISO date strings — first and last cohort included. */
  weekStart: string;
  weekEnd: string;
  /** Sum across all daily cohorts in the window. */
  totalPostsClassified: number;
  /** Most recent daily lead narrative (used as the email's hero). */
  latestLeadNarrative: string;
  /** Top categories aggregated across the week, sorted desc. */
  topCategories: Array<{ label: string; count: number }>;
  /** Top brands aggregated across the week, sorted desc. */
  topBrands: Array<{ brand: string; mentionCount: number }>;
  /** Up to 5 themes the most posts joined this week. */
  emergingThemes: Array<{
    title: string;
    narrative: string | null;
    memberCount: number;
    representativeBrands: string[];
  }>;
  /** Latest ≤140-char victim-quoted excerpt from this week's posts.
   *  Optional — may be null when no quotes were extracted. */
  scamOfTheWeekQuote: { text: string; speakerRole: string } | null;
  /** Identity strings for the email footer / debugging. */
  modelVersion: string;
  promptVersion: string;
}

const DAYS = 7;

export async function getWeeklyRedditIntel(): Promise<WeeklyRedditIntel | null> {
  const supabase = createServiceClient();
  if (!supabase) return null;

  const weekStartDate = new Date(Date.now() - DAYS * 86_400_000);
  const weekStart = weekStartDate.toISOString().slice(0, 10);
  const weekEnd = new Date().toISOString().slice(0, 10);

  // 1. Pull daily summaries in window.
  const { data: dailies, error: dailiesErr } = await supabase
    .from("reddit_intel_daily_summary")
    .select(
      "cohort_date, lead_narrative, stats, posts_classified, model_version, prompt_version",
    )
    .eq("audience", "internal")
    .is("country_code", null)
    .gte("cohort_date", weekStart)
    .lte("cohort_date", weekEnd)
    .order("cohort_date", { ascending: false });

  if (dailiesErr || !dailies || dailies.length === 0) return null;

  // 2. Aggregate categories + brands across cohorts.
  const catTotals: Record<string, number> = {};
  const brandTotals: Record<string, number> = {};
  let totalPosts = 0;

  for (const d of dailies) {
    const stats = d.stats as {
      totalPosts?: number;
      topCategories?: Record<string, number>;
      topBrands?: Record<string, number>;
    } | null;
    if (!stats) continue;
    totalPosts += stats.totalPosts ?? 0;
    for (const [k, v] of Object.entries(stats.topCategories ?? {})) {
      catTotals[k] = (catTotals[k] ?? 0) + v;
    }
    for (const [k, v] of Object.entries(stats.topBrands ?? {})) {
      brandTotals[k] = (brandTotals[k] ?? 0) + v;
    }
  }

  const topCategories = Object.entries(catTotals)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const topBrands = Object.entries(brandTotals)
    .map(([brand, mentionCount]) => ({ brand, mentionCount }))
    .sort((a, b) => b.mentionCount - a.mentionCount)
    .slice(0, 5);

  // 3. Top emerging themes — active themes with member_count gain in the
  //    last 7 days. Approximate by ordering by last_seen_at desc + filtering
  //    out "Pending naming".
  const { data: themes } = await supabase
    .from("reddit_intel_themes")
    .select(
      "title, narrative, member_count, representative_brands, last_seen_at",
    )
    .eq("is_active", true)
    .neq("title", "Pending naming")
    .gte("last_seen_at", weekStartDate.toISOString())
    .order("member_count", { ascending: false })
    .limit(5);

  const emergingThemes = (themes ?? []).map((t) => ({
    title: t.title as string,
    narrative: (t.narrative as string | null) ?? null,
    memberCount: (t.member_count as number) ?? 0,
    representativeBrands: (t.representative_brands as string[]) ?? [],
  }));

  // 4. Scam of the week — most recent extracted quote with confidence ≥ 0.7.
  const { data: quotes } = await supabase
    .from("reddit_intel_quotes")
    .select("quote_text, speaker_role, confidence")
    .gte("created_at", weekStartDate.toISOString())
    .gte("confidence", 0.7)
    .order("created_at", { ascending: false })
    .limit(1);

  const scamOfTheWeekQuote = quotes && quotes.length > 0 ? {
    text: quotes[0].quote_text as string,
    speakerRole: (quotes[0].speaker_role as string) ?? "unknown",
  } : null;

  return {
    weekStart,
    weekEnd,
    totalPostsClassified: totalPosts,
    latestLeadNarrative: dailies[0].lead_narrative as string,
    topCategories,
    topBrands,
    emergingThemes,
    scamOfTheWeekQuote,
    modelVersion: (dailies[0].model_version as string) ?? "",
    promptVersion: (dailies[0].prompt_version as string) ?? "",
  };
}
