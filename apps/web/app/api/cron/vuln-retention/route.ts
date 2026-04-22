import { NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Nightly prune of vulnerability_detections rows older than 180 days.
 *
 * Schedule (vercel.json): 0 3 * * * (3am UTC daily — off-peak for all users).
 * Auth: Bearer CRON_SECRET matching the other /api/cron/* routes.
 *
 * Safety filter (per plan — belt-and-suspenders against over-eager deletes):
 * only prunes detections for vulnerabilities that are BOTH:
 *   - not in critical_vulnerabilities_au (the admin-facing view of what still
 *     matters — anything in KEV, high-CVSS, or AU-context-tagged stays)
 *   - not cisa_kev (defence-in-depth; the view should already exclude these)
 *   - not exploited_in_wild (same reasoning)
 *
 * This means a vuln that becomes critical AFTER the 180-day mark still keeps
 * its full detection history. The cost is roughly linear in the number of
 * stale detections; we log the delete count so growth is visible.
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  const cutoff = new Date(Date.now() - 180 * 86400 * 1000).toISOString();

  // We can't express the "vuln_id NOT IN (view) AND NOT cisa_kev AND NOT exploited"
  // shape purely in postgREST filters, so call a dedicated RPC if present;
  // otherwise fall back to a two-step fetch-then-delete. The RPC is added in a
  // follow-up migration once we're confident in the query shape; for now the
  // two-step is fine at our current volume.
  let deleted = 0;
  try {
    const { data: eligible, error: eligibleError } = await supabase
      .from("vulnerability_detections")
      .select("id, vuln_id")
      .lt("detected_at", cutoff)
      .limit(10_000);

    if (eligibleError) {
      throw new Error(`eligible query: ${eligibleError.message}`);
    }

    const eligibleIds = (eligible ?? []).map((r) => r.id as number);
    const eligibleVulnIds = Array.from(
      new Set((eligible ?? []).map((r) => r.vuln_id as number)),
    );

    if (eligibleIds.length === 0) {
      return NextResponse.json({ ok: true, deleted: 0, cutoff });
    }

    // Figure out which vuln_ids MUST be preserved (critical / KEV / in-wild).
    const { data: preserveRows, error: preserveError } = await supabase
      .from("vulnerabilities")
      .select("id")
      .in("id", eligibleVulnIds)
      .or("cisa_kev.eq.true,exploited_in_wild.eq.true");

    if (preserveError) {
      throw new Error(`preserve query: ${preserveError.message}`);
    }

    const preserveVulnIds = new Set(
      (preserveRows ?? []).map((r) => r.id as number),
    );

    // Also preserve everything currently in the critical_vulnerabilities_au view.
    const { data: criticalRows } = await supabase
      .from("critical_vulnerabilities_au")
      .select("id")
      .in("id", eligibleVulnIds);
    for (const r of criticalRows ?? []) {
      preserveVulnIds.add(r.id as number);
    }

    const toDelete = (eligible ?? [])
      .filter((r) => !preserveVulnIds.has(r.vuln_id as number))
      .map((r) => r.id as number);

    if (toDelete.length === 0) {
      return NextResponse.json({
        ok: true,
        deleted: 0,
        eligibleCount: eligibleIds.length,
        preservedCount: preserveVulnIds.size,
        cutoff,
      });
    }

    // Delete in chunks of 500 so we don't trip Supabase's IN-list size cap.
    const CHUNK = 500;
    for (let i = 0; i < toDelete.length; i += CHUNK) {
      const chunk = toDelete.slice(i, i + CHUNK);
      const { error: delError } = await supabase
        .from("vulnerability_detections")
        .delete()
        .in("id", chunk);
      if (delError) {
        throw new Error(`delete chunk: ${delError.message}`);
      }
      deleted += chunk.length;
    }

    logger.info("vuln-retention prune complete", {
      deleted,
      eligibleCount: eligibleIds.length,
      preservedCount: preserveVulnIds.size,
      cutoff,
    });

    return NextResponse.json({
      ok: true,
      deleted,
      eligibleCount: eligibleIds.length,
      preservedCount: preserveVulnIds.size,
      cutoff,
    });
  } catch (err) {
    logger.error("vuln-retention failed", { error: String(err) });
    return NextResponse.json(
      { error: "prune_failed", message: String(err), deleted },
      { status: 500 },
    );
  }
}
