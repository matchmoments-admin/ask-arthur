import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { FP_BRAND_DENYLIST } from "@/lib/clone-watch/fp-brand-denylist";

/**
 * The FP brand denylist has one TS home and a literal copy inside SQL worklist
 * RPCs (SQL can't import the TS set). Before this test the only link between
 * them was a comment ("mirrors FP_BRAND_DENYLIST", v184) — adding a fourth
 * dictionary brand to the TS set would silently leave the Netcraft worklists
 * reporting it.
 *
 * Migrations are immutable history, so comparing every file that ever mentions
 * the list would be wrong: nine files do, most of them superseded. What prod
 * runs is the LATEST `CREATE [OR REPLACE] FUNCTION` body for each function, in
 * migration-version order. This test rebuilds that map and asserts:
 *
 *   1. every latest function body that carries the list carries exactly the
 *      TS set (drift in either direction fails, naming the function); and
 *   2. the set of functions carrying it is the known one — a new carrier is a
 *      new place a future edit must reach, so it has to be added here on
 *      purpose, and a carrier that dropped the list is a behaviour change
 *      someone should have noticed.
 *
 * To add or remove an FP brand: edit FP_BRAND_DENYLIST, then ship a migration
 * that re-creates each function in CARRIERS with the new literal list. This
 * test fails until both halves are done.
 *
 * Verified go-red: adding "example.com.au" to FP_BRAND_DENYLIST fails (1) for
 * both carriers.
 */

const MIGRATIONS = join(process.cwd(), "..", "..", "supabase");

/** The functions whose latest definition embeds the denylist (2026-09-27). */
const CARRIERS = [
  "list_clone_alerts_pending_netcraft_auto",
  "list_clone_alerts_pending_netcraft_issue",
];

/** A literal only counts as the denylist when it includes a known member. */
const MARKER = "allhomes.com.au";

const FUNCTION_RE =
  /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_0-9]+)\s*\(.*?\bas\s+(\$[a-z_]*\$)(.*?)\2/gis;

function migrationVersion(file: string): number {
  const m = /^migration-v(\d+)/.exec(file);
  return m ? Number(m[1]) : Number.NaN;
}

/** Latest body per function name, applying migrations in version order. */
function latestFunctionBodies(): Map<string, { file: string; body: string }> {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql") && !Number.isNaN(migrationVersion(f)))
    .sort((a, b) => migrationVersion(a) - migrationVersion(b));
  const latest = new Map<string, { file: string; body: string }>();
  for (const file of files) {
    const src = readFileSync(join(MIGRATIONS, file), "utf8");
    for (const m of src.matchAll(FUNCTION_RE)) {
      latest.set(m[1].toLowerCase(), { file, body: m[3] });
    }
  }
  return latest;
}

/** Strip `--` comments so a prose mention of a domain isn't read as the list. */
function stripSqlComments(body: string): string {
  return body.replace(/--.*$/gm, "");
}

function denylistIn(body: string): string[] {
  const code = stripSqlComments(body);
  const lits = [...code.matchAll(/'([a-z0-9.-]+\.[a-z]{2,}(?:\.[a-z]{2})?)'/g)].map(
    (m) => m[1],
  );
  return [...new Set(lits.filter((l) => l.endsWith(".com.au")))].sort();
}

describe("FP brand denylist — SQL copies match FP_BRAND_DENYLIST", () => {
  const latest = latestFunctionBodies();
  const carriers = [...latest.entries()]
    .filter(([, { body }]) => stripSqlComments(body).includes(`'${MARKER}'`))
    .map(([name]) => name)
    .sort();

  it("the functions carrying the list are the known ones", () => {
    expect(latest.size, "migration parse found no functions").toBeGreaterThan(100);
    expect(carriers).toEqual([...CARRIERS].sort());
  });

  it.each(CARRIERS)("%s carries exactly the TS set", (name) => {
    const def = latest.get(name);
    expect(def, `${name} has no CREATE FUNCTION in supabase/`).toBeDefined();
    expect(
      denylistIn(def!.body),
      `${name} (latest definition: ${def!.file}) disagrees with FP_BRAND_DENYLIST — ` +
        `ship a migration re-creating it with the TS list`,
    ).toEqual([...FP_BRAND_DENYLIST].sort());
  });
});
