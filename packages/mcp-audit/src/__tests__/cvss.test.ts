import { describe, expect, it } from "vitest";

import { cvssV3BaseScore, isCriticalVuln, osvSeverityScore } from "../cvss";

/**
 * These vectors and their scores are from the CVSS v3.1 specification's own
 * examples and from live OSV entries fetched 2026-09-07. They are the point of
 * this file: the previous code did `parseFloat(vector)`, which is NaN, and
 * `NaN >= 9.0` is false — so MCP-SC-001 could never report "fail".
 */
describe("cvssV3BaseScore matches the specification", () => {
  it.each([
    ["CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", 9.8],
    ["CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H", 7.2],
    ["CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H", 10.0],
    ["CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L", 5.3],
    ["CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N", 0],
    ["CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", 9.8],
  ])("%s -> %s", (vector, expected) => {
    expect(cvssV3BaseScore(vector)).toBe(expected);
  });

  it("returns null — not 0 — for anything it cannot parse", () => {
    // null must not be coerced to a low score by a caller: "unknown" and
    // "harmless" are different answers, and conflating them is how a security
    // control silently passes.
    expect(cvssV3BaseScore("not a vector")).toBeNull();
    expect(cvssV3BaseScore("CVSS:2.0/AV:N/AC:L/Au:N/C:P/I:P/A:P")).toBeNull();
    expect(cvssV3BaseScore("CVSS:3.1/AV:Z/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H")).toBeNull();
  });
});

describe("osvSeverityScore reads a real OSV entry", () => {
  it("computes from the CVSS vector OSV actually returns", () => {
    // Verbatim from api.osv.dev for lodash 4.17.15, 2026-09-07.
    const vuln = {
      severity: [
        { type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H" },
      ],
      database_specific: { severity: "HIGH" },
    };
    expect(osvSeverityScore(vuln)).toBe(7.2);
    expect(isCriticalVuln(vuln)).toBe(false);
  });

  it("flags a genuinely critical advisory", () => {
    // THE REGRESSION TEST. Under the old parseFloat(score) this returned
    // false, so a 9.8 in the dependency tree scored MCP-SC-001 as "warn"/5
    // instead of "fail"/0.
    expect(
      isCriticalVuln({
        severity: [
          { type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" },
        ],
      }),
    ).toBe(true);
  });

  it("falls back to the advisory label when no vector parses", () => {
    expect(
      osvSeverityScore({ severity: [], database_specific: { severity: "CRITICAL" } }),
    ).toBe(9.0);
  });

  it("accepts a numeric score if a source ever supplies one", () => {
    expect(osvSeverityScore({ severity: [{ type: "CVSS_V2", score: "9.3" }] })).toBe(9.3);
  });

  it("returns null when there is nothing to go on", () => {
    expect(osvSeverityScore({})).toBeNull();
    expect(isCriticalVuln({})).toBe(false);
  });
});
