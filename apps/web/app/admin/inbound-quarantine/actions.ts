"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

// Per-action admin re-check — these mutate the public scam feed (promote a
// row to published=true makes it instantly visible at /scam-feed). The
// page also calls requireAdmin() but that gate doesn't protect a server
// action invoked via fetch from an authenticated-non-admin session.

export async function promoteRow(id: number): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const supabase = createServiceClient();
  if (!supabase) return { ok: false, error: "supabase_unavailable" };

  // Refuse to publish competitor-intel rows (v209, ADR-0021). These are
  // third-party editorial content ingested as intelligence only — republishing
  // them on the public /scam-feed is the copyright/trust exposure the category
  // exists to prevent. A `.neq("category", ...)` filter can't do this safely
  // because SQL `<>` also excludes the many legitimate NULL-category rows, so
  // we pre-check the row explicitly.
  const { data: row, error: readError } = await supabase
    .from("feed_items")
    .select("source, category")
    .eq("id", id)
    .maybeSingle();
  if (readError) {
    logger.error("inbound-quarantine promote read failed", { id, error: String(readError) });
    return { ok: false, error: readError.message };
  }
  if (!row) return { ok: false, error: "not_found" };
  if (row.category === "competitor_intel") {
    return { ok: false, error: "competitor_intel_never_publish" };
  }

  const { error } = await supabase
    .from("feed_items")
    .update({ published: true })
    .eq("id", id)
    .like("source", "inbound_%"); // scope guard: this action only promotes inbound rows

  if (error) {
    logger.error("inbound-quarantine promote failed", { id, error: String(error) });
    return { ok: false, error: error.message };
  }
  revalidatePath("/admin/inbound-quarantine");
  return { ok: true };
}

export async function deleteRow(id: number): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const supabase = createServiceClient();
  if (!supabase) return { ok: false, error: "supabase_unavailable" };

  // Delete only inbound_* + the well-known smoke-test row. The scope guard
  // protects against a stray id collision wiping a regulator scrape row.
  const { error } = await supabase
    .from("feed_items")
    .delete()
    .eq("id", id)
    .or("source.like.inbound_%,and(source.eq.reddit,title.eq.Pipeline smoke test from Claude)");

  if (error) {
    logger.error("inbound-quarantine delete failed", { id, error: String(error) });
    return { ok: false, error: error.message };
  }
  revalidatePath("/admin/inbound-quarantine");
  return { ok: true };
}
