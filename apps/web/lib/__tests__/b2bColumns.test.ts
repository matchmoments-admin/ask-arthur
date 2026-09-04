/**
 * The contract for the public and B2B lookup routes' column lists.
 *
 * This exists because `select("*")` is how `/api/feed` came to publish
 * `feed_items.body_md`. The column list was "whatever the table has today", so
 * a column added months later was published by a route nobody had touched.
 *
 * The five routes covered here were the same shape. Replacing the wildcards
 * fixed the instance; this test is what stops the class coming back, because
 * it fails on a column that does not exist yet — which is the only kind of
 * failure that would have helped in the feed case.
 *
 * Each forbidden column is named WITH ITS REASON. A bare list of strings gets
 * deleted by the next person who needs one of them; a reason gets argued with,
 * which is the outcome we want.
 */
import { describe, expect, it } from "vitest";

import {
  SCAM_CLUSTER_COLUMNS,
  SCAM_ENTITY_COLUMNS,
  SCAM_URL_B2B_COLUMNS,
  SCAM_URL_LOOKUP_COLUMNS,
} from "../b2b/columns";

const FORBIDDEN: { list: string; column: string; why: string }[] = [
  {
    list: "SCAM_URL_LOOKUP_COLUMNS",
    column: "whois_raw",
    why: "the unparsed WHOIS record — registrant name, email and phone survive in it whenever the registrar does not redact",
  },
  {
    list: "SCAM_URL_B2B_COLUMNS",
    column: "whois_raw",
    why: "same raw record; the parsed whois_* fields beside it are what the API is for",
  },
  {
    list: "SCAM_ENTITY_COLUMNS",
    column: "raw_value",
    why: "the entity exactly as reported — a phone number, an email, a wallet. normalized_value exists precisely because it is the one safe to publish",
  },
  {
    list: "SCAM_ENTITY_COLUMNS",
    column: "investigation_data",
    why: "internal investigation state",
  },
  {
    list: "SCAM_ENTITY_COLUMNS",
    column: "evidence_r2_key",
    why: "a pointer into private object storage",
  },
  {
    list: "SCAM_ENTITY_COLUMNS",
    column: "legal_basis",
    why: "compliance provenance — ours to record, not a customer-facing field",
  },
  {
    list: "SCAM_ENTITY_COLUMNS",
    column: "consent_basis",
    why: "compliance provenance — ours to record, not a customer-facing field",
  },
  {
    list: "SCAM_CLUSTER_COLUMNS",
    column: "total_loss",
    why: "aggregate reported financial loss — an internal figure, and publishing it invites citation as a statistic we have not stood behind",
  },
];

const LISTS: Record<string, string> = {
  SCAM_URL_LOOKUP_COLUMNS,
  SCAM_URL_B2B_COLUMNS,
  SCAM_ENTITY_COLUMNS,
  SCAM_CLUSTER_COLUMNS,
};

describe("B2B lookup column lists", () => {
  for (const { list, column, why } of FORBIDDEN) {
    it(`${list} does not select ${column}`, () => {
      const cols = LISTS[list].split(", ");
      expect(cols, `${column} must stay out of ${list}: ${why}`).not.toContain(
        column,
      );
    });
  }

  it("never reintroduces the wildcard", () => {
    for (const [name, value] of Object.entries(LISTS)) {
      expect(value, `${name} is a wildcard again`).not.toBe("*");
      expect(value.split(", ").length, `${name} looks empty`).toBeGreaterThan(5);
    }
  });

  /**
   * The type-inference trap, asserted structurally.
   *
   * supabase-js reads the row type off the STRING LITERAL passed to
   * `.select()`. A `.join()`, a template substitution or a `+` widens it to
   * `string`, the result degrades to ParserError/GenericStringError, and every
   * field access on it silently becomes `any`. The compiler stops checking the
   * route at exactly the moment the list stops being a literal, and nothing
   * about that is visible at the call site.
   */
  it("keeps every list a plain single literal", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../b2b/columns.ts", import.meta.url), "utf8"),
    );
    const body = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    for (const name of Object.keys(LISTS)) {
      const decl = body.slice(body.indexOf(`export const ${name}`));
      const value = decl.slice(decl.indexOf("=") + 1, decl.indexOf(";"));
      expect(
        /^\s*"[^"]*"\s*$/.test(value),
        `${name} must be one double-quoted literal — a join, template or ` +
          `concatenation widens the type to string and degrades the query ` +
          `result to ParserError, which typechecks clean and returns nothing`,
      ).toBe(true);
    }
  });
});
