"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

/**
 * The write half of the watchlist-candidate review queue.
 *
 * v187 shipped a status lifecycle for reddit_watchlist_candidates and nothing
 * ever wrote to it — 51 rows, all still 'pending' a month later, because the
 * only surface that displayed a candidate rendered its status read-only. These
 * actions are the missing writer.
 *
 * Per-action requireAdmin(): the page also gates, but a server action is
 * reachable by fetch from any authenticated session, so the page-level check
 * does not protect it.
 */

export type CandidateStatus = "pending" | "reviewed" | "dismissed";

const ALLOWED: readonly CandidateStatus[] = ["pending", "reviewed", "dismissed"];

export interface ActionResult {
  ok: boolean;
  error?: string;
  /** Rows the RPC actually changed. 0 = unknown brand, or already in state. */
  changed?: number;
}

/**
 * Move a candidate's status. `promoted` is deliberately NOT accepted here —
 * promotion means entering the live matcher watchlist, which requires resolved
 * legitimate_domains (without them the matcher alerts on the brand's own
 * website). That path lands with the promotion work; this surface only records
 * a human's triage decision.
 */
export async function setCandidateStatus(
  brandNormalized: string,
  status: CandidateStatus,
  note?: string,
): Promise<ActionResult> {
  await requireAdmin();

  if (!ALLOWED.includes(status)) {
    return { ok: false, error: "invalid_status" };
  }
  const key = brandNormalized.trim();
  if (!key) return { ok: false, error: "missing_brand" };

  const supabase = createServiceClient();
  if (!supabase) return { ok: false, error: "supabase_unavailable" };

  // .rpc() is untyped here (createServiceClient omits the <Database> generic),
  // so a wrong argument name fails at runtime as PGRST202, not at typecheck.
  const { data, error } = await supabase.rpc("set_watchlist_candidate_status", {
    p_brand_normalized: key,
    p_status: status,
    p_note: note?.trim() || null,
  });

  if (error) {
    logger.error("brand-candidates: status update failed", {
      brand: key,
      status,
      error: error.message,
    });
    return { ok: false, error: error.message };
  }

  const changed = typeof data === "number" ? data : 0;
  logger.info("brand-candidates: status updated", { brand: key, status, changed });
  revalidatePath("/admin/brand-candidates");
  return { ok: true, changed };
}
