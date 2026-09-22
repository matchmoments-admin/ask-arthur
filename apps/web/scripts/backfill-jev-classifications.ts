/**
 * Jev shadow lane (v311) — classify every clone-watch candidate that Haiku
 * has scored but Jev has not.
 *
 * Two jobs, one script:
 *   1. The DAY-1 backfill (done 2026-09-22: 3,501 rows, ≈ $0.17) — the
 *      calibration curve without waiting 30 days for live accrual.
 *   2. The lane's REPAIR tool. The live step is fail-soft (a vendor 429 or
 *      timeout leaves no Jev row and the daily fan-out only re-fans alerts
 *      with no HAIKU row), so any live gap is closed by re-running this.
 *
 * Why this is legitimate: the pre-classifier's input is exactly three stored
 * strings (brand, candidate_domain, candidate_url), and the outcomes we
 * calibrate against live on shopfront_clone_alerts. Re-asking Jev the same
 * question about the same input is the same experiment the live step runs,
 * just batched. Rows are stamped `source = 'backfill'` so cohorts never blur.
 *
 * ONE write path: each row goes through `classifyOneWithJev`
 * (lib/clone-watch/jev-classify-one.ts) — the same function the live step
 * calls — so rubric, RPC args and cost rows cannot drift between the two.
 *
 *   pnpm --filter @askarthur/web exec tsx scripts/backfill-jev-classifications.ts [--apply] [--limit N]
 *
 * Dry-run by default: prints the pending count and the first request
 * payload, calls nothing. `--apply` classifies + writes. `--limit N` caps
 * the rows (`--apply --limit 25` first on a fresh key).
 *
 * Spend: ~1,100 input tokens/row at $0.042/M ≈ $0.00005/row. Telemetry is
 * one `typesafe` cost row per row (same as live). Concurrency 5 sits far
 * under the vendor's ~1,200 rpm. A vendor refusal on a whole page (key,
 * quota, outage) stops the run rather than burning the population.
 *
 * Ends by printing `clone_watch_jev_calibration()` — the decision instrument
 * (docs/ops/clone-watch-config.md § 8c).
 */
import "./_load-env-config";
import { createServiceClient } from "@askarthur/supabase/server";

import {
  buildJevPreclassifyQuestions,
  buildJevState,
} from "../lib/clone-watch/jev-preclassify";
import {
  classifyOneWithJev,
  type JevShadowOutcome,
} from "../lib/clone-watch/jev-classify-one";

const PAGE_SIZE = 200;
const CONCURRENCY = 5;

interface Candidate {
  alertId: number;
  brand: string;
  candidateDomain: string;
  candidateUrl: string;
}

type Sb = NonNullable<ReturnType<typeof createServiceClient>>;

/**
 * Alerts with a Haiku row and no Jev row. Anti-join via PostgREST: both
 * siblings embed from the parent (FK on alert_id), `is("jev", null)` keeps
 * the parents whose Jev embed is empty. Ids skipped earlier in this run are
 * excluded so a vendor-refused row cannot re-present at the head forever.
 */
async function fetchPage(
  sb: Sb,
  limit: number,
  exclude: ReadonlySet<number>,
): Promise<Candidate[]> {
  let q = sb
    .from("shopfront_clone_alerts")
    .select(
      "id, candidate_url, haiku:clone_watch_classifications!inner(brand, candidate_domain, classified_at), jev:clone_watch_jev_classifications(alert_id)",
    )
    .is("jev", null)
    .order("id", { ascending: true })
    .limit(limit);
  if (exclude.size > 0) q = q.not("id", "in", `(${[...exclude].join(",")})`);
  const { data, error } = await q;
  if (error) throw new Error(`fetchPage: ${error.message}`);
  return (data ?? []).map((r) => {
    const h = (Array.isArray(r.haiku) ? r.haiku[0] : r.haiku) as {
      brand: string;
      candidate_domain: string;
    };
    return {
      alertId: r.id as number,
      brand: h.brand,
      candidateDomain: h.candidate_domain,
      candidateUrl: r.candidate_url as string,
    };
  });
}

async function countPending(sb: Sb): Promise<number> {
  const { count, error } = await sb
    .from("shopfront_clone_alerts")
    .select(
      "id, haiku:clone_watch_classifications!inner(alert_id), jev:clone_watch_jev_classifications(alert_id)",
      { count: "exact", head: true },
    )
    .is("jev", null);
  if (error) throw new Error(`countPending: ${error.message}`);
  // A failed head-count returns count=null with NO error (memory:
  // head-count failures carry no error) — unknown is not zero.
  if (count === null) throw new Error("countPending: count unavailable");
  return count;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i] as T);
      }
    },
  );
  await Promise.all(workers);
  return out;
}

async function printCalibration(sb: Sb): Promise<void> {
  const { data, error } = await sb.rpc("clone_watch_jev_calibration");
  if (error) throw new Error(`calibration: ${error.message}`);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const cols = [
    "classifier",
    "bucket",
    "n",
    "urlscan_phish",
    "weaponised",
    "netcraft_declined",
    "triaged_fp",
    "tp_actioned",
  ];
  console.log("\nclone_watch_jev_calibration():");
  console.log(cols.map((c) => c.padStart(12)).join(""));
  for (const r of rows) {
    console.log(cols.map((c) => String(r[c]).padStart(12)).join(""));
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const limitIdx = process.argv.indexOf("--limit");
  const limitArg = limitIdx === -1 ? null : Number(process.argv[limitIdx + 1]);
  if (limitArg !== null && (!Number.isInteger(limitArg) || limitArg <= 0)) {
    throw new Error("--limit must be a positive integer");
  }
  if (!(process.env.TYPESAFE_API_KEY ?? "").trim()) {
    throw new Error("TYPESAFE_API_KEY is not set");
  }
  const sb = createServiceClient();
  if (!sb) throw new Error("service client unavailable (SUPABASE_* env)");

  const total = await countPending(sb);
  const target = limitArg === null ? total : Math.min(limitArg, total);
  const questions = buildJevPreclassifyQuestions();
  console.log(`rows without a Jev classification : ${total}`);
  console.log(`rows this run                      : ${target}`);
  console.log(
    `questions per request              : ${Object.keys(questions).length}`,
  );

  if (!apply) {
    const [c] = await fetchPage(sb, 1, new Set());
    if (c) {
      console.log("\nfirst request payload:");
      console.log(
        JSON.stringify(
          { state: buildJevState(c), model: "jev-latest", questions },
          null,
          2,
        ),
      );
    }
    console.log("\ndry-run — pass --apply to classify and write.");
    return;
  }

  let done = 0;
  let written = 0;
  let page = 0;
  const skips = new Map<string, number>();
  const skippedIds = new Set<number>();
  const startedAt = Date.now();

  while (done < target) {
    const batch = await fetchPage(
      sb,
      Math.min(PAGE_SIZE, target - done),
      skippedIds,
    );
    if (batch.length === 0) break;
    page += 1;

    const outcomes = await mapWithConcurrency(
      batch,
      CONCURRENCY,
      async (c): Promise<[Candidate, JevShadowOutcome]> => [
        c,
        await classifyOneWithJev({
          sb,
          alertId: c.alertId,
          input: c,
          source: "backfill",
          requestId: `jev-backfill:${c.alertId}`,
        }),
      ],
    );
    let ok = 0;
    for (const [c, o] of outcomes) {
      if (o.kind === "ok") ok += 1;
      else {
        skips.set(o.reason, (skips.get(o.reason) ?? 0) + 1);
        skippedIds.add(c.alertId);
      }
    }
    written += ok;
    done += batch.length;
    console.log(
      `page ${page}: ${ok}/${batch.length} written (${written}/${target} total, ${((Date.now() - startedAt) / 1000).toFixed(0)}s)`,
    );
    if (ok === 0) {
      console.log(
        "whole page skipped — stopping. reasons:",
        Object.fromEntries(skips),
      );
      break;
    }
  }

  console.log(`\nwritten : ${written}`);
  console.log(`skipped : ${[...skips.values()].reduce((a, b) => a + b, 0)}`);
  for (const [reason, n] of skips) console.log(`  ${reason}: ${n}`);

  await printCalibration(sb);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
