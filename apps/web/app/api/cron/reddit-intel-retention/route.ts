import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Daily retention scrub for Reddit Intelligence data.
 *
 * Schedule (vercel.json): 30 4 * * * (4:30am UTC daily — sits in a free
 * slot between bot-queue-cleanup at 4:00 and the next morning crons,
 * avoiding any stampede on the Supabase pooler).
 * Auth: Bearer CRON_SECRET, identical to other /api/cron/* routes.
 *
 * Two-stage policy per docs/plans/reddit-intel.md §6 and the F-13 ticket:
 *
 *   Stage 1 — 180 days (NULL out free-text fields on reddit_post_intel):
 *     * modus_operandi      (free text, can quote post details)
 *     * novelty_signals[]   (free text array, contains observed phrases)
 *     * narrative_summary   (free text, paraphrases the post)
 *     * take_tells / take_where / take_au_line (v301 — Arthur's Take free
 *       text; the row is also flipped to take_status='suppressed' so the
 *       public detail page stops rendering it)
 *   Structured columns (intent_label, confidence, brands_impersonated,
 *   victim_emotion, tactic_tags, country_hints, embedding) are RETAINED
 *   indefinitely — they're aggregable analysis, not derived narrative.
 *
 *   Stage 2 — 365 days (DELETE rows from reddit_intel_quotes):
 *     Quotes are verbatim ≤140-char excerpts from victim Reddit posts.
 *     Even though they're PII-scrubbed, they're the most direct mapping
 *     back to a real human's words — defensible to delete after a year.
 *
 * Themes (reddit_intel_themes) are NEVER expired. They're abstracted
 * cluster heads with no per-individual content.
 *
 * Conservative defaults vs the source brief's 90d / 180d:
 *   The brief proposed shorter windows. Plan doc (D7) chose
 *   180d / 365d so we can tighten later if needed without defending a
 *   deletion we regret. Subject to privacy-advisor review.
 */

const STAGE_1_DAYS = 180;
const STAGE_2_DAYS = 365;
const DELETE_CHUNK = 500;

export async function GET(req: Request) {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  const stage1Cutoff = new Date(
    Date.now() - STAGE_1_DAYS * 86_400_000,
  ).toISOString();
  const stage2Cutoff = new Date(
    Date.now() - STAGE_2_DAYS * 86_400_000,
  ).toISOString();

  let stage1Scrubbed = 0;
  let stage2Deleted = 0;

  try {
    // ── Stage 1: NULL out free-text fields on rows older than 180 days ──
    // Only rows where at least one free-text field is still non-null —
    // re-running is a no-op for already-scrubbed rows. Process in chunks
    // because supabase-js doesn't support correlated UPDATE limit.
    let stage1Cursor: string | null = null;
    while (true) {
      let q = supabase
        .from("reddit_post_intel")
        .select("id")
        .lt("processed_at", stage1Cutoff)
        .or(
          "modus_operandi.not.is.null,narrative_summary.not.is.null,take_where.not.is.null,take_au_line.not.is.null",
        )
        .order("id", { ascending: true })
        .limit(DELETE_CHUNK);

      if (stage1Cursor) q = q.gt("id", stage1Cursor);

      const { data: ids, error: selErr } = await q;
      if (selErr) {
        throw new Error(`stage1 select: ${selErr.message}`);
      }
      if (!ids || ids.length === 0) break;

      const idList = ids.map((r) => r.id as string);
      const { error: upErr } = await supabase
        .from("reddit_post_intel")
        .update({
          modus_operandi: null,
          novelty_signals: [],
          narrative_summary: null,
          // Arthur's Take free text (v301). Held to the same 180-day window as
          // the rest of the derived free text rather than kept indefinitely:
          // although a take is our own paraphrase and carries no identifying
          // detail by construction (the validator rejects amounts, handles,
          // emails and phone numbers before the write), it is still a
          // characterisation of one identifiable public post. Easier to relax
          // later than to defend a retention we cannot justify.
          //
          // take_tells is an array, so it is emptied rather than nulled — the
          // column is NOT NULL DEFAULT '{}'.
          take_tells: [],
          take_where: null,
          take_au_line: null,
          // The take is no longer renderable once its text is gone. Without
          // this the detail page would keep 200-ing on a row whose panel is
          // empty, because it gates on take_status rather than on content.
          take_status: "suppressed",
          take_suppressed_reason: "retention_180d",
        })
        .in("id", idList);

      if (upErr) {
        throw new Error(`stage1 update: ${upErr.message}`);
      }

      stage1Scrubbed += idList.length;
      stage1Cursor = idList[idList.length - 1];

      // Defensive break for tail batches.
      if (idList.length < DELETE_CHUNK) break;
    }

    // ── Stage 2: DELETE quotes older than 365 days ───────────────────────
    while (true) {
      const { data: ids, error: selErr } = await supabase
        .from("reddit_intel_quotes")
        .select("id")
        .lt("created_at", stage2Cutoff)
        .order("id", { ascending: true })
        .limit(DELETE_CHUNK);

      if (selErr) {
        throw new Error(`stage2 select: ${selErr.message}`);
      }
      if (!ids || ids.length === 0) break;

      const idList = ids.map((r) => r.id as string);
      const { error: delErr } = await supabase
        .from("reddit_intel_quotes")
        .delete()
        .in("id", idList);

      if (delErr) {
        throw new Error(`stage2 delete: ${delErr.message}`);
      }

      stage2Deleted += idList.length;

      if (idList.length < DELETE_CHUNK) break;
    }

    logger.info("reddit-intel-retention complete", {
      stage1Scrubbed,
      stage2Deleted,
      stage1Cutoff,
      stage2Cutoff,
    });

    return NextResponse.json({
      ok: true,
      stage1Scrubbed,
      stage2Deleted,
      stage1Cutoff,
      stage2Cutoff,
    });
  } catch (err) {
    logger.error("reddit-intel-retention failed", { error: String(err) });
    return NextResponse.json(
      {
        error: "retention_failed",
        message: String(err),
        stage1Scrubbed,
        stage2Deleted,
      },
      { status: 500 },
    );
  }
}
