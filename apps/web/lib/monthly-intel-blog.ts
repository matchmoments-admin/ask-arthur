import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { createServiceClient } from "@askarthur/supabase/server";
import { scrubPII } from "@askarthur/scam-engine/sanitize";
import { logger } from "@askarthur/utils/logger";
import { logCost, claudeSonnet46CostUsd } from "@/lib/cost-telemetry";
import { appendBlogCtaBlock } from "@/lib/blog-cta";

/**
 * Monthly intel blog — data layer + generator.
 *
 * Replaces the retired weekly-blog roundup (dead since 2026-05: empty
 * verified_scams 7-day windows made it a silent no-op every Monday). Instead
 * of one thin source, the monthly post mines every intel stream we operate:
 * Reddit narrative intel, competitor-newsletter observations (ADR-0021 —
 * intelligence only, never republish their prose), clone-watch monthly brand
 * stats, regulator feeds, and consumer scam reports.
 *
 * Grounding contract (same as the retired generator + weekly-synthesis):
 * every count the model may cite is code-derived here and passed in as
 * facts; the prompt forbids invented statistics. The model writes prose and
 * ranks ideas — it never does arithmetic.
 */

const MIN_REDDIT_CONFIDENCE = 0.4;
const REDDIT_FETCH_LIMIT = 3000;
const MODEL = "claude-sonnet-4-6";

interface LabelCount {
  label: string;
  count: number;
}

export interface MonthlyIntelFacts {
  periodMonth: string; // "YYYY-MM"
  reddit: {
    cohortSize: number;
    categories: LabelCount[];
    brands: LabelCount[];
    tactics: LabelCount[];
    noveltySignals: LabelCount[];
  };
  competitorObservations: Array<{
    title: string;
    scamType: string | null;
    brands: string[];
    novelty: string | null;
    summary: string | null;
  }>;
  cloneWatch: {
    totalClones: number;
    brandCount: number;
    reportedOnward: number;
    topBrands: Array<{ brand: string; clones: number; reported: number }>;
    weaponisedDomains: Array<{ domain: string; target: string | null; date: string }>;
  };
  regulatorAlerts: Array<{ source: string; title: string; date: string }>;
  consumerReports: {
    total: number;
    categories: LabelCount[];
    channels: LabelCount[];
    brands: LabelCount[];
  };
  existingCoverage: Array<{ slug: string; title: string }>;
}

function tally(values: Array<string | null | undefined>): LabelCount[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);
}

/**
 * Deterministically aggregate one calendar month of intel. All queries are
 * bounded (limits or pre-aggregated tables); aggregation happens in
 * TypeScript, matching the report-brand-stewardship precedent — lean SQL
 * surface, no PL/pgSQL gotchas.
 */
export async function collectMonthlyIntelFacts(
  startIso: string,
  endIso: string
): Promise<MonthlyIntelFacts | null> {
  const sb = createServiceClient();
  if (!sb) return null;

  const periodMonth = startIso.slice(0, 7);

  const [reddit, competitor, cloneStats, weaponised, regulator, consumer, coverage] =
    await Promise.all([
      sb
        .from("reddit_post_intel")
        .select("intent_label, brands_impersonated, tactic_tags, novelty_signals")
        .gte("processed_at", startIso)
        .lt("processed_at", endIso)
        .gte("confidence", MIN_REDDIT_CONFIDENCE)
        .limit(REDDIT_FETCH_LIMIT),
      sb
        .from("competitor_intel_observations")
        .select("scam_title, scam_type, brands, novelty, summary")
        .gte("extracted_at", startIso)
        .lt("extracted_at", endIso)
        .order("extracted_at", { ascending: false })
        .limit(40),
      sb
        .from("clone_watch_monthly_brand_stats")
        .select("brand, clones, reported_to_netcraft")
        .eq("period_month", `${periodMonth}-01`)
        .order("clones", { ascending: false }),
      sb
        .from("shopfront_clone_alerts")
        .select("candidate_domain, inferred_target_domain, weaponised_at")
        .gte("weaponised_at", startIso)
        .lt("weaponised_at", endIso)
        .order("weaponised_at", { ascending: false })
        .limit(25),
      sb
        .from("feed_items")
        .select("source, title, published_at, created_at")
        .in("source", [
          "scamwatch_alert",
          "acsc",
          "inbound_scamwatch",
          "inbound_wa_scamnet",
          "inbound_acma",
          "inbound_ato",
        ])
        .gte("created_at", startIso)
        .lt("created_at", endIso)
        .order("created_at", { ascending: false })
        .limit(30),
      sb
        .from("scam_reports")
        .select("scam_type, channel, impersonated_brand, verdict")
        .gte("created_at", startIso)
        .lt("created_at", endIso)
        .neq("verdict", "SAFE")
        .limit(2000),
      sb
        .from("blog_posts")
        .select("slug, title")
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(100),
    ]);

  const redditRows = reddit.data ?? [];
  const consumerRows = consumer.data ?? [];
  const cloneRows = cloneStats.data ?? [];

  return {
    periodMonth,
    reddit: {
      cohortSize: redditRows.length,
      categories: tally(
        redditRows
          .map((r) => r.intent_label as string | null)
          .filter((l) => l !== "informational" && l !== "other")
      ),
      brands: tally(redditRows.flatMap((r) => (r.brands_impersonated as string[] | null) ?? [])),
      tactics: tally(redditRows.flatMap((r) => (r.tactic_tags as string[] | null) ?? [])),
      noveltySignals: tally(
        redditRows.flatMap((r) => (r.novelty_signals as string[] | null) ?? [])
      ),
    },
    competitorObservations: (competitor.data ?? []).map((o) => ({
      title: o.scam_title as string,
      scamType: (o.scam_type as string | null) ?? null,
      brands: (o.brands as string[] | null) ?? [],
      novelty: (o.novelty as string | null) ?? null,
      summary: (o.summary as string | null) ?? null,
    })),
    cloneWatch: {
      totalClones: cloneRows.reduce((s, r) => s + ((r.clones as number) ?? 0), 0),
      brandCount: cloneRows.length,
      reportedOnward: cloneRows.reduce(
        (s, r) => s + ((r.reported_to_netcraft as number) ?? 0),
        0
      ),
      topBrands: cloneRows.slice(0, 15).map((r) => ({
        brand: r.brand as string,
        clones: (r.clones as number) ?? 0,
        reported: (r.reported_to_netcraft as number) ?? 0,
      })),
      weaponisedDomains: (weaponised.data ?? []).map((w) => ({
        domain: w.candidate_domain as string,
        target: (w.inferred_target_domain as string | null) ?? null,
        date: String(w.weaponised_at).slice(0, 10),
      })),
    },
    regulatorAlerts: (regulator.data ?? []).map((f) => ({
      source: f.source as string,
      title: f.title as string,
      date: String(f.published_at ?? f.created_at).slice(0, 10),
    })),
    consumerReports: {
      total: consumerRows.length,
      categories: tally(consumerRows.map((r) => r.scam_type as string | null)),
      channels: tally(consumerRows.map((r) => r.channel as string | null)),
      brands: tally(consumerRows.map((r) => r.impersonated_brand as string | null)),
    },
    existingCoverage: (coverage.data ?? []).map((p) => ({
      slug: p.slug as string,
      title: p.title as string,
    })),
  };
}

/** True when the month's data is too thin to write anything grounded. */
export function factsAreTooThin(facts: MonthlyIntelFacts): boolean {
  return (
    facts.reddit.cohortSize === 0 &&
    facts.cloneWatch.totalClones === 0 &&
    facts.regulatorAlerts.length === 0
  );
}

const IdeaSchema = z.object({
  title: z.string().min(5).max(200),
  angle: z.string().min(5),
  dataPoints: z.array(z.string()).min(1),
  targetKeyword: z.string().optional(),
});

const GenerationSchema = z.object({
  ideas: z.array(IdeaSchema).min(5).max(12),
  post: z.object({
    title: z.string().min(5).max(120),
    subtitle: z.string().max(200),
    excerpt: z.string().min(10).max(300),
    content: z.string().min(400),
    tags: z.array(z.string()).max(8),
    category: z.string(),
  }),
});

export interface MonthlyGeneratedPost {
  slug: string;
  title: string;
  subtitle: string;
  excerpt: string;
  content: string;
  tags: string[];
  category: string;
  readingTimeMinutes: number;
  ideas: z.infer<typeof IdeaSchema>[];
}

const VALID_CATEGORIES = ["scam-alerts", "guides", "news", "weekly-roundup"];

export async function generateMonthlyIntelPost(
  facts: MonthlyIntelFacts
): Promise<MonthlyGeneratedPost | null> {
  if (!process.env["ANTHROPIC_API_KEY"]) return null;

  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: `You are the content strategist and writer for Ask Arthur, an Australian scam-detection platform (askarthur.au). You are given ONE month of the platform's own intelligence data, already aggregated in code.

TASK: (1) propose the 10 best blog-post ideas from this data, ranked by unique-data advantage × Australian relevance × gap vs existing coverage; (2) write idea #1 as a complete post.

GROUNDING RULES (non-negotiable):
- Every number, count, domain and brand you mention MUST appear verbatim in the provided facts JSON. Do not invent statistics, victims, quotes or examples.
- Competitor observations describe what OTHER outlets reported — you may reference the scam pattern in your own words, but never quote or attribute their text (it is unpublishable intelligence).
- Do not duplicate a topic in the existing-coverage list; complementary follow-ups are fine but say what's new.
- Australian English, general audience, practical advice.

FORMATTING RULES for the post content (markdown):
- Use > [!WARNING], > [!TIP], > [!DANGER] blockquote callouts (they render as styled boxes).
- 900–1300 words. Start with a one-line **TL;DR:**. Use ## sections. Include one practical checklist section.
- No calls-to-action, sign-offs or askarthur.au links — a standard CTA block is appended automatically.
- category must be one of: scam-alerts, guides, news, weekly-roundup.`,
    messages: [
      {
        role: "user",
        content: `Facts for ${facts.periodMonth} (all counts code-derived from production data):

${JSON.stringify(facts, null, 1)}

Return ONLY valid JSON:
{
  "ideas": [{ "title": "...", "angle": "one sentence", "dataPoints": ["fact used"], "targetKeyword": "..." }, ... 10 items, best first],
  "post": { "title": "≤90 chars, SEO", "subtitle": "≤180 chars", "excerpt": "≤280 chars", "content": "full markdown post for ideas[0]", "tags": ["..."], "category": "scam-alerts" }
}`,
      },
      { role: "assistant", content: [{ type: "text", text: "{" }] },
    ],
  });

  const inputTokens = response.usage?.input_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;
  logCost({
    feature: "monthly_intel_blog",
    provider: "anthropic",
    operation: MODEL,
    units: inputTokens + outputTokens,
    estimatedCostUsd: claudeSonnet46CostUsd(inputTokens, outputTokens),
    metadata: { input_tokens: inputTokens, output_tokens: outputTokens },
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";
  const jsonMatch = ("{" + text).match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    logger.error("monthly-intel-blog: no JSON in model response");
    return null;
  }

  let parsed: z.infer<typeof GenerationSchema>;
  try {
    parsed = GenerationSchema.parse(JSON.parse(jsonMatch[0]));
  } catch (err) {
    logger.error("monthly-intel-blog: generation failed validation", {
      error: String(err),
    });
    return null;
  }

  const title = scrubPII(parsed.post.title);
  const content = appendBlogCtaBlock(scrubPII(parsed.post.content));
  const slug =
    `${facts.periodMonth}-` +
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);

  return {
    slug,
    title,
    subtitle: scrubPII(parsed.post.subtitle),
    excerpt: scrubPII(parsed.post.excerpt),
    content,
    tags: parsed.post.tags,
    category: VALID_CATEGORIES.includes(parsed.post.category)
      ? parsed.post.category
      : "scam-alerts",
    readingTimeMinutes: Math.max(1, Math.ceil(content.split(/\s+/).length / 200)),
    ideas: parsed.ideas,
  };
}
