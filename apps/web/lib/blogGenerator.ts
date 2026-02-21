import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "./logger";

interface ScamGroup {
  scam_type: string;
  impersonated_brand: string | null;
  count: number;
  summaries: string[];
  ids: number[];
}

interface GeneratedPost {
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  tags: string[];
  sourceScamIds: number[];
}

export async function generateWeeklyBlogPost(): Promise<GeneratedPost | null> {
  const supabase = createServiceClient();
  if (!supabase) return null;

  // Query verified scams from the past 7 days
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const { data: scams } = await supabase
    .from("verified_scams")
    .select("id, scam_type, summary, impersonated_brand, channel")
    .gte("created_at", oneWeekAgo.toISOString())
    .order("created_at", { ascending: false });

  if (!scams || scams.length === 0) return null;

  // Group by scam_type + impersonated_brand
  const groups = new Map<string, ScamGroup>();
  for (const scam of scams) {
    const key = `${scam.scam_type}:${scam.impersonated_brand || "none"}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count++;
      existing.ids.push(scam.id);
      if (existing.summaries.length < 3) {
        existing.summaries.push(scam.summary);
      }
    } else {
      groups.set(key, {
        scam_type: scam.scam_type,
        impersonated_brand: scam.impersonated_brand,
        count: 1,
        summaries: [scam.summary],
        ids: [scam.id],
      });
    }
  }

  // Select top 3 by frequency
  const topGroups = Array.from(groups.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  if (topGroups.length === 0) return null;

  // Generate blog post with Claude Haiku
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const client = new Anthropic();

  // Collect all source scam IDs from top groups
  const sourceScamIds = topGroups.flatMap((g) => g.ids);

  const scamData = topGroups
    .map(
      (g, i) =>
        `<scam_group id="${i + 1}" source_ids="${g.ids.join(",")}">\n  <type>${g.scam_type}</type>\n  <brand>${g.impersonated_brand || "N/A"}</brand>\n  <count>${g.count}</count>\n  <examples>${g.summaries.join(" | ")}</examples>\n</scam_group>`
    )
    .join("\n");

  const weekOf = new Date().toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    system: `You are a cybersecurity blog writer for Ask Arthur, an Australian scam detection platform. Write SEO-optimised blog posts about scam trends in Australia. Use Australian English. Write for a general audience — clear, helpful, not overly technical. Always include practical advice for readers.

GROUNDING RULES:
- Only reference scam data provided in the <scam_group> elements below. Do not invent statistics, percentages, or scam examples beyond what is provided.
- You may add general protective advice and context, but all specific scam details must come from the provided data.
- Do not fabricate quotes, case studies, or victim stories.`,
    messages: [
      {
        role: "user",
        content: `Write a weekly scam alert blog post based on these top scam trends detected this week (week of ${weekOf}):

${scamData}

Total scams detected this week: ${scams.length}

Return ONLY valid JSON:
{
  "title": "SEO-optimised title (under 70 chars)",
  "excerpt": "1-2 sentence summary for preview cards (under 160 chars)",
  "content": "Full markdown blog post (500-800 words). Include: intro, section per scam type with ## headings, how to protect yourself section, conclusion with link to askarthur.au",
  "tags": ["tag1", "tag2", "tag3"]
}`,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "{" }],
      },
    ],
  });

  const responseText =
    response.content[0].type === "text" ? response.content[0].text : "";
  const fullJson = "{" + responseText;
  const jsonMatch = fullJson.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]);

    // Generate slug from title
    const slug =
      `${new Date().toISOString().split("T")[0]}-` +
      parsed.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60);

    return {
      slug,
      title: parsed.title,
      excerpt: parsed.excerpt,
      content: parsed.content,
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      sourceScamIds,
    };
  } catch {
    logger.error("Failed to parse blog generation response");
    return null;
  }
}
