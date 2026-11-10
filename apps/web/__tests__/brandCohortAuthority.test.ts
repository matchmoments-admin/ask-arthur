import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Brand Cohort is the ONLY membership authority (#1296, v342).
 *
 * "Which lookalikes count for brand X" lives in one SQL view,
 * `clone_watch_brand_cohort`. Before v342 five surfaces restated it and
 * disagreed: the outreach worklist counted cleared false positives
 * (iinet.net.au 41 vs 10). This file pins the move so a sixth formula fails
 * here instead of in a pitch.
 *
 *   1. SQL: each counting RPC's LATEST definition reads the view and never the
 *      base table.
 *   2. TS: the reporting reads name the view (CLONE_COHORT_RELATION), and no
 *      file in app/ or lib/ re-states the fp membership filter as a PostgREST
 *      clause.
 *   3. TS: the remaining in-code FP-dictionary checks are a KNOWN list, each
 *      with the reason it is not a membership restatement — a new one fails.
 *
 * Go-red (2026-10-13, against origin/main c4a52b0a, i.e. before this PR):
 * (1) FAILED for all three RPCs (v269 / v203 / v340 read
 * shopfront_clone_alerts); (2) FAILED — three files carried
 * `triage_status.neq.fp` and none named the view; (3) FAILED — clone-cohort.ts
 * called isFpBrand( and is not on the known list.
 */

const WEB = process.cwd();
const MIGRATIONS = path.join(WEB, "..", "..", "supabase");

const FUNCTION_RE =
  /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_0-9]+)\s*\([\s\S]*?\bas\s+(\$[a-z_]*\$)([\s\S]*?)\2/gi;

function migrationVersion(file: string): number {
  const m = /^migration-v(\d+)/.exec(file);
  return m ? Number(m[1]) : Number.NaN;
}

function latestFunctionBodies(): Map<string, { file: string; body: string }> {
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql") && !Number.isNaN(migrationVersion(f)))
    .sort((a, b) => migrationVersion(a) - migrationVersion(b));
  const latest = new Map<string, { file: string; body: string }>();
  for (const file of files) {
    const src = fs.readFileSync(path.join(MIGRATIONS, file), "utf8");
    for (const m of src.matchAll(FUNCTION_RE)) {
      latest.set(m[1].toLowerCase(), { file, body: m[3] });
    }
  }
  return latest;
}

const stripSqlComments = (s: string) => s.replace(/--.*$/gm, "");

/** Every SQL surface that prints a per-brand / per-window lookalike count. */
const COUNTING_RPCS = [
  "get_brand_outreach_worklist",
  "brand_exposure_summary",
  "clone_watch_public_impact",
];

describe("SQL counting surfaces read the Brand Cohort", () => {
  const latest = latestFunctionBodies();

  it.each(COUNTING_RPCS)("%s reads clone_watch_brand_cohort, not the base table", (name) => {
    const def = latest.get(name);
    expect(def, `${name} has no CREATE FUNCTION in supabase/`).toBeDefined();
    const code = stripSqlComments(def!.body);
    expect(code, `${name} (${def!.file}) must read the Brand Cohort view`).toMatch(
      /public\.clone_watch_brand_cohort\b/,
    );
    expect(
      code,
      `${name} (${def!.file}) reads shopfront_clone_alerts directly — that is a ` +
        `second membership formula. Read public.clone_watch_brand_cohort.`,
    ).not.toMatch(/shopfront_clone_alerts/);
  });

  it("the view carries the whole membership rule", () => {
    const file = fs
      .readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql") && !Number.isNaN(migrationVersion(f)))
      .filter((f) => /clone_watch_brand_cohort/.test(fs.readFileSync(path.join(MIGRATIONS, f), "utf8")))
      .filter((f) => /create\s+or\s+replace\s+view\s+public\.clone_watch_brand_cohort/i.test(
        fs.readFileSync(path.join(MIGRATIONS, f), "utf8"),
      ))
      .sort((a, b) => migrationVersion(a) - migrationVersion(b))
      .pop();
    expect(file, "no migration creates clone_watch_brand_cohort").toBeDefined();
    const src = stripSqlComments(fs.readFileSync(path.join(MIGRATIONS, file!), "utf8"));
    const view = /create\s+or\s+replace\s+view\s+public\.clone_watch_brand_cohort[\s\S]*?;/i.exec(src)![0];
    expect(view).toMatch(/security_invoker\s*=\s*true/i);
    expect(view).toMatch(/source\s*=\s*'nrd'/);
    expect(view).toMatch(/inferred_target_domain\s+IS\s+NOT\s+NULL/i);
    // IS DISTINCT FROM keeps untriaged (NULL) rows — `<> 'fp'` would drop them.
    expect(view).toMatch(/triage_status\s+IS\s+DISTINCT\s+FROM\s+'fp'/i);
  });
});

// ── TS ──────────────────────────────────────────────────────────────────────

function walk(dir: string, out: string[]) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "__tests__" || e.name === ".next") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
}

function sources(): Map<string, string> {
  const files: string[] = [];
  for (const r of ["app", "lib", "inngest"]) walk(path.join(WEB, r), files);
  return new Map(
    files.map((f) => [path.relative(WEB, f).split(path.sep).join("/"), fs.readFileSync(f, "utf8")]),
  );
}

const stripTsComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/** The TS reads that count a brand's lookalikes. Each must name the view. */
const COHORT_READERS = [
  "lib/clone-watch/report-card-data.ts",
  "lib/clone-watch/month-facts.ts",
  "lib/email/brand-outreach-pilot.ts",
  "app/api/inngest/functions/clone-watch-internal-digest.ts",
  "app/api/inngest/functions/report-brand-stewardship.ts",
];

/**
 * In-code FP-dictionary checks that are NOT a per-brand count's membership.
 * Each entry says what question it answers instead.
 */
const KNOWN_FP_BRAND_CHECKS: Record<string, string> = {
  "app/api/inngest/functions/clone-watch-netcraft-auto.ts":
    "Action gate (never REPORT a dictionary brand to Netcraft), belt-and-braces over its SQL worklist.",
  "app/api/inngest/functions/clone-watch-netcraft-issue.ts":
    "Action gate for the report_issue lane, same reason.",
  "lib/clone-watch/weekly-clone-watch.ts":
    "Disclosure list (confirmed domains named in the newsletter), not a count.",
  "lib/clone-watch/month-end-stock.ts":
    "Month-end STOCK walk: every active lookalike of any first-seen month — a different question from a month's cohort.",
  "lib/clone-watch/report-card.ts":
    "Zero rows for WATCHED brands with no clones (coverage, not alerts) — keeps a dictionary brand from getting a zero row.",
  "lib/newsletter/evidence.ts": "Disclosure gate for a named domain in the newsletter.",
  "lib/newsletter/prepare.ts": "Newsletter brand picking from scam reports, not clone counts.",
  "lib/clone-watch/fp-brand-denylist.ts": "The definition.",
};

describe("TS counting reads go through the Brand Cohort", () => {
  const src = sources();

  it.each(COHORT_READERS)("%s reads CLONE_COHORT_RELATION", (file) => {
    const code = stripTsComments(src.get(file) ?? "");
    expect(code, `${file} missing`).not.toBe("");
    // Positive only: a reader may still touch the base table for a question
    // that is not a count (stewardship resolves onward-report brands by id).
    expect(code).toMatch(/\.from\(\s*CLONE_COHORT_RELATION\s*\)/);
  });

  it("no file re-states the fp membership filter as a PostgREST clause", () => {
    const offenders = [...src.entries()]
      .filter(([, s]) => /triage_status\.neq\.fp/.test(stripTsComments(s)))
      .map(([f]) => f);
    expect(
      offenders,
      "read .from(CLONE_COHORT_RELATION) instead of re-applying the fp rule",
    ).toEqual([]);
  });

  it("every in-code FP-dictionary check is a known non-membership use", () => {
    const callers = [...src.entries()]
      .filter(([, s]) => /\bisFpBrand\s*\(|FP_BRAND_DENYLIST\s*:/.test(stripTsComments(s)))
      .map(([f]) => f)
      .sort();
    expect(callers).toEqual(Object.keys(KNOWN_FP_BRAND_CHECKS).sort());
  });
});
