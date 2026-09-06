/**
 * Both badge routes must answer the trust question the same way.
 *
 * THIS GUARDS A MISTAKE I MADE IN THE FIX ITSELF.
 *
 * `/api/badge` used to render whatever the query string asked for. Closing that
 * meant giving it a `sites` lookup — and I wrote a second one, beside the one
 * `app/badge/[domain]/route.ts` already had. Within the same change the two
 * copies disagreed:
 *
 *     /api/badge        ["A+", "A", "A-", "B+", "B", "B-"]
 *     /badge/[domain]   ["A+", "A", "B"]
 *
 * A site graded B+ would have earned a badge from one route and "Needs
 * improvement" from the other. In the change whose whole point was that the
 * badge must tell the truth, I shipped two versions of what the truth is.
 *
 * So the assertion is structural: neither route may hold its own copy of the
 * eligibility rule, the grade colours, or the wording. A test that only
 * compared two constants would pass the moment someone inlined a third.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  BADGE_ELIGIBLE_GRADES,
  BADGE_MESSAGES,
  badgeGradeColor,
} from "@/lib/badge/eligibility";

const ROUTES = [
  "../app/api/badge/route.ts",
  "../app/badge/[domain]/route.ts",
] as const;

function source(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("the badge decision has one home", () => {
  for (const rel of ROUTES) {
    const name = rel.replace("../app/", "");

    it(`${name} does not redeclare the eligibility rule`, () => {
      expect(
        /ELIGIBLE_GRADES\s*[:=]\s*new Set/.test(source(rel)),
        `${name} declares its own eligible-grade set. Two routes deciding ` +
          "who earns a badge WILL drift — they already did once, disagreeing " +
          "on B+ within a single change. Import BADGE_ELIGIBLE_GRADES.",
      ).toBe(false);
    });

    it(`${name} does not redeclare the grade colours`, () => {
      expect(
        /GRADE_COLORS\s*:\s*Record/.test(source(rel)),
        `${name} declares its own colour table. The two copies already had ` +
          "different coverage — one knew about A-/B+/C-, the other did not.",
      ).toBe(false);
    });

    it(`${name} does not hardcode the neutral wording`, () => {
      const src = source(rel);
      for (const message of Object.values(BADGE_MESSAGES)) {
        expect(
          src.includes(`"${message}"`),
          `${name} hardcodes "${message}". Use BADGE_MESSAGES so both routes ` +
            "describe the same state in the same words.",
        ).toBe(false);
      }
    });

    it(`${name} resolves its subject through the shared module`, () => {
      // The positive form: it is not enough to have removed the duplicates,
      // the route has to actually consult the one home.
      expect(source(rel)).toContain("resolveBadgeSubject");
    });

    it(`${name} does not query the sites table directly`, () => {
      expect(
        /from\(\s*["']sites["']\s*\)/.test(source(rel)),
        `${name} reads the sites table itself. The lookup and the rule belong ` +
          "together — separating them is how the eligibility check drifts " +
          "away from the data it is meant to gate.",
      ).toBe(false);
    });
  }

  it("the shared rule has no gap where a better grade is refused", () => {
    // The bug in the ORIGINAL set: it admitted B while excluding A- and B+,
    // so a site could be graded better than one that qualifies and be turned
    // away. Assert the eligible set is a prefix of the grade ordering.
    const ORDER = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D", "F"];
    const indices = ORDER.map((g, i) => (BADGE_ELIGIBLE_GRADES.has(g) ? i : -1))
      .filter((i) => i >= 0);
    expect(indices, "eligible grades are not contiguous from the top").toEqual(
      indices.map((_, i) => i),
    );
  });

  it("every grade has a colour, including the ineligible ones", () => {
    // Ineligible grades still render in the [domain] route's neutral path and
    // in admin surfaces; a missing colour would silently fall back to red.
    for (const g of ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D", "F"]) {
      expect(badgeGradeColor(g), `${g} has no colour`).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});
