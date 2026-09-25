import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Migration lint (2026-09-25, v324). Since v324 new public objects get no
// anon/authenticated privileges by default, so the remaining guards are the
// ones a migration author must write: RLS on every new table, and REVOKE FROM
// PUBLIC on every SECURITY DEFINER function. Checked for migrations at or after
// the cutoff only — historical files predate the rule and are immutable.

const CUTOFF_VERSION = 324;
const MIGRATIONS_DIR = join(__dirname, "../../../supabase");

/** Remove comments and the contents of dollar-quoted bodies so a function body
 *  (which may contain CREATE TABLE text, semicolons or the word DEFINER) can't
 *  satisfy or trip a rule. */
function stripBodiesAndComments(sql: string): string {
  let out = sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
  out = out.replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, " $BODY$ ");
  return out;
}

const ident = String.raw`(?:public\.)?"?([a-z_][a-z0-9_]*)"?`;

export function lintMigration(sql: string): string[] {
  const text = stripBodiesAndComments(sql);
  const problems: string[] = [];

  const createTable = new RegExp(
    String.raw`create\s+table\s+(?:if\s+not\s+exists\s+)?${ident}`,
    "gi",
  );
  for (const m of text.matchAll(createTable)) {
    const name = m[1].toLowerCase();
    const rls = new RegExp(
      String.raw`alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?"?${name}"?\s+enable\s+row\s+level\s+security`,
      "i",
    );
    if (!rls.test(text)) problems.push(`table ${name}: no ENABLE ROW LEVEL SECURITY`);
  }

  // Each CREATE FUNCTION statement runs to its terminating semicolon (bodies
  // are already blanked, so the first ';' after the header ends it).
  const createFn = new RegExp(
    String.raw`create\s+(?:or\s+replace\s+)?function\s+${ident}\s*\(([^;]*);`,
    "gi",
  );
  for (const m of text.matchAll(createFn)) {
    const name = m[1].toLowerCase();
    if (!/security\s+definer/i.test(m[2])) continue;
    // The function may be one of several in the statement's list
    // (`REVOKE ALL ON FUNCTION public.a(uuid), public.b(uuid) FROM PUBLIC`).
    const revoke = new RegExp(
      String.raw`revoke\s+[^;]*\bon\s+functions?\s+[^;]*?(?:public\.)?"?\b${name}"?\s*\([^;]*\bfrom\s+[^;]*\bpublic\b`,
      "i",
    );
    if (!revoke.test(text)) {
      problems.push(`function ${name}: SECURITY DEFINER without REVOKE … FROM PUBLIC`);
    }
  }
  return problems;
}

function versionOf(file: string): number | null {
  const m = /^migration-v(\d+)-/.exec(file);
  return m ? Number(m[1]) : null;
}

export function lintDirectory(dir: string, cutoff = CUTOFF_VERSION): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const file of readdirSync(dir)) {
    const v = versionOf(file);
    if (v === null || v < cutoff || !file.endsWith(".sql")) continue;
    const problems = lintMigration(readFileSync(join(dir, file), "utf8"));
    if (problems.length) out[file] = problems;
  }
  return out;
}

describe("migration lint — real migrations from the cutoff on", () => {
  it("finds the migrations directory (a wrong path must not pass silently)", () => {
    expect(readdirSync(MIGRATIONS_DIR).some((f) => versionOf(f) === CUTOFF_VERSION)).toBe(true);
  });

  it("every new table enables RLS and every SECURITY DEFINER function revokes PUBLIC", () => {
    expect(lintDirectory(MIGRATIONS_DIR)).toEqual({});
  });
});

describe("lintMigration", () => {
  it("passes a compliant migration", () => {
    const sql = `
      CREATE TABLE IF NOT EXISTS public.widgets (id bigint primary key);
      ALTER TABLE public.widgets ENABLE ROW LEVEL SECURITY;
      CREATE OR REPLACE FUNCTION public.do_thing(p int)
      RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
      BEGIN CREATE TABLE decoy (x int); END; $$;
      REVOKE ALL ON FUNCTION public.do_thing(int) FROM PUBLIC, anon, authenticated;
    `;
    expect(lintMigration(sql)).toEqual([]);
  });

  it("accepts a REVOKE naming several functions in one statement", () => {
    const sql = `
      CREATE OR REPLACE FUNCTION public.a(p uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
      CREATE OR REPLACE FUNCTION public.b(p uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
      REVOKE ALL ON FUNCTION public.a(uuid), public.b(uuid) FROM PUBLIC, anon, authenticated;
    `;
    expect(lintMigration(sql)).toEqual([]);
  });

  it("does not let a REVOKE on a similarly-named function satisfy the rule", () => {
    const sql = `
      CREATE FUNCTION public.list_x() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
      REVOKE ALL ON FUNCTION public.list_x_v2() FROM PUBLIC;
    `;
    expect(lintMigration(sql)).toEqual([
      "function list_x: SECURITY DEFINER without REVOKE … FROM PUBLIC",
    ]);
  });

  it("flags a table without RLS", () => {
    expect(lintMigration("CREATE TABLE public.leaky (id int);")).toEqual([
      "table leaky: no ENABLE ROW LEVEL SECURITY",
    ]);
  });

  it("flags a DEFINER function without REVOKE FROM PUBLIC (attribute after the body too)", () => {
    const sql = `CREATE FUNCTION public.f() RETURNS int AS $fn$ SELECT 1 $fn$ LANGUAGE sql SECURITY DEFINER;`;
    expect(lintMigration(sql)).toEqual([
      "function f: SECURITY DEFINER without REVOKE … FROM PUBLIC",
    ]);
  });

  it("ignores INVOKER functions and text inside comments or bodies", () => {
    const sql = `
      -- CREATE TABLE public.commented (id int);
      CREATE FUNCTION public.g() RETURNS int LANGUAGE sql AS $$ SELECT 1 /* SECURITY DEFINER */ $$;
    `;
    expect(lintMigration(sql)).toEqual([]);
  });

  it("go-red: a planted non-compliant migration at the cutoff fails the directory scan", () => {
    const dir = mkdtempSync(join(tmpdir(), "migration-lint-"));
    writeFileSync(join(dir, "migration-v999-planted.sql"), "CREATE TABLE public.planted (id int);");
    writeFileSync(join(dir, "migration-v100-historical.sql"), "CREATE TABLE public.old (id int);");
    expect(lintDirectory(dir)).toEqual({
      "migration-v999-planted.sql": ["table planted: no ENABLE ROW LEVEL SECURITY"],
    });
  });
});
