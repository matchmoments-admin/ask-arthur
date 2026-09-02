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
 * THE EVENT-ID SUFFIX IS NOT ENOUGH ON ITS OWN, and this cost a silent no-op
 * on the first real run (2026-09-02). There are TWO dedup layers:
 *   1. event-send dedup, keyed on the event id — the suffix defeats this; and
 *   2. `idempotency: "event.data.alertId"` on notify-weaponised itself
 *      (clone-watch-notify-weaponised.ts) — a FUNCTION-level key that the
 *      suffix does not touch, with a 24h window.
 * So an alert whose notify run happened (or was cancelled) less than 24h ago
 * is deduped at layer 2: the run completes in ~0.3s having done nothing, and
 * the alert stays unnotified while the script reports success. Alert 3713
 * weaponised 12:04 and was re-emitted 21:41 — 9.6h later — and was silently
 * dropped exactly this way, while five older alerts in the same batch ran fine.
 *
 * Hence RECOVERY_MIN_AGE_HOURS below: alerts too fresh to escape function
 * idempotency are REPORTED AND SKIPPED rather than sent into a black hole.
 * They need no intervention anyway — re-run after the window lapses.
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
  weaponised_at: string;
}

/**
 * Inngest's function-idempotency window. An alert weaponised more recently than
 * this cannot be recovered by re-emitting — `idempotency: "event.data.alertId"`
 * swallows it regardless of the event id. Deliberately equal to the window
 * rather than padded: the point is to name the real constraint, and a run at
 * exactly the boundary is retried harmlessly by a later invocation.
 */
const RECOVERY_MIN_AGE_HOURS = 24;

// Same predicate as the retrieve fn's detector: weaponised long enough ago
// that the consumer must have finished, and carrying no completion stamp.
const LOST_ALERTS_SQL = `
  SELECT a.id, a.candidate_domain, a.candidate_url, a.recheck_count,
         a.weaponised_at
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
  const all = JSON.parse(body) as LostAlert[];

  // Split, never silently filter: an operator who is told "6 lost" and sees 5
  // recovered must be able to see where the sixth went.
  const cutoffMs = Date.now() - RECOVERY_MIN_AGE_HOURS * 3_600_000;
  const rows = all.filter((r) => Date.parse(r.weaponised_at) < cutoffMs);
  const tooFresh = all.filter((r) => Date.parse(r.weaponised_at) >= cutoffMs);

  console.log(`lost weaponised alerts: ${all.length}`);
  for (const r of rows) console.log(`  #${r.id} ${r.candidate_domain}`);
  if (tooFresh.length > 0) {
    console.log(
      `\nSKIPPED — within the ${RECOVERY_MIN_AGE_HOURS}h function-idempotency window,` +
        ` re-emitting these would be a silent no-op:`,
    );
    for (const r of tooFresh) {
      const hrs = ((Date.now() - Date.parse(r.weaponised_at)) / 3_600_000).toFixed(1);
      console.log(
        `  #${r.id} ${r.candidate_domain} (weaponised ${hrs}h ago — retry after` +
          ` ${new Date(Date.parse(r.weaponised_at) + RECOVERY_MIN_AGE_HOURS * 3_600_000).toISOString()})`,
      );
    }
  }
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
