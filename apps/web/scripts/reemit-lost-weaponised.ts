/**
 * Recovery for weaponised alerts that were emitted but never notified (#1069).
 *
 * `weaponised_notified_at` records that clone.weaponised.v1 was SENT, not that
 * notify-weaponised did its job. When that consumer is finish-cancelled (10+
 * steps; a cancellation gets no retry, no error, no telemetry) the alert is
 * left emitted-but-unnotified and the emit worklist — already stamped — never
 * re-presents it. This script finds those alerts and re-emits with a
 * `-recovery-<date>` event-id suffix, because the original id
 * (`clone-weaponised-<id>-<via>`) would be deduped by Inngest.
 *
 * The standing detector is the `unnotified_weaponised` field on
 * `cost_telemetry WHERE feature='shopfront_clone_urlscan'` (written by
 * clone-watch-urlscan-retrieve every 3h). Two episodes were missed before it
 * existed: 13 alerts 2026-08-03..10 and 7 more 2026-08-29..09-02.
 *
 * ONLY run this once the notify-weaponised finish budget fix is deployed, or
 * the re-emitted runs are cancelled the same way. Dry-run by default.
 *
 *   pnpm --filter @askarthur/web exec tsx scripts/reemit-lost-weaponised.ts [--apply]
 *
 * Needs SUPABASE_ACCESS_TOKEN (from .env.local, loaded below) and
 * INNGEST_EVENT_KEY (prod-only — `vercel env pull` and source it).
 */
import "./_load-env-config";

// Read-only prod query via the Management API. Inlined rather than imported so
// this script has no dependency on ad-hoc session tooling.
const PROJECT_REF = "rquomhcgnodxzkhokwni";

async function runSql(sql: string): Promise<{ status: number; body: string }> {
  const token = (process.env.SUPABASE_ACCESS_TOKEN ?? "").trim();
  if (!token) throw new Error("SUPABASE_ACCESS_TOKEN is not set");
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  return { status: res.status, body: await res.text() };
}

interface LostAlert {
  id: number;
  candidate_domain: string;
  candidate_url: string;
  recheck_count: number | null;
}

// Same predicate as the retrieve fn's detector: weaponised long enough ago
// that the consumer must have finished, and carrying no completion stamp.
const LOST_ALERTS_SQL = `
  SELECT a.id, a.candidate_domain, a.candidate_url, a.recheck_count
    FROM shopfront_clone_alerts a
   WHERE a.weaponised_at IS NOT NULL
     AND a.weaponised_at > now() - interval '30 days'
     AND a.weaponised_at < now() - interval '2 hours'
     AND NOT (a.submitted_to ? 'weaponised_notification')
   ORDER BY a.weaponised_at`;

async function main() {
  const apply = process.argv.includes("--apply");
  const eventKey = (process.env.INNGEST_EVENT_KEY ?? "").trim();
  if (apply && !eventKey) throw new Error("INNGEST_EVENT_KEY is not set");

  const { status, body } = await runSql(LOST_ALERTS_SQL);
  if (status >= 300) throw new Error(`query failed: HTTP ${status} ${body.slice(0, 300)}`);
  const rows = JSON.parse(body) as LostAlert[];

  console.log(`lost weaponised alerts: ${rows.length}`);
  for (const r of rows) console.log(`  #${r.id} ${r.candidate_domain}`);
  if (rows.length === 0) return;
  if (!apply) {
    console.log("\ndry-run — pass --apply to re-emit.");
    return;
  }

  const date = new Date().toISOString().slice(0, 10);
  const events = rows.map((r) => {
    const via = (r.recheck_count ?? 0) > 0 ? "recheck" : "initial";
    return {
      name: "shopfront/clone.weaponised.v1",
      id: `clone-weaponised-${r.id}-${via}-recovery-${date}`,
      data: {
        alertId: r.id,
        candidateDomain: r.candidate_domain,
        candidateUrl: r.candidate_url,
        via,
      },
    };
  });

  const res = await fetch(`https://inn.gs/e/${eventKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(events),
  });
  console.log(`\nsent ${events.length} events — HTTP ${res.status}`);
  console.log((await res.text()).slice(0, 300));
  if (res.status >= 300) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
