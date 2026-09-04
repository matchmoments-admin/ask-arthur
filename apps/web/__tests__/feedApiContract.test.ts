/**
 * What the public feed is allowed to publish.
 *
 * Both feed readers used `select("*")`, which is not a shortcut — it is a
 * standing decision to publish every column the table ever grows. Two were
 * reaching the public that should not have been, and one of them was measured
 * on the live site: `/api/feed?limit=3` returned 282 characters of `body_md`
 * for id 42321, while migration-v299's header and the privacy-impact
 * assessment both stated that column "is not exposed by any public endpoint".
 *
 * migration-v302 revoked `body_md` from `anon`, which closed the direct
 * PostgREST door. It could not close this one: these readers use the SERVICE
 * client, and service_role bypasses column grants by design. Only an explicit
 * column list closes it, and only a test keeps it closed.
 */
import { describe, expect, it } from "vitest";

import { FEED_ITEM_COLUMNS, FEED_ITEM_SELECT } from "@/lib/feed";

/**
 * Columns that must never appear in a public feed payload, with the reason —
 * so a future edit that adds one back has to argue with the reason rather
 * than just a failing assertion.
 */
const FORBIDDEN: Record<string, string> = {
  body_md:
    "fuller source text, held for analysis only; publishing it breaks the " +
    "no-full-body-republication position in reddit-intel-reddit-tos.md",
  embedding:
    "1024-dim vector, ~12.5 KB per row, useless to any client and a large " +
    "share of the response",
  embedding_model_version: "internal detail of the embedding pipeline",
  evidence_r2_key: "internal storage key",
  competitor_extracted_at: "internal pipeline bookkeeping",
};

describe("public feed column contract", () => {
  it("never publishes a forbidden column", () => {
    for (const [column, why] of Object.entries(FORBIDDEN)) {
      expect(
        FEED_ITEM_COLUMNS.includes(column),
        `${column} must not be in the public feed payload: ${why}`,
      ).toBe(false);
    }
  });

  it("does not use a wildcard select", () => {
    // The specific regression. "*" would pass every other assertion here
    // while publishing all of them.
    expect(FEED_ITEM_SELECT).not.toContain("*");
  });

  it("still carries everything the cards and filters need", () => {
    // The other direction: over-trimming would silently blank the feed UI.
    // These are the fields FeedCard and FeedList actually read.
    const required = [
      "id",
      "source",
      "title",
      "description",
      "source_url",
      "category",
      "country_code",
      "upvotes",
      "verified",
      "created_at",
      "source_created_at",
      "r2_image_key",
      "reddit_image_url",
      "has_image",
      "impersonated_brand",
    ];
    for (const column of required) {
      expect(FEED_ITEM_COLUMNS, `card/filter field ${column}`).toContain(column);
    }
  });

  it("keeps the select string parseable back into the column list", () => {
    // FEED_ITEM_COLUMNS is derived by splitting the literal, because
    // supabase-js infers the row type from the literal and a computed value
    // degrades every caller's result type. If the separator convention drifts
    // (a newline, a double space) the derived list silently becomes wrong and
    // the forbidden-column check above stops meaning anything.
    expect(FEED_ITEM_COLUMNS.length).toBeGreaterThan(10);
    for (const column of FEED_ITEM_COLUMNS) {
      expect(column, `"${column}" is not a bare column name`).toMatch(
        /^[a-z][a-z0-9_]*$/,
      );
    }
  });
});
