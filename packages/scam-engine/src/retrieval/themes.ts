// getRelevantThemes — surfaces the top-K Reddit-intel themes whose
// centroid is closest to the user's submission text. Output is fed
// into the Haiku system prompt at analyze time so the classifier can
// name a known scam pattern (e.g. "PayID 'relative will collect'")
// instead of having to derive it from scratch each call.
//
// Pipeline:
//   1. embedQuery(text, generic) → 1024-dim Voyage 3.5 query vector
//   2. match_themes_by_centroid(vec, k, minSim, minSignalStrength)
//      → up to K themes ranked by cosine similarity
//
// Cost shape per call: ~$0.000003 (one Voyage embedQuery on a typical
// 50-token submission). Cached for 10 minutes by the embedding cache
// (same SHA-256(text) keying as the analyze pipeline).
//
// Failure mode: any throw is caught and converted to []. The themes
// surface is decorative — the Haiku call works fine without it.
// Logged at warn level so an outage shows up in the dashboard without
// taking the analyze flow down.

import { embedQuery, type EmbedResult } from "../embeddings";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

export interface RelevantTheme {
  id: string;
  slug: string;
  title: string;
  narrative: string | null;
  modusOperandi: string | null;
  representativeBrands: string[];
  /** Top social-engineering tactics aggregated across the theme's posts
   *  (v186). The most transferable signal across brand/channel variation. */
  topTacticTags: string[];
  signalStrength: "noise" | "weak" | "strong";
  memberCount: number;
  similarity: number;
}

export interface GetRelevantThemesOptions {
  /** Top-K to return. Default 3. */
  k?: number;
  /** Minimum cosine similarity threshold. Default 0.45. */
  minSimilarity?: number;
  /** Minimum signal strength. Default "weak". */
  minSignalStrength?: "noise" | "weak" | "strong";
  /** Correlation id for log traces. */
  requestId?: string;
}

interface ThemeRow {
  id: string;
  slug: string;
  title: string;
  narrative: string | null;
  modus_operandi: string | null;
  representative_brands: string[] | null;
  top_tactic_tags: string[] | null;
  signal_strength: "noise" | "weak" | "strong";
  member_count: number;
  similarity: number;
}

/**
 * Fetch up to `k` themes whose cluster centroid is closest to the embed
 * of `text`. Returns [] for empty inputs, when Supabase is unconfigured,
 * or on any retrieval error.
 *
 * Never throws — themes are decorative; failing the analyze flow over a
 * RAG outage would be a regression.
 */
export async function getRelevantThemes(
  text: string,
  opts: GetRelevantThemesOptions = {},
): Promise<RelevantTheme[]> {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  const {
    k = 3,
    minSimilarity = 0.45,
    minSignalStrength = "weak",
    requestId,
  } = opts;

  const supabase = createServiceClient();
  if (!supabase) {
    logger.warn("getRelevantThemes: supabase service client unavailable", {
      requestId,
    });
    return [];
  }

  try {
    const embedResult = await embedQuery([trimmed], { requestId });
    void logEmbedCost(embedResult, requestId);
    const queryVec = embedResult.vectors[0];
    if (!queryVec) return [];

    const { data, error } = await supabase.rpc("match_themes_by_centroid", {
      p_query_embedding: queryVec,
      p_match_count: k,
      p_min_similarity: minSimilarity,
      p_min_signal_strength: minSignalStrength,
    });

    if (error) {
      logger.warn("getRelevantThemes: RPC failed", {
        error: error.message,
        requestId,
      });
      return [];
    }

    const rows = (data ?? []) as ThemeRow[];
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      narrative: r.narrative,
      modusOperandi: r.modus_operandi,
      representativeBrands: r.representative_brands ?? [],
      topTacticTags: r.top_tactic_tags ?? [],
      signalStrength: r.signal_strength,
      memberCount: r.member_count,
      similarity: r.similarity,
    }));
  } catch (err) {
    logger.warn("getRelevantThemes: unexpected error", {
      error: String(err),
      requestId,
    });
    return [];
  }
}

/**
 * Render a list of themes as a system-prompt-ready Markdown block.
 * Returns an empty string when the list is empty so the caller can
 * unconditionally template it in.
 *
 * Format (kept terse — Haiku context is precious):
 *
 *   RECENT AUSTRALIAN SCAM PATTERNS (last 30 days, community-reported):
 *   - "PayID 'relative will collect'": <narrative>. Targets: PayID, ANZ.
 *     Modus operandi: <modus_operandi>
 *   - ...
 */
export function renderThemesForPrompt(themes: RelevantTheme[]): string {
  if (themes.length === 0) return "";
  const lines: string[] = [
    "",
    "RECENT AUSTRALIAN SCAM PATTERNS (last 30 days, community-reported):",
  ];
  for (const t of themes) {
    const brands =
      t.representativeBrands.length > 0
        ? ` Targets: ${t.representativeBrands.slice(0, 3).join(", ")}.`
        : "";
    const narrative = t.narrative ? ` ${t.narrative}` : "";
    const modus = t.modusOperandi
      ? `\n  Modus operandi: ${t.modusOperandi}`
      : "";
    const tactics =
      t.topTacticTags.length > 0
        ? `\n  Common tactics: ${t.topTacticTags.slice(0, 4).join(", ")}`
        : "";
    lines.push(`- "${t.title}":${narrative}${brands}${modus}${tactics}`);
  }
  lines.push(
    "If the user's message matches one of these patterns, name it in the summary using the title above.",
  );
  return lines.join("\n");
}

// Fire-and-forget cost telemetry. Themes is the decorative pre-analyze
// pathway — failing to write a cost row must never block the analyze
// flow, so we swallow + warn-log on failure. Cache hits emit a free row
// (totalTokens=0) so retrieval call volume is visible in the dashboard
// independent of Voyage billing.
async function logEmbedCost(
  result: EmbedResult,
  requestId: string | undefined,
): Promise<void> {
  try {
    const supabase = createServiceClient();
    if (!supabase) return;
    await supabase.from("cost_telemetry").insert({
      feature: "themes-retrieval",
      provider: result.provider,
      operation: "embeddings.create",
      units: result.totalTokens,
      estimated_cost_usd: result.estimatedCostUsd,
      metadata: {
        model: result.modelId,
        domain: result.domain,
        total_tokens: result.totalTokens,
        request_id: requestId,
      },
    });
  } catch (err) {
    logger.warn("themes: logEmbedCost failed", {
      error: String(err),
      requestId,
    });
  }
}
