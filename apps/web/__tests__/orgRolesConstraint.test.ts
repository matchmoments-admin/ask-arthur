import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ASSIGNABLE_ORG_ROLES } from "@/lib/org-roles";

// The role set is declared twice: in SQL (the CHECK constraint on org_members
// and org_invitations — the real Interface, enforced by the database) and in
// apps/web/lib/org-roles.ts (what the invite / accept / members routes grant).
// Nothing tied them together. This reads the constraint as defined by the
// LATEST migration that sets it and requires the TS list plus "owner" (never
// grantable, but a valid stored role) to equal it exactly — so adding a role
// on one side without the other fails here.

const MIGRATIONS = new URL("../../../supabase/", import.meta.url);

function migrationsInOrder(): Array<{ name: string; sql: string }> {
  const version = (f: string) => Number(/migration-v(\d+)/.exec(f)?.[1] ?? -1);
  return readdirSync(MIGRATIONS)
    .filter((f) => /^migration-v\d+.*\.sql$/.test(f))
    .sort((a, b) => version(a) - version(b))
    .map((name) => ({ name, sql: readFileSync(new URL(name, MIGRATIONS), "utf8") }));
}

const parseList = (inner: string) =>
  [...inner.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();

/** Role values from the most recent migration that defines `<table>`'s role
 *  CHECK — either inline in CREATE TABLE or via ADD CONSTRAINT. */
function latestRoleCheck(table: string): { source: string; roles: string[] } {
  let found: { source: string; roles: string[] } | null = null;
  const addConstraint = new RegExp(
    `ADD\\s+CONSTRAINT\\s+${table}_role_check\\s+CHECK\\s*\\(\\s*role\\s+(?:=\\s*ANY\\s*\\(\\s*ARRAY\\s*\\[|IN\\s*\\()([^)\\]]*)`,
    "gi",
  );
  const createTable = new RegExp(
    `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:public\\.)?${table}\\s*\\(([\\s\\S]*?)\\n\\);`,
    "gi",
  );
  for (const { name, sql } of migrationsInOrder()) {
    for (const m of sql.matchAll(createTable)) {
      const inline = /\brole\s+TEXT[^,]*?CHECK\s*\(\s*role\s+IN\s*\(([^)]*)\)/i.exec(m[1]);
      if (inline) found = { source: name, roles: parseList(inline[1]) };
    }
    for (const m of sql.matchAll(addConstraint)) {
      found = { source: name, roles: parseList(m[1]) };
    }
  }
  if (!found) throw new Error(`no role CHECK found for ${table}`);
  return found;
}

describe("org role list ↔ SQL role constraint", () => {
  const expected = [...ASSIGNABLE_ORG_ROLES, "owner"].sort();

  it.each(["org_members", "org_invitations"])(
    "%s role CHECK equals ASSIGNABLE_ORG_ROLES + owner",
    (table) => {
      const { source, roles } = latestRoleCheck(table);
      expect(roles, `constraint defined in ${source}`).toEqual(expected);
    },
  );

  it("owner is never assignable", () => {
    expect(ASSIGNABLE_ORG_ROLES as readonly string[]).not.toContain("owner");
  });
});
