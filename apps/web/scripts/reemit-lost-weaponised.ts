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
 *   1. event-send dedup, keyed on the event id; and
 *   2. `idempotency: "event.data.alertId"` on notify-weaponised itself
 *      (clone-watch-notify-weaponised.ts) — a FUNCTION-level key that no event
 *      id can touch, with a 24h window.
 * So an alert whose notify run happened less than 24h ago is deduped at layer
 * 2: the run completes in ~0.3s having done nothing, and the alert stays
 * unnotified while the script reports success. Alert 3713 weaponised 12:04 and
 * was re-emitted 21:41 — 9.6h later — and was dropped exactly this way, while
 * five older alerts in the same batch ran fine.
 *
 * ANCHORING THE AGE CHECK IS THE SUBTLE PART. Layer 2's window restarts on
 * every RUN CREATED for that alertId, not on `weaponised_at` — including runs
 * this script creates, and including runs that return early without stamping
 * (notify-weaponised exits before its stamp when its feature flags are off).
 * So the first version of this guard, which measured from `weaponised_at`,
 * still no-opped on exactly the operator flow it was written for: recovery run
 * fails, alert re-appears in the worklist, operator re-runs the same day, and
 * the event is swallowed again while the output says "sent". The age is now
 * measured from the LAST KNOWN RUN — `weaponised_notified_at` (the emit that
 * created the original run) or this script's own recorded attempt, whichever
 * is later — and every emit records itself so repeat runs stay honest.
 *
 * The event id carries a full timestamp rather than a date, so layer 1 is out
 * of the picture entirely and only layer 2 has to be reasoned about.
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
  /** Hours since the last run that consumed the idempotency key (DB clock). */
  hours_since_last_run: number;
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
         a.weaponised_at,
         -- Age since the LAST run that consumed the idempotency key, computed
         -- with the DATABASE clock. Doing this in SQL keeps one clock in play
         -- and removes the NaN hole a client-side Date.parse split leaves (a
         -- row that parses to NaN falls out of BOTH buckets and vanishes from
         -- the output, which is the ambiguity this script exists to end).
         EXTRACT(EPOCH FROM (now() - GREATEST(
           a.weaponised_at,
           COALESCE(a.weaponised_notified_at, a.weaponised_at),
           COALESCE((a.submitted_to->'weaponised_recovery'->>'at')::timestamptz,
                    a.weaponised_at)
         ))) / 3600.0 AS hours_since_last_run
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
  // recovered must be able to see where the sixth went. The age comes from SQL
  // (DB clock, and null-safe), so no row can fall out of both buckets.
  const rows = all.filter((r) => Number(r.hours_since_last_run) >= RECOVERY_MIN_AGE_HOURS);
  const tooFresh = all.filter((r) => Number(r.hours_since_last_run) < RECOVERY_MIN_AGE_HOURS);

  console.log(`lost weaponised alerts: ${all.length}`);
  for (const r of rows) console.log(`  #${r.id} ${r.candidate_domain}`);
  if (tooFresh.length > 0) {
    console.log(
      `\nSKIPPED — within the ${RECOVERY_MIN_AGE_HOURS}h function-idempotency window,` +
        ` re-emitting these would be a silent no-op:`,
    );
    for (const r of tooFresh) {
      const hrs = Number(r.hours_since_last_run);
      const retryAfter = new Date(
        Date.now() + (RECOVERY_MIN_AGE_HOURS - hrs) * 3_600_000,
      ).toISOString();
      console.log(
        `  #${r.id} ${r.candidate_domain} (last run ${hrs.toFixed(1)}h ago —` +
          ` retry after ~${retryAfter})`,
      );
    }
  }
  if (rows.length === 0) return;
  if (!apply) {
    console.log("\ndry-run — pass --apply to re-emit.");
    return;
  }

  // Full timestamp, not a date: a date-granular suffix meant two runs on the
  // same UTC day produced byte-identical event ids, so the second was dropped
  // at layer 1 as well — silently, with an HTTP 200 "sent N events".
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const events = rows.map((r) => {
    const via = (r.recheck_count ?? 0) > 0 ? "recheck" : "initial";
    return {
      name: "shopfront/clone.weaponised.v1",
      id: `clone-weaponised-${r.id}-${via}-recovery-${stamp}`,
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

  // Record THIS attempt. Nothing else on the row marks it: a recovery run that
  // is cancelled leaves no trace, so without this the next run measures age
  // from the original emit, believes the window has lapsed, and is swallowed
  // again — the same silent no-op one layer up.
  const ids = rows.map((r) => r.id).join(",");
  const stampSql = `
    UPDATE shopfront_clone_alerts
       SET submitted_to = COALESCE(submitted_to, '{}'::jsonb)
             || jsonb_build_object('weaponised_recovery',
                  jsonb_build_object('at', now(), 'events', ${events.length}))
     WHERE id IN (${ids})`;
  const stamped = await runSql(stampSql);
  if (stamped.status >= 300) {
    console.error(
      `WARNING: emitted but failed to record the attempt (HTTP ${stamped.status}).` +
        ` The next run may treat these as eligible and be silently deduped.`,
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
