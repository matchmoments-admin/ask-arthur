"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import {
  getActiveWatchlist,
  invalidateActiveWatchlistCache,
} from "@askarthur/scam-engine/active-watchlist";
import {
  brandNormalize,
  buildBrandMultiResolver,
  buildWatchedKeySet,
} from "@askarthur/shopfront-glue";
import { loadAliasRecord } from "@/lib/brand-aliases";
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

export type CandidateStatus =
  | "pending"
  | "reviewed"
  | "dismissed"
  /**
   * Not a brand at all — a name the scammer invented, or a description rather
   * than a name. Distinct from `dismissed` ("a real brand we chose not to
   * watch") because the two must not be reversible on the same terms: new
   * evidence can justify revisiting a dismissal, but no volume of reports makes
   * a fabricated entity into a brand with a domain to protect. v291.
   */
  | "not_a_brand";

const ALLOWED: readonly CandidateStatus[] = [
  "pending",
  "reviewed",
  "dismissed",
  "not_a_brand",
];

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

/**
 * Promote a candidate onto the live matcher watchlist.
 *
 * The domain is REQUIRED and is typed by a human. It is deliberately not
 * inferred from the brand name: `legitimate_domains` is the matcher's
 * EXCLUSION list, so a wrong entry does not cause a missed alert — it creates
 * a permanent blind spot, because a squatter-held `<brand>.com.au` recorded as
 * legitimate is exactly the domain we would stop reporting.
 *
 * One RPC, one transaction: monitored_brands and the candidate's status move
 * together. Split apart, a failure between them leaves a brand that is
 * monitored AND re-announced weekly as unwatched.
 */
export async function promoteCandidate(
  brandNormalized: string,
  brandName: string,
  domainsRaw: string,
  aliasesRaw?: string,
): Promise<ActionResult> {
  await requireAdmin();

  const key = brandNormalized.trim();
  const name = brandName.trim();
  if (!key || !name) return { ok: false, error: "missing_brand" };

  const domains = domainsRaw
    .split(/[\s,]+/)
    .map((d) => d.trim())
    .filter(Boolean);
  if (domains.length === 0) return { ok: false, error: "domain_required" };

  const aliases = (aliasesRaw ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);

  const supabase = createServiceClient();
  if (!supabase) return { ok: false, error: "supabase_unavailable" };

  // GUARD — never promote a brand that is ALREADY watched under a different key.
  //
  // promote_watchlist_candidate upserts on (org_id, brand_normalized), so
  // promoting the leaked "NAB (National Australia Bank)" candidate would insert
  // an overlay row keyed `nabnationalaustraliabank` entirely separate from the
  // static `NAB` entry: a duplicate brand, `nab.com.au` recorded twice, and a
  // matcher token no squatter will ever register. Worse, promotion moves the
  // candidate to 'promoted', so the digest goes quiet — the leak would LOOK
  // fixed while nothing improved. Same shape as the v224 recheck incident.
  //
  // This check CANNOT live in the RPC. The static AU_BRAND_WATCHLIST is a
  // TypeScript array; `monitored_brands` holds only the overlay (0 rows today),
  // so a SQL guard would see nothing and NAB would sail past it while the guard
  // read as protection. getActiveWatchlist() is the only thing that sees both.
  //
  // THE TWO HALVES FAIL DIFFERENTLY, so they are handled separately rather than
  // wrapped in one try/catch that implies a uniform guarantee:
  //
  //   getActiveWatchlist() degrades to the STATIC list and never throws
  //     (active-watchlist.ts: a null/empty overlay returns staticOnly), so the
  //     exact-key half is always armed. NAB is on the static list.
  //
  //   loadAliasRecord() never throws EITHER — by contract it logs and returns
  //     whatever loaded, which for this single-page table means `{}` on any
  //     error. That is the trap: an empty alias map makes the fragment half
  //     silently resolve NOTHING, so the guard would wave through the very
  //     brand it exists to stop while looking like it ran. `brand_aliases` has
  //     ~311 rows and is never legitimately empty, so an empty map is read as
  //     UNAVAILABLE and the promotion is blocked. Fail closed, and only where
  //     failing closed is actually achievable.
  let watched: ReadonlySet<string>;
  let aliasPairs: Record<string, string>;
  try {
    [watched, aliasPairs] = await Promise.all([
      getActiveWatchlist().then(buildWatchedKeySet),
      loadAliasRecord(supabase, "brand-candidates-promote"),
    ]);
  } catch (e) {
    logger.error("brand-candidates: duplicate guard unavailable", {
      brand: key,
      error: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, error: "watchlist_unavailable_retry" };
  }

  if (Object.keys(aliasPairs).length === 0) {
    logger.error("brand-candidates: alias layer empty, cannot check duplicates", {
      brand: key,
    });
    return { ok: false, error: "alias_layer_unavailable_retry" };
  }

  const resolveMulti = buildBrandMultiResolver(aliasPairs);
  const normalizedKey = brandNormalize(key);
  const hit =
    (normalizedKey && watched.has(normalizedKey) ? normalizedKey : null) ??
    [...resolveMulti(name), ...resolveMulti(key)]
      .map((c) => brandNormalize(c))
      .find((k) => k && watched.has(k));
  if (hit) {
    logger.warn("brand-candidates: promotion blocked, already watched", {
      brand: key,
      watchedAs: hit,
    });
    return {
      ok: false,
      error:
        `already_watched: "${name}" resolves to a brand already on the ` +
        `watchlist (${hit}). Promoting would create a duplicate entry. ` +
        `Mark it reviewed instead — the label leaked past the gate.`,
    };
  }

  const { error } = await supabase.rpc("promote_watchlist_candidate", {
    p_brand_normalized: key,
    p_brand_name: name,
    p_domains: domains,
    p_aliases: aliases,
    p_note: `Promoted from the admin queue (${domains.join(", ")}).`,
    p_source: "admin",
  });

  if (error) {
    logger.error("brand-candidates: promotion failed", {
      brand: key,
      error: error.message,
    });
    return { ok: false, error: error.message };
  }

  logger.warn("brand-candidates: brand promoted to the live watchlist", {
    brand: name,
    domains,
  });
  // The overlay read is cached (60s TTL) to keep it off the checkout hot path.
  // This clears THIS instance's copy; other serverless instances converge
  // within the TTL. So a promotion is live everywhere inside 60s, not
  // instantly — see the scope note in @askarthur/scam-engine/active-watchlist.
  invalidateActiveWatchlistCache();
  revalidatePath("/admin/brand-candidates");
  return { ok: true, changed: 1 };
}

/** Reverse a promotion — deactivates the overlay row and returns the candidate
 *  to pending. Exists so the response to a bad promotion is a click, not
 *  hand-written SQL. */
export async function demoteCandidate(
  brandNormalized: string,
): Promise<ActionResult> {
  await requireAdmin();
  const key = brandNormalized.trim();
  if (!key) return { ok: false, error: "missing_brand" };

  const supabase = createServiceClient();
  if (!supabase) return { ok: false, error: "supabase_unavailable" };

  const { data, error } = await supabase.rpc("demote_watchlist_candidate", {
    p_brand_normalized: key,
    p_note: "Promotion reverted from the admin queue.",
  });
  if (error) {
    logger.error("brand-candidates: demotion failed", {
      brand: key,
      error: error.message,
    });
    return { ok: false, error: error.message };
  }

  logger.warn("brand-candidates: promotion reverted", { brand: key });
  // Same reason as promote. Note the honest bound: other instances stop
  // matching the brand within the 60s TTL, not on this click.
  invalidateActiveWatchlistCache();
  revalidatePath("/admin/brand-candidates");
  return { ok: true, changed: typeof data === "number" ? data : 0 };
}
