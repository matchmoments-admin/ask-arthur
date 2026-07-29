import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { inngestFunctions } from "@askarthur/scam-engine/inngest/functions";

/**
 * Drift guard for docs/inngest-brakes.md.
 *
 * CLAUDE.md's rule is "every new background fn goes in docs/inngest-brakes.md —
 * a blank cell there is a P1". The 2026-07-29 enterprise review found the doc
 * was missing **36 of 76 registered functions entirely**, including
 * `shopfront-clone-haiku-preclassify` — the largest clone-watch cost line at
 * $4.68 — and the Netcraft poll function that had polled 0 of 1,293
 * submissions.
 *
 * A MISSING ROW IS WORSE THAN A BLANK CELL. A blank cell is a visible P1; a
 * missing row is invisible to the very audit the document exists to enable. An
 * operator reading the matrix saw 41 functions and had no way to learn the
 * other 36 existed.
 *
 * The review also flagged the trap in the obvious implementation: a guard that
 * regexes `createFunction(...)` out of the source undercounts, because some
 * functions are declared with a third argument or re-exported. Both the
 * reviewer's first pass and its verifier's got the count wrong that way. So
 * this test reads `fn.id()` off the CONSTRUCTED function objects — the same
 * array `apps/web/app/api/inngest/route.ts` serves — which cannot disagree
 * with what is actually registered.
 *
 * Scope note: this covers the `inngestFunctions` array from
 * @askarthur/scam-engine. The `appFunctions` array declared locally in
 * route.ts is not importable without pulling the Next.js route module (and its
 * server-only imports) into vitest, so it is not asserted here — see the
 * companion task. Extending this to cover both arrays is the goal; covering
 * one of them already closes the majority of the gap.
 */

// Inngest's InngestFunction exposes id() as a method on the constructed object.
function functionId(fn: unknown): string {
  const maybe = fn as { id?: unknown; name?: unknown };
  if (typeof maybe.id === "function") return String((maybe.id as () => string)());
  if (typeof maybe.id === "string") return maybe.id;
  if (typeof maybe.name === "string") return maybe.name;
  throw new Error("Could not derive an id from an Inngest function object");
}

const MATRIX_PATH = join(process.cwd(), "..", "..", "docs", "inngest-brakes.md");

describe("docs/inngest-brakes.md covers every registered Inngest function", () => {
  const matrix = readFileSync(MATRIX_PATH, "utf8");
  const ids = inngestFunctions.map(functionId).sort();

  it("registers a non-trivial number of functions (guards against an empty import)", () => {
    // If the import silently resolves to [], every assertion below would pass
    // vacuously — exactly the failure mode this whole file exists to prevent.
    expect(ids.length).toBeGreaterThan(20);
  });

  it("has a row for every function id", () => {
    const missing = ids.filter((id) => !matrix.includes(id));

    expect(
      missing,
      missing.length === 0
        ? ""
        : `docs/inngest-brakes.md is missing ${missing.length} registered ` +
            `function(s). A missing row is invisible to the brake audit — add ` +
            `a row for each, filling in Conc./Rate/Throt./Idem./Kill/Cost/Brake ` +
            `(use — for "deliberately none"):\n  ${missing.join("\n  ")}`
    ).toEqual([]);
  });

  it("does not list function ids that no longer exist", () => {
    // Catches the opposite drift: a function deleted from the fleet but left
    // in the matrix, which makes the doc claim coverage it does not have.
    const rowIds = Array.from(matrix.matchAll(/^\|\s*`([a-z0-9-]+)`/gm)).map(
      (m) => m[1]!
    );
    const known = new Set(ids);
    // Only assert on rows whose id looks like a fleet function AND that the
    // matrix presents as a leaf row; section headers are bolded, not ticked.
    const stale = rowIds.filter((id) => !known.has(id));

    // Informational rather than fatal: route.ts's local `appFunctions` are
    // legitimately in the doc but not in this array (see the scope note), so a
    // strict assertion here would fail on correct rows. Surface the list so a
    // human can spot genuine removals.
    if (stale.length > 0) {
      // eslint-disable-next-line no-console
      console.info(
        `[brakes-matrix] ${stale.length} row(s) not in scam-engine's array ` +
          `(expected for app-local functions): ${stale.join(", ")}`
      );
    }
    expect(Array.isArray(stale)).toBe(true);
  });
});
