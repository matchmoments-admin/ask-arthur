import { z } from "zod";
import { createServiceClient } from "@askarthur/supabase/server";
import { callClaudeJson } from "@askarthur/scam-engine/anthropic";
import { scrubPII } from "@askarthur/scam-engine/sanitize";
import { logger } from "@askarthur/utils/logger";
import { logCost } from "@/lib/cost-telemetry";
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
    /** Month's detections by lifecycle_state — the honest detected→reported
     *  funnel (detected / monitoring / weaponised / reported / declined /
     *  taken_down) so the model can explain count gaps instead of glossing. */
    lifecycle: LabelCount[];
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

  const [reddit, competitor, cloneStats, weaponised, lifecycle, regulator, consumer, coverage] =
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
        .from("shopfront_clone_alerts")
        .select("lifecycle_state")
        .gte("created_at", startIso)
        .lt("created_at", endIso)
        .limit(5000),
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
      lifecycle: tally(
        (lifecycle.data ?? []).map((r) => r.lifecycle_state as string | null)
      ),
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

/**
 * Accept either the structured value or a JSON-encoded string of it. Even
 * with tool_choice-forced tool use, models sometimes stringify a large
 * nested field (the 2026-06 rerun returned `post` as a JSON string — the
 * whole run died on `expected object, received string`). The union is
 * representable in the tool's JSON Schema (anyOf), and the string branch
 * parses + re-validates against the real schema, so bad payloads still fail.
 */
function objectOrJsonString<T extends z.ZodType>(schema: T) {
  return z.union([
    schema,
    z
      .string()
      .transform((s, ctx) => {
        try {
          return JSON.parse(s) as unknown;
        } catch {
          ctx.addIssue({ code: "custom", message: "not valid JSON" });
          return z.NEVER;
        }
      })
      .pipe(schema),
  ]);
}

const PostSchema = z.object({
  title: z.string().min(5).max(120),
  subtitle: z.string().max(200),
  excerpt: z.string().min(10).max(300),
  content: z.string().min(400),
  tags: z.array(z.string()).max(8),
  category: z.string(),
});

// Exported for tests — validation runs inside callClaudeJson in production.
export const monthlyGenerationSchema = z.object({
  ideas: objectOrJsonString(z.array(IdeaSchema).min(5).max(12)),
  post: objectOrJsonString(PostSchema),
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

// Must stay in sync with the live `blog_categories` table slugs — an unknown
// value would write an orphaned category_slug that never joins, so the post
// renders with no category eyebrow. "news"/"weekly-roundup" were never real
// categories (fixed 2026-07-14). Falls back to "scam-alerts" below.
const VALID_CATEGORIES = [
  "scam-alerts",
  "guides",
  "intelligence",
  "product",
  "security",
  "compliance",
  "real-stories",
];

export async function generateMonthlyIntelPost(
  facts: MonthlyIntelFacts
): Promise<MonthlyGeneratedPost | null> {
  if (!process.env["ANTHROPIC_API_KEY"]) return null;

  // Tool-use-forced JSON via callClaudeJson — Anthropic guarantees the tool
  // input is a schema-valid object, eliminating the invalid-raw-JSON failure
  // the first canary hit (unescaped chars inside the long markdown `content`
  // string), and the helper never uses assistant prefill (Sonnet 4.6 rejects
  // it). Same wrapper weekly-synthesis uses in prod.
  let call;
  try {
    call = await callClaudeJson({
      model: "SONNET_4_6",
      maxTokens: 8000,
      timeoutMs: 120_000,
      schema: monthlyGenerationSchema,
      useToolUse: true,
      toolName: "submit_monthly_blog",
      requestId: `monthly-intel-blog-${facts.periodMonth}`,
      system: `You are the content strategist and writer for Ask Arthur, an Australian scam-detection platform (askarthur.au). You are given ONE month of the platform's own intelligence data, already aggregated in code.

TASK: (1) propose the 10 best blog-post ideas from this data, ranked by unique-data advantage × Australian relevance × gap vs existing coverage; (2) write idea #1 as a complete post.

GROUNDING RULES (non-negotiable):
- Every number, count, domain and brand you mention MUST appear verbatim in the provided facts JSON. Do not invent statistics, victims, quotes or examples.
- NEVER emit placeholder tokens like [NAME], [BRAND], [X] — always write the actual name from the facts. A placeholder is a hard failure.
- Competitor observations describe what OTHER outlets reported — you may reference the scam pattern in your own words, but never quote or attribute their text (it is unpublishable intelligence).
- Do not duplicate a topic in the existing-coverage list; complementary follow-ups are fine but say what's new.
- Australian English, general audience, practical advice.

HONESTY RULES for our own detection data (non-negotiable — we show our working):
- Detection counts are a FLOOR, not a total: write "our monitoring detected N", never "there are N". Our clone-watch scans newly registered domains against ~130 monitored brands; clones we don't detect exist.
- When you cite a detected count next to a smaller reported count, EXPLAIN the gap using the provided lifecycle facts. The funnel vocabulary: "detected" = lexical brand match on a new domain (many sit parked, not yet malicious); "monitoring" = we recheck it for changes; "weaponised" = it started serving live content; "reported" = submitted to takedown services with evidence; "declined" = the takedown service declined to act until the site turns visibly malicious (we keep watching); "taken_down" = confirmed gone. Not-yet-malicious parked domains and evidence requirements are the usual reasons a detection isn't reported the same day.
- Never claim or imply a takedown that isn't in the facts.
- Verifiability: when the post uses clone-watch data, tell readers the live aggregate numbers are publicly visible at https://askarthur.au/clone-watch — this is the one permitted askarthur.au link (the CTA block is still appended automatically; add nothing else).

FORMATTING RULES for the post content (markdown):
- Use > [!WARNING], > [!TIP], > [!DANGER], > [!NOTE] blockquote callouts (they render as styled boxes).
- 900–1300 words. Start with a one-line **TL;DR:**. Use ## sections. Include one practical checklist section.
- Enumerations render with proper markers: use "- " for bullet lists and "1." for numbered lists. Start each item with a bold lead-in ("**Term** — explanation") for scannability.
- Separate major sections with a "---" horizontal rule; it renders as a centred "· · ·" divider. Do NOT hand-space with blank lines — the blog CSS owns vertical rhythm.
- No calls-to-action, sign-offs or askarthur.au links — a standard CTA block is appended automatically.
- category must be one of the live blog_categories slugs: scam-alerts, guides, intelligence, product, security, compliance, real-stories.
- Respond ONLY by calling the submit_monthly_blog tool. "ideas" must be exactly 10 items, best first. Post title ≤90 chars; subtitle ≤180; excerpt ≤280.
- Tool input fields must be actual JSON structures — "post" is an object and "ideas" is an array, never JSON-encoded strings.`,
      user: `Facts for ${facts.periodMonth} (all counts code-derived from production data):

${JSON.stringify(facts, null, 1)}`,
    });
  } catch (err) {
    logger.error("monthly-intel-blog: generation failed validation", {
      error: String(err),
    });
    return null;
  }

  logCost({
    feature: "monthly_intel_blog",
    provider: "anthropic",
    operation: call.modelId,
    units: call.usage.inputTokens + call.usage.outputTokens,
    estimatedCostUsd: call.estimatedCostUsd,
    metadata: {
      input_tokens: call.usage.inputTokens,
      output_tokens: call.usage.outputTokens,
      cache_read_tokens: call.usage.cacheReadTokens,
    },
  });

  const parsed = call.result;

  // Placeholder guard — the first June draft shipped a literal "[NAME]" where
  // a brand belonged. Schema validation can't express this cleanly for the
  // tool-use JSON Schema, so enforce it here: any bracketed ALL-CAPS token in
  // user-facing fields fails the run loudly (Telegram warning at the caller).
  // (?!\() — don't flag ALL-CAPS markdown link text like "[ACCC](https://…)".
  // [!WARNING]-style callout markers never match ("!" fails the [A-Z] start).
  const PLACEHOLDER = /\[[A-Z][A-Z_ ]{0,24}\](?!\()/;
  const userFacing = [
    parsed.post.title,
    parsed.post.subtitle,
    parsed.post.excerpt,
    parsed.post.content,
  ].join("\n");
  if (PLACEHOLDER.test(userFacing)) {
    logger.error("monthly-intel-blog: draft contains placeholder token", {
      match: userFacing.match(PLACEHOLDER)?.[0],
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
