"use server";

import { revalidatePath } from "next/cache";

import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

import { requireAdmin } from "@/lib/adminAuth";

/**
 * Review actions for Arthur's Take.
 *
 * This queue is not a nicety. The validator that gates a take before it is
 * written provably cannot detect two classes of identifying content — personal
 * names, and bare handles with no sigil — because neither is distinguishable
 * from ordinary prose to a pattern match. A human reviewer is the compensating
 * control, and `pii` / `unsafe_wording` are the kill switch.
 *
 * Every action re-checks admin. The page checks too, but a server action is
 * reachable by fetch from any authenticated session, so the page-level gate
 * does not protect it.
 */

export type ReviewVerdict =
  | "agree"
  | "wrong_type"
  | "not_a_scam"
  | "unsafe_wording"
  | "pii";

/** Verdicts that pull a live take down immediately, before anything else. */
const SUPPRESSING_VERDICTS = new Set<ReviewVerdict>(["pii", "unsafe_wording"]);

export interface ActionResult {
  ok: boolean;
  error?: string;
  suppressed?: boolean;
}

export async function recordReview(
  intelId: string,
  verdict: ReviewVerdict,
  correctedLabel?: string | null,
): Promise<ActionResult> {
  await requireAdmin();

  const supabase = createServiceClient();
  if (!supabase) return { ok: false, error: "supabase_unavailable" };

  const { error: insErr } = await supabase
    .from("reddit_post_intel_reviews")
    .insert({
      intel_id: intelId,
      verdict,
      corrected_label: correctedLabel ?? null,
      reviewer: "admin",
    });

  if (insErr) {
    logger.error("arthurs-take review insert failed", {
      intelId,
      verdict,
      error: insErr.message,
    });
    return { ok: false, error: "insert_failed" };
  }

  if (!SUPPRESSING_VERDICTS.has(verdict)) {
    revalidatePath("/admin/arthurs-take");
    return { ok: true, suppressed: false };
  }

  // Take it down. The text is cleared as well as the status flipped: leaving
  // content we have just judged unpublishable in a column, behind a status
  // that happens to hide it, is one gating change away from being published.
  const { error: upErr } = await supabase
    .from("reddit_post_intel")
    .update({
      take_status: "suppressed",
      take_suppressed_reason: `review_${verdict}`,
      take_tells: [],
      take_where: null,
      take_au_line: null,
    })
    .eq("id", intelId);

  if (upErr) {
    // The review is already recorded, so the reviewer's judgement is not lost
    // — but the take is still live, and that is the part that matters.
    logger.error("arthurs-take suppression failed AFTER review recorded", {
      intelId,
      verdict,
      error: upErr.message,
    });
    return { ok: false, error: "suppress_failed" };
  }

  // Always-ship warn: a human pulling a live take down is rare and high-value,
  // and INFO is sampled at 10%.
  logger.warn("arthurs-take: take suppressed by reviewer", {
    intelId,
    verdict,
  });

  revalidatePath("/admin/arthurs-take");
  return { ok: true, suppressed: true };
}

/**
 * Restore a take suppressed by review. Deliberately narrow: it only reverses a
 * `review_*` suppression, never one the validator made — undoing an automated
 * content refusal from a UI button is not a decision this queue should offer.
 */
export async function restoreTake(intelId: string): Promise<ActionResult> {
  await requireAdmin();

  const supabase = createServiceClient();
  if (!supabase) return { ok: false, error: "supabase_unavailable" };

  const { data: row, error: readErr } = await supabase
    .from("reddit_post_intel")
    .select("take_suppressed_reason")
    .eq("id", intelId)
    .maybeSingle();

  if (readErr) return { ok: false, error: "read_failed" };
  if (!row) return { ok: false, error: "not_found" };

  const reason = (row.take_suppressed_reason as string | null) ?? "";
  if (!reason.startsWith("review_")) {
    return { ok: false, error: "not_review_suppressed" };
  }

  // The text was cleared on suppression and is not recoverable here, so the
  // row goes back to `failed` — the state the generator retries — rather than
  // to `ready` with nothing in it.
  const { error: upErr } = await supabase
    .from("reddit_post_intel")
    .update({ take_status: "failed", take_suppressed_reason: null })
    .eq("id", intelId);

  if (upErr) return { ok: false, error: "restore_failed" };

  logger.warn("arthurs-take: suppressed take queued for regeneration", {
    intelId,
  });
  revalidatePath("/admin/arthurs-take");
  return { ok: true };
}
