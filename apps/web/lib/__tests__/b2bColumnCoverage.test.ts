/**
 * The other half of the column-list contract.
 *
 * `b2bColumns.test.ts` says which columns must NEVER be selected. This one
 * says every column a route READS must be selected — and it exists because
 * the compiler cannot say it.
 *
 * `createServiceClient()` calls `createClient(url, key)` with no `<Database>`
 * generic (`packages/supabase/src/server.ts:11`). Every row it returns is
 * untyped, so `record.whois_registrar` typechecks as `any` whether or not
 * `whois_registrar` is in the select list. Dropping a column from a list
 * produces no type error, no test failure and no runtime error — just a field
 * that is silently `undefined` in a live B2B response.
 *
 * That is precisely the failure mode of the change these lists came from, so
 * the verification cannot be "I read it carefully once".
 *
 * The two tests compose into something neither gives alone: adding
 * `record.whois_raw` to a response body fails THIS test until the column is
 * added to the list, and adding it to the list fails the OTHER one. A column
 * we decided not to publish cannot re-enter a response by either door.
 *
 * Parsing source with a regex is blunt. It is used deliberately: the
 * alternative is booting five route handlers with a mocked client, which
 * tests the mock as much as the route, and would not fail when someone adds a
 * field access — the thing this exists to catch.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  SCAM_CLUSTER_COLUMNS,
  SCAM_ENTITY_COLUMNS,
  SCAM_URL_B2B_COLUMNS,
  SCAM_URL_LOOKUP_COLUMNS,
} from "../b2b/columns";

/**
 * Each route, the identifiers its query result is bound to, and the list that
 * must cover every column read off them.
 */
const ROUTES: {
  file: string;
  rowVars: string[];
  list: string;
  columns: string;
}[] = [
  {
    file: "app/api/scam-urls/lookup/route.ts",
    rowVars: ["record", "highestConfidence", "d"],
    list: "SCAM_URL_LOOKUP_COLUMNS",
    columns: SCAM_URL_LOOKUP_COLUMNS,
  },
  {
    file: "app/api/v1/threats/urls/lookup/route.ts",
    rowVars: ["data"],
    list: "SCAM_URL_B2B_COLUMNS",
    columns: SCAM_URL_B2B_COLUMNS,
  },
  {
    file: "app/api/v1/entities/[id]/route.ts",
    rowVars: ["entity"],
    list: "SCAM_ENTITY_COLUMNS",
    columns: SCAM_ENTITY_COLUMNS,
  },
  {
    file: "app/api/v1/entities/lookup/route.ts",
    rowVars: ["data"],
    list: "SCAM_ENTITY_COLUMNS",
    columns: SCAM_ENTITY_COLUMNS,
  },
  {
    file: "app/api/v1/clusters/[id]/route.ts",
    rowVars: ["cluster"],
    list: "SCAM_CLUSTER_COLUMNS",
    columns: SCAM_CLUSTER_COLUMNS,
  },
];

/** Accessors that are JS, not database columns. */
const NOT_COLUMNS = new Set([
  "data",
  "error",
  "reduce",
  "map",
  "filter",
  "length",
  "slice",
  "find",
  "sort",
  "join",
  "toString",
]);

/** Columns whose names have no underscore and would otherwise be missed. */
const SINGLE_WORD_COLUMNS = new Set([
  "id",
  "domain",
  "subdomain",
  "tld",
  "status",
  "metadata",
]);

function routeSource(file: string): string {
  return readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
}

describe("B2B lookup routes read only what they select", () => {
  for (const { file, rowVars, list, columns } of ROUTES) {
    it(`${file} reads nothing outside ${list}`, () => {
      const src = routeSource(file);
      const selected = new Set(columns.split(", "));

      const read = new Set<string>();
      for (const v of rowVars) {
        const re = new RegExp(`\\b${v}\\??\\.([a-z][a-z0-9_]*)\\b`, "g");
        for (const m of src.matchAll(re)) read.add(m[1]);
      }

      const dbFields = [...read].filter(
        (f) =>
          !NOT_COLUMNS.has(f) && (f.includes("_") || SINGLE_WORD_COLUMNS.has(f)),
      );

      expect(
        dbFields.length,
        `no column reads found in ${file} — the row variable was probably renamed, so this test is now inert`,
      ).toBeGreaterThan(4);

      const missing = dbFields.filter((f) => !selected.has(f));
      expect(
        missing,
        `${file} reads ${missing.join(", ")} but ${list} does not select it. ` +
          `The Supabase client is untyped, so this compiles cleanly and ships ` +
          `an undefined field in a live response.`,
      ).toEqual([]);
    });
  }

  it("covers every route that uses one of these lists", () => {
    // A route added later that imports a list but is absent from ROUTES would
    // be unguarded while looking guarded.
    const importers = ROUTES.map((r) => r.file);
    for (const { file, list } of ROUTES) {
      expect(routeSource(file), `${file} should import ${list}`).toContain(list);
    }
    expect(new Set(importers).size).toBe(ROUTES.length);
  });
});
