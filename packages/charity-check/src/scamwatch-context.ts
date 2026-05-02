// Scamwatch alert join — surfaces recent Scamwatch alerts mentioning
// the charity name. Reads from the existing `feed_items` table (populated
// by pipeline/scrapers/scamwatch_rss.py).
//
// IMPORTANT: this is a CONTEXT signal, NOT a pillar / score input.
// Scamwatch alerts often describe the impersonator (e.g. "scammers
// pretending to be the Red Cross") — flagging the legitimate Red Cross
// because of those alerts would be a high-rate false positive. We
// surface them for the verdict screen's collapsible section so the user
// can see the context, but the scorer doesn't see them.

import { logger } from "@askarthur/utils/logger";
import { createServiceClient } from "@askarthur/supabase/server";

import type { ScamwatchAlertContext } from "./types";

/** Look up the most recent Scamwatch alerts mentioning the charity name.
 *
 * Best-effort: failure returns null (caller treats as "no context").
 * Window: last 365 days. Limit: top 5 most recent matches.
 *
 * Match strategy: simple ILIKE on title + description. Trigram match
 * would be more sophisticated but feed_items doesn't currently have a
 * trigram index, and the false-positive cost is just a UI display, not
 * a verdict change. */
export async function loadScamwatchContext(
  charityName: string,
): Promise<ScamwatchAlertContext | null> {
  if (!charityName || charityName.trim().length < 3) return null;

  const supa = createServiceClient();
  if (!supa) return null;

  const oneYearAgoIso = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  const pattern = `%${charityName.trim()}%`;

  try {
    const { data, error } = await supa
      .from("feed_items")
      .select("title, url, source_created_at")
      .eq("source", "scamwatch")
      .or(`title.ilike.${pattern},description.ilike.${pattern}`)
      .gte("source_created_at", oneYearAgoIso)
      .order("source_created_at", { ascending: false })
      .limit(5);

    if (error) {
      logger.warn("scamwatch context query failed", { error: error.message });
      return null;
    }

    const rows = data ?? [];
    if (rows.length === 0) return null;

    return {
      count: rows.length,
      recent: rows.map((r) => ({
        title: r.title as string,
        url: (r.url as string) ?? "",
        publishedAt: (r.source_created_at as string | null) ?? null,
      })),
    };
  } catch (err) {
    logger.warn("scamwatch context threw", { error: String(err) });
    return null;
  }
}
