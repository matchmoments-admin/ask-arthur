/**
 * The drift guard for the canonical scam-type vocabulary.
 *
 * Four columns carry a scam category and no two agree. The three that matter
 * disagree SILENTLY — `romance` vs `romance_scam`, `investment` vs
 * `investment_fraud`, `smishing` vs `sms_scam` — so any union or join
 * under-counts each by exactly the other stream's share, with no error and
 * nothing to notice. That is how it went unnoticed for a year.
 *
 * A mapping that lets a new label through unmapped would recreate the problem
 * one value at a time, so the assertion is not "the map is correct today"
 * (which nothing can check) but "no vocabulary contains a value the map has
 * never heard of" — which fails on the NEXT label anyone adds to either side.
 *
 * The analyze vocabulary is PARSED OUT OF THE PROMPT rather than copied here.
 * A copy would let the prompt and the map drift apart and still pass, which is
 * the exact failure this exists to stop. Same reason the tell-cap guard parses
 * its number out of the take prompt.
 *
 * This test lives in scam-engine rather than beside the module because
 * @askarthur/types has no test runner, and because only this package can see
 * claude.ts.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { INTENT_LABELS } from "@askarthur/types/analysis";
import {
  CANONICAL_SCAM_TYPES,
  CANONICAL_SCAM_TYPE_LABELS,
  knownRawScamTypes,
  toCanonicalScamType,
} from "@askarthur/types/scam-taxonomy";

/** The `scamType` enum the analyze prompt actually asks Claude for. */
function analyzePromptVocabulary(): string[] {
  const src = readFileSync(new URL("../claude.ts", import.meta.url), "utf8");
  const m = src.match(/"scamType":\s*"([a-z_|]+)"/);
  expect(
    m,
    'the analyze prompt no longer states its scamType enum as "a|b|c" — this ' +
      "guard has gone inert, update the pattern",
  ).not.toBeNull();
  return m![1].split("|");
}

describe("canonical scam-type taxonomy", () => {
  it("maps every value the Reddit classifier can produce", () => {
    const unmapped = INTENT_LABELS.filter(
      (l) => !knownRawScamTypes().includes(l),
    );
    expect(
      unmapped,
      `INTENT_LABELS contains ${unmapped.join(", ")} with no entry in the ` +
        "taxonomy. An unmapped label resolves to null and silently vanishes " +
        "from every scam-type count.",
    ).toEqual([]);
  });

  it("maps every value the analyze prompt can produce", () => {
    const unmapped = analyzePromptVocabulary().filter(
      (v) => !knownRawScamTypes().includes(v),
    );
    expect(
      unmapped,
      `the analyze prompt can return ${unmapped.join(", ")}, which the ` +
        "taxonomy has never heard of.",
    ).toEqual([]);
  });

  it("converges the three vocabularies that silently disagreed", () => {
    // The whole reason the module exists. If any of these three stops
    // converging, cross-stream counts start under-reporting again.
    expect(toCanonicalScamType("romance")).toBe(
      toCanonicalScamType("romance_scam"),
    );
    expect(toCanonicalScamType("investment")).toBe(
      toCanonicalScamType("investment_fraud"),
    );
    expect(toCanonicalScamType("smishing")).toBe(
      toCanonicalScamType("sms_scam"),
    );
    // ...and does not over-converge things that are genuinely different.
    expect(toCanonicalScamType("phishing")).not.toBe(
      toCanonicalScamType("sms_scam"),
    );
  });

  it("treats 'not a scam' as null, never as `other`", () => {
    // `other` means "a scam we could not categorise". `informational` (251
    // rows) and `none` (7) mean "not a scam at all". Bucketing them into
    // `other` would inflate every total with posts we judged not to be scams.
    expect(toCanonicalScamType("informational")).toBeNull();
    expect(toCanonicalScamType("none")).toBeNull();
    expect(toCanonicalScamType("other")).toBe("other");
  });

  it("returns null for an unknown value rather than guessing", () => {
    // Silently bucketing an unknown into `other` would hide a new label the
    // moment someone added one — which is how the three disagreements
    // survived. The drift tests above are what make null safe here.
    expect(toCanonicalScamType("brand_new_category")).toBeNull();
    expect(toCanonicalScamType("")).toBeNull();
    expect(toCanonicalScamType(null)).toBeNull();
    expect(toCanonicalScamType(undefined)).toBeNull();
  });

  it("handles the free-text strays the column actually contains", () => {
    // scam_type is `parsed.scamType.slice(0, 100)` in claude.ts — never
    // constrained — so the model's own compounds land in the column.
    expect(toCanonicalScamType("work_from_home_advance_fee")).toBe(
      "advance_fee",
    );
    expect(toCanonicalScamType("  Phishing  ")).toBe("phishing");
  });

  it("gives every canonical type a display name", () => {
    for (const t of CANONICAL_SCAM_TYPES) {
      expect(
        CANONICAL_SCAM_TYPE_LABELS[t],
        `${t} has no label, so it would render as a raw key`,
      ).toBeTruthy();
    }
  });

  it("maps every raw value to a real canonical type or an explicit null", () => {
    for (const raw of knownRawScamTypes()) {
      const c = toCanonicalScamType(raw);
      if (c !== null) {
        expect(
          CANONICAL_SCAM_TYPES as readonly string[],
          `${raw} maps to ${c}, which is not a canonical type`,
        ).toContain(c);
      }
    }
  });
});
