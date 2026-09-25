// Account-table write privileges — a fitness check on the real database.
//
// v321/v322 (2026-09-24) removed Supabase's default table-level INSERT/UPDATE
// grants from `anon` and `authenticated` on the tables whose columns the
// server owns (key tiers and limits, billing, membership roles, invitations),
// leaving writes to the service role and SECURITY DEFINER functions. Nothing
// stops a later migration (or a dashboard click) from granting them back —
// Supabase's default privileges re-grant ALL on any table created later. This
// check asserts the intended state directly from the catalog.
//
// CI posture: skipped unless both are set —
//   SUPABASE_INTEGRATION_TEST_URL   (same var as rpcs.smoke; the project ref
//                                    is read from its host, <ref>.supabase.co)
//   SUPABASE_ACCESS_TOKEN           (Management API — catalog SQL cannot go
//                                    through PostgREST, which does not expose
//                                    information_schema)
// v323 also closed read paths: `organizations` is readable only column-by-
// column (authenticated, never fleet_webhook_secret; anon not at all), and
// `site_audits` / `sites` carry no anon/authenticated privileges.
//
// Read-only: it runs SELECTs against information_schema. Safe against prod.
//
//   SUPABASE_INTEGRATION_TEST_URL=https://<ref>.supabase.co \
//   SUPABASE_ACCESS_TOKEN=<token> \
//   pnpm --filter @askarthur/scam-engine test account-privileges

import { describe, expect, it } from "vitest";

const url = process.env.SUPABASE_INTEGRATION_TEST_URL;
const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const projectRef = url ? new URL(url).hostname.split(".")[0] : undefined;
const hasEnv = Boolean(projectRef && token);

/** Tables whose writes belong to the service role / DEFINER functions only. */
const SERVER_WRITTEN_TABLES = [
  "api_keys",
  "user_profiles",
  "org_members",
  "org_invitations",
  "organizations",
  "subscriptions",
  "extension_subscriptions",
  "family_groups",
  "family_members",
  "phone_footprint_monitors",
] as const;

/** The only user-writable columns on those tables (user-editable profile). */
const ALLOWED_COLUMN_GRANTS = new Set([
  "authenticated:user_profiles:UPDATE:display_name",
  "authenticated:user_profiles:UPDATE:company_name",
]);

async function sql<T>(query: string): Promise<T[]> {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    },
  );
  const body = await res.text();
  if (!res.ok) throw new Error(`catalog query failed (${res.status}): ${body.slice(0, 300)}`);
  return JSON.parse(body) as T[];
}

const tableList = SERVER_WRITTEN_TABLES.map((t) => `'${t}'`).join(",");

describe.skipIf(!hasEnv)("account-table write privileges (live catalog)", () => {
  it("anon/authenticated hold no table-level INSERT or UPDATE", async () => {
    const rows = await sql<{ grantee: string; table_name: string; privilege_type: string }>(`
      SELECT grantee, table_name, privilege_type
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name IN (${tableList})
        AND grantee IN ('anon', 'authenticated')
        AND privilege_type IN ('INSERT', 'UPDATE')
      ORDER BY 1, 2, 3`);
    expect(rows.map((r) => `${r.grantee}:${r.table_name}:${r.privilege_type}`)).toEqual([]);
  }, 30_000);

  it("column-level INSERT/UPDATE grants are exactly the allowed profile fields", async () => {
    const rows = await sql<{ grantee: string; table_name: string; privilege_type: string; column_name: string }>(`
      SELECT grantee, table_name, privilege_type, column_name
      FROM information_schema.column_privileges
      WHERE table_schema = 'public'
        AND table_name IN (${tableList})
        AND grantee IN ('anon', 'authenticated')
        AND privilege_type IN ('INSERT', 'UPDATE')`);
    // column_privileges also lists columns covered by a table-level grant;
    // the first test proves there are none, so every row here is a column grant.
    const actual = rows
      .map((r) => `${r.grantee}:${r.table_name}:${r.privilege_type}:${r.column_name}`)
      .sort();
    expect(actual).toEqual([...ALLOWED_COLUMN_GRANTS].sort());
  }, 30_000);

  it("organizations: no table-level SELECT; authenticated reads every column except fleet_webhook_secret; anon reads nothing", async () => {
    const tableSelect = await sql<{ grantee: string }>(`
      SELECT grantee FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'organizations'
        AND grantee IN ('anon', 'authenticated') AND privilege_type = 'SELECT'`);
    expect(tableSelect).toEqual([]);

    const cols = await sql<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'organizations'`);
    const readable = await sql<{ grantee: string; column_name: string }>(`
      SELECT grantee, column_name FROM information_schema.column_privileges
      WHERE table_schema = 'public' AND table_name = 'organizations'
        AND grantee IN ('anon', 'authenticated') AND privilege_type = 'SELECT'`);
    expect(readable.filter((r) => r.grantee === "anon")).toEqual([]);
    const authCols = readable.filter((r) => r.grantee === "authenticated").map((r) => r.column_name).sort();
    const expected = cols.map((c) => c.column_name).filter((c) => c !== "fleet_webhook_secret").sort();
    expect(authCols).toEqual(expected);
  }, 30_000);

  it("site_audits and sites grant nothing to anon/authenticated", async () => {
    const rows = await sql<{ grantee: string; table_name: string; privilege_type: string }>(`
      SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name IN ('site_audits', 'sites')
        AND grantee IN ('anon', 'authenticated')
      UNION ALL
      SELECT grantee, table_name, privilege_type FROM information_schema.column_privileges
      WHERE table_schema = 'public' AND table_name IN ('site_audits', 'sites')
        AND grantee IN ('anon', 'authenticated')`);
    expect(rows.map((r) => `${r.grantee}:${r.table_name}:${r.privilege_type}`)).toEqual([]);
  }, 30_000);
});
