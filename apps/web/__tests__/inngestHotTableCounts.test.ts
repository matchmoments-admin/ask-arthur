import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * An exact count on a hot table, inside a step, is a guaranteed timeout.
 *
 * PostgREST logs in as `authenticator`, whose `statement_timeout` is **8 s**,
 * and that is the only real cap a supabase-js caller runs under — an in-body
 * `SET LOCAL statement_timeout` never re-arms the timer (v310/#1161, memory
 * note `in-body-statement-timeout-is-decorative`). `Prefer: count=exact` makes
 * Postgres walk the whole matching set, so on a large table the count — not the
 * rows — is what blows the cap.
 *
 * Measured on prod 2026-09-22, `pipeline-enrichment-fanout`'s worklist load:
 *
 *   select id, domain … enrichment_status='pending' AND is_active=true
 *     order by created_at desc limit 200        →    78 ms
 *   the same query's count: "exact"              →  7,789 ms  (238,164 heap fetches)
 *
 * The row fetch was never the problem. The count was there only so the backlog
 * size would be observable, and it failed the step on EVERY run from
 * 2026-07-29 to 2026-09-27 — twice a day, "Failed to fetch pending URLs"
 * followed by 57014. No URL enrichment ran in that window.
 *
 * `count: "planned"` (or `"estimated"`) answers from the planner's row estimate
 * instead, which is what a gauge needs. Use it for any worklist backlog.
 *
 * Scope — this guard flags a `.select()` with `count: "exact"` against a table
 * on HOT_TABLES only, because that is where the cost is:
 *   - the CLAUDE.md hot list (write-frequent + heavily-indexed), plus
 *   - `scam_urls` (the 250k-row pending queue this incident came from) and
 *     `cost_telemetry` (append-only, grows without bound).
 * Counts on small tables are fine and are left alone: the other seven
 * `count: "exact"` sites in these two directories were timed against prod at
 * ≤ 730 ms (`shopfront_clone_alerts` 26 ms, `report_entity_links` bounded by
 * an id list, `onward_report_log`, `reddit_intel_themes`, `reddit_post_intel`).
 *
 * An `.upsert()`/`.insert()`/`.update()`/`.delete()` with `count: "exact"`
 * returns affected rows, not a scan, so it is deliberately NOT flagged —
 * `acnc-charity-backfill-embed` uses that shape on a 25-row upsert.
 *
 * Verified go-red: with `enrichment.ts` back on `count: "exact"` this test
 * fails naming that file; it is the only site in the fleet that trips it.
 */

const SCAN_DIRS = [
  new URL("../app/api/inngest/functions/", import.meta.url),
  new URL("../../../packages/scam-engine/src/inngest/", import.meta.url),
];

/** Tables where a full-set count cannot be assumed to fit in 8 s. */
const HOT_TABLES = new Set([
  // CLAUDE.md "hot tables" (write-frequent + heavily-indexed)
  "acnc_charities",
  "scam_reports",
  "verified_scams",
  "feedback_triage_queue",
  "feed_items",
  "scam_entities",
  // This incident's table: ~250k rows pending, partial index, 238k heap fetches.
  "scam_urls",
  // Append-only and unbounded between retention sweeps.
  "cost_telemetry",
]);

const EXACT_COUNT_RE = /count:\s*["']exact["']/g;
const FROM_RE = /\.from\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\)/g;
/** The builder verb a count option belongs to. Only `select` does a scan. */
const VERB_RE = /\.(select|upsert|insert|update|delete)\s*[(<]/g;

function lastMatchBefore(
  src: string,
  re: RegExp,
  index: number,
): RegExpExecArray | null {
  re.lastIndex = 0;
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m.index >= index) break;
    last = m;
  }
  return last;
}

function lineOf(src: string, index: number): number {
  return src.slice(0, index).split("\n").length;
}

interface Offence {
  file: string;
  line: number;
  table: string;
}

function findOffences(file: string, src: string): Offence[] {
  const out: Offence[] = [];
  EXACT_COUNT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EXACT_COUNT_RE.exec(src)) !== null) {
    const verb = lastMatchBefore(src, VERB_RE, m.index);
    if (verb?.[1] !== "select") continue; // a write's count = affected rows
    const from = lastMatchBefore(src, FROM_RE, m.index);
    const table = from?.[1];
    if (!table || !HOT_TABLES.has(table)) continue;
    out.push({ file, line: lineOf(src, m.index), table });
  }
  return out;
}

describe("no exact count on a hot table inside an Inngest function", () => {
  it("every worklist gauge uses a planned/estimated count", () => {
    const offences: Offence[] = [];
    for (const dir of SCAN_DIRS) {
      for (const name of readdirSync(dir)) {
        if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
        const src = readFileSync(new URL(name, dir), "utf8");
        offences.push(...findOffences(name, src));
      }
    }

    expect(
      offences,
      offences.length === 0
        ? ""
        : `exact count on a hot table — the 8s authenticator timeout will kill the step:\n` +
            offences
              .map(
                (o) =>
                  `  ${o.file}:${o.line} — count:"exact" on ${o.table}. ` +
                  `Use count:"planned" for a backlog gauge, or drop the count.`,
              )
              .join("\n"),
    ).toEqual([]);
  });

  it("scans the directories it claims to", () => {
    // A guard whose glob matches nothing reads as protection while protecting
    // nothing (the db-migration reviewer globbed a directory that never
    // existed for 117 migrations, #1046). Assert the corpus is non-empty.
    const counts = SCAN_DIRS.map(
      (d) => readdirSync(d).filter((n) => n.endsWith(".ts")).length,
    );
    for (const c of counts) expect(c).toBeGreaterThan(5);
  });
});
