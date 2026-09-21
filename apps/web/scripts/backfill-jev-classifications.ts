/**
 * One-off backfill for the Jev shadow lane (v311): classify every historic
 * clone-watch candidate that Haiku already scored, so the calibration curve
 * exists on DAY 1 instead of after 30 days of live accrual.
 *
 * Why this is legitimate: the Haiku pre-classifier's input is exactly three
 * stored strings (brand, candidate_domain, candidate_url — see `userMessage`
 * in clone-watch-haiku-preclassify.ts), and the outcomes we calibrate
 * against (urlscan_classification, weaponised_at, triage_status,
 * netcraft_declined_at) are on shopfront_clone_alerts. Re-asking Jev the
 * same question about the same input after the fact is the same experiment
 * the live lane runs, just batched. Rows are stamped `source = 'backfill'`
 * so the two cohorts never blur.
 *
 * Rubric + mapping come from lib/clone-watch/jev-preclassify.ts — the ONE
 * rubric the live step also uses; do not inline questions here.
 *
 *   pnpm --filter @askarthur/web exec tsx scripts/backfill-jev-classifications.ts [--apply] [--limit N]
 *
 * Dry-run by default: prints the candidate count, the request payload for
 * the first row, and calls nothing. `--apply` calls Jev and writes through
 * `record_clone_watch_jev_classification` (the same RPC as the live step)
 * via the Management API. `--limit N` caps the rows for a smoke run
 * (`--apply --limit 25` first, then the full run).
 *
 * Spend: instructions count as input, so ~1,100 tokens per row (measured
 * 2026-09-22: 28,335 for 25) at $0.042/M ≈ $0.00005 per row; the full
 * ~3.5k-row population is ≈ $0.17. Telemetry: ONE cost_telemetry row
 * per page (feature shopfront_clone_preclassify_jev, operation backfill)
 * rather than one per call, so the dashboard shows the run without 3,500
 * near-zero rows. Concurrency 5 sits far under the vendor's ~1,200 rpm;
 * a 429 is quota, not death — back off 2 s and retry once.
 *
 * Ends by printing `clone_watch_jev_calibration()` — the decision instrument
 * (docs/ops/clone-watch-config.md § Jev shadow lane).
 */
import "./_load-env-config";
import { askJev } from "@askarthur/scam-engine/providers/jev";

import {
  JEV_PROMPT_VERSION,
  JevAnswerShapeError,
  buildJevPreclassifyQuestions,
  buildJevState,
  mapJevAnswersToRow,
  toJevRpcArgs,
} from "../lib/clone-watch/jev-preclassify";
import { PRICING } from "../lib/cost-telemetry";

const PROJECT_REF = "rquomhcgnodxzkhokwni";
const PAGE_SIZE = 200;
const CONCURRENCY = 5;
const RATE_LIMIT_BACKOFF_MS = 2_000;

interface Candidate {
  alert_id: number;
  brand: string;
  candidate_domain: string;
  candidate_url: string;
}

async function runSql(sql: string): Promise<unknown> {
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
  const body = await res.text();
  if (res.status >= 300)
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 500)}`);
  return JSON.parse(body);
}

/** SQL string literal — the Management API takes raw SQL, so escape by hand. */
function lit(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return `'${s.replace(/'/g, "''")}'`;
}

function jsonb(v: unknown): string {
  return `${lit(JSON.stringify(v))}::jsonb`;
}

async function fetchPage(
  limitOverride: number | null,
  exclude: ReadonlySet<number> = new Set(),
): Promise<Candidate[]> {
  const limit =
    limitOverride === null ? PAGE_SIZE : Math.min(PAGE_SIZE, limitOverride);
  // Rows skipped earlier in this run have no Jev row, so the LEFT JOIN would
  // re-present them at the head of every page (the worklist-starvation
  // shape); exclude them explicitly.
  const excludeSql =
    exclude.size > 0
      ? `AND h.alert_id <> ALL(ARRAY[${[...exclude].join(",")}]::bigint[])`
      : "";
  // The stored v157 input is the source of truth for brand/domain; the URL
  // lives on the parent alert (the fn reads both from the fan-out event,
  // which the daily ingest builds from these same columns).
  return (await runSql(
    `SELECT h.alert_id, h.brand, h.candidate_domain, a.candidate_url
       FROM clone_watch_classifications h
       JOIN shopfront_clone_alerts a ON a.id = h.alert_id
       LEFT JOIN clone_watch_jev_classifications j ON j.alert_id = h.alert_id
      WHERE j.alert_id IS NULL
        ${excludeSql}
      ORDER BY h.classified_at
      LIMIT ${limit}`,
  )) as Candidate[];
}

type RowOutcome =
  | { kind: "ok"; alertId: number; sql: string; inputTokens: number }
  | { kind: "skip"; alertId: number; reason: string };

async function classifyOne(
  c: Candidate,
  questions: ReturnType<typeof buildJevPreclassifyQuestions>,
): Promise<RowOutcome> {
  const state = buildJevState({
    brand: c.brand,
    candidateDomain: c.candidate_domain,
    candidateUrl: c.candidate_url,
  });
  let res = await askJev(state, questions, {
    requestId: `jev-backfill:${c.alert_id}`,
  });
  if (!res.ok && res.reason === "rate_limited") {
    await new Promise((r) => setTimeout(r, RATE_LIMIT_BACKOFF_MS));
    res = await askJev(state, questions, {
      requestId: `jev-backfill:${c.alert_id}:retry`,
    });
  }
  if (!res.ok) return { kind: "skip", alertId: c.alert_id, reason: res.reason };

  let args: Record<string, unknown>;
  try {
    args = toJevRpcArgs({
      alertId: c.alert_id,
      brand: c.brand,
      candidateDomain: c.candidate_domain,
      row: mapJevAnswersToRow(res.answers),
      modelId: res.model,
      source: "backfill",
      inputTokens: res.usage.inputTokens,
      latencyMs: res.elapsedMs,
    });
  } catch (err) {
    if (err instanceof JevAnswerShapeError) {
      return {
        kind: "skip",
        alertId: c.alert_id,
        reason: `bad_answers: ${err.message}`,
      };
    }
    throw err;
  }

  const sql =
    `SELECT public.record_clone_watch_jev_classification(` +
    [
      lit(args.p_alert_id),
      lit(args.p_brand),
      lit(args.p_candidate_domain),
      lit(args.p_is_clone_p),
      lit(args.p_clone_tactic),
      lit(args.p_clone_tactic_conf),
      jsonb(args.p_clone_tactic_probs),
      lit(args.p_attack_intent),
      lit(args.p_attack_intent_conf),
      jsonb(args.p_attack_intent_probs),
      jsonb(args.p_risk_indicator_probs),
      lit(args.p_model_id),
      lit(args.p_prompt_version),
      lit(args.p_source),
      lit(args.p_input_tokens),
      lit(args.p_latency_ms),
    ].join(", ") +
    `)`;
  return {
    kind: "ok",
    alertId: c.alert_id,
    sql,
    inputTokens: res.usage.inputTokens,
  };
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

async function logPageCost(
  page: number,
  rows: number,
  inputTokens: number,
): Promise<void> {
  const cost = inputTokens * PRICING.JEV_USD_PER_INPUT_TOKEN;
  await runSql(
    `INSERT INTO cost_telemetry (feature, provider, operation, units, unit_cost_usd, estimated_cost_usd, metadata, request_id)
     VALUES ('shopfront_clone_preclassify_jev', 'typesafe', 'backfill', ${inputTokens}, ${PRICING.JEV_USD_PER_INPUT_TOKEN}, ${cost},
             ${jsonb({ rows, page, prompt_version: JEV_PROMPT_VERSION, source: "backfill" })}, ${lit(`jev-backfill:page:${page}`)})`,
  );
}

async function printCalibration(): Promise<void> {
  const rows = (await runSql(
    `SELECT * FROM public.clone_watch_jev_calibration()`,
  )) as Array<Record<string, unknown>>;
  console.log("\nclone_watch_jev_calibration():");
  console.log(
    `${"classifier".padEnd(10)} ${"bucket".padStart(6)} ${"n".padStart(6)} ${"phish".padStart(6)} ${"weapon".padStart(6)} ${"declin".padStart(6)} ${"fp".padStart(6)} ${"action".padStart(6)}`,
  );
  for (const r of rows) {
    console.log(
      `${String(r.classifier).padEnd(10)} ${String(r.bucket).padStart(6)} ${String(r.n).padStart(6)} ${String(r.urlscan_phish).padStart(6)} ${String(r.weaponised).padStart(6)} ${String(r.netcraft_declined).padStart(6)} ${String(r.triaged_fp).padStart(6)} ${String(r.tp_actioned).padStart(6)}`,
    );
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const limitIdx = process.argv.indexOf("--limit");
  const limitArg = limitIdx === -1 ? null : Number(process.argv[limitIdx + 1]);
  if (limitArg !== null && (!Number.isInteger(limitArg) || limitArg <= 0)) {
    throw new Error("--limit must be a positive integer");
  }
  if (!(process.env.TYPESAFE_API_KEY ?? "").trim())
    throw new Error("TYPESAFE_API_KEY is not set");

  const questions = buildJevPreclassifyQuestions();
  const pending = (await runSql(
    `SELECT count(*)::int AS n
       FROM clone_watch_classifications h
       LEFT JOIN clone_watch_jev_classifications j ON j.alert_id = h.alert_id
      WHERE j.alert_id IS NULL`,
  )) as Array<{ n: number }>;
  const total = pending[0]?.n ?? 0;
  const target = limitArg === null ? total : Math.min(limitArg, total);
  console.log(`rows without a Jev classification : ${total}`);
  console.log(`rows this run                      : ${target}`);
  console.log(
    `questions per request              : ${Object.keys(questions).length}`,
  );

  if (!apply) {
    const sample = await fetchPage(1);
    if (sample[0]) {
      const c = sample[0];
      console.log("\nfirst request payload:");
      console.log(
        JSON.stringify(
          {
            state: buildJevState({
              brand: c.brand,
              candidateDomain: c.candidate_domain,
              candidateUrl: c.candidate_url,
            }),
            model: "jev-latest",
            questions,
          },
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
    const remaining = target - done;
    const batch = await fetchPage(remaining, skippedIds);
    if (batch.length === 0) break;
    page += 1;

    const outcomes = await mapWithConcurrency(batch, CONCURRENCY, (c) =>
      classifyOne(c, questions),
    );
    const oks = outcomes.filter(
      (o): o is Extract<RowOutcome, { kind: "ok" }> => o.kind === "ok",
    );
    for (const o of outcomes) {
      if (o.kind === "skip") {
        skips.set(o.reason, (skips.get(o.reason) ?? 0) + 1);
        skippedIds.add(o.alertId);
      }
    }

    if (oks.length > 0) {
      // One statement per page; each call is the same RPC the live step uses.
      await runSql(oks.map((o) => o.sql).join(";\n"));
      const tokens = oks.reduce((s, o) => s + o.inputTokens, 0);
      await logPageCost(page, oks.length, tokens);
      written += oks.length;
    }
    done += batch.length;
    console.log(
      `page ${page}: ${oks.length}/${batch.length} written (${written}/${target} total, ${((Date.now() - startedAt) / 1000).toFixed(0)}s)`,
    );

    // A whole page skipping means the vendor is refusing us (key, quota,
    // outage) — stop rather than burn the population on errors.
    if (oks.length === 0) {
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

  await printCalibration();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
