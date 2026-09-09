import { describe, expect, it } from "vitest";

import { bareFunctionId } from "../analyze-failure";

/**
 * `inngest/function.failed` carries the ABSOLUTE function id — the app id and
 * the function id joined by a hyphen. `InngestFunction.id(prefix)` is
 * `[prefix, opts.id].filter(Boolean).join("-")`, and the SDK's own onFailure
 * trigger compares `event.data.function_id == '<prefixed id>'`. With
 * `new Inngest({ id: "askarthur" })` the value is "askarthur-analyze-report".
 *
 * WHAT THAT COST. analyze-failure-subscriber filtered with
 * `fnId.startsWith("analyze-")`, which is false for every real event — so the
 * subscriber returned `{ filtered: true }` for the entire fleet, including the
 * analyze functions it exists for, and has logged NOTHING since it was
 * written. #1135's self-exclusion was inert for the same reason. Neither was
 * visible from inside the file: both read correctly and both compared against
 * a string shape the platform never sends.
 *
 * Go-red: return `fnId` unchanged.
 */
describe("bareFunctionId", () => {
  it("strips the app prefix the platform actually sends", () => {
    expect(bareFunctionId("askarthur-analyze-report")).toBe("analyze-report");
    expect(bareFunctionId("askarthur-analyze-failure-subscriber")).toBe(
      "analyze-failure-subscriber",
    );
  });

  it("leaves an unprefixed id alone", () => {
    // Defensive: the prefix is inferred from the SDK's id() implementation
    // rather than from a captured production payload, so the unprefixed form
    // must keep working.
    expect(bareFunctionId("analyze-report")).toBe("analyze-report");
    expect(bareFunctionId("unknown")).toBe("unknown");
  });

  it("does not strip a lookalike that merely contains the app id", () => {
    expect(bareFunctionId("not-askarthur-analyze-report")).toBe(
      "not-askarthur-analyze-report",
    );
  });

  it("restores the family filter it broke", () => {
    // The property that matters: an analyze-* function's failure must pass
    // the prefix test, and a clone-watch one must not.
    expect(
      bareFunctionId("askarthur-analyze-report").startsWith("analyze-"),
    ).toBe(true);
    expect(
      bareFunctionId("askarthur-clone-watch-urlscan-submit").startsWith(
        "analyze-",
      ),
    ).toBe(false);
  });
});
