/**
 * A fitness function for the defect that recurred four times in one feature.
 *
 * Every one of these was the same mistake on a different field:
 *
 *   1. `tells` capped at 90 chars      → 6 of 10 cut, several mid-word
 *   2. `tells` with .min(1)            → 2 empty arrays discarded 23 good takes
 *   3. `where`  capped at .max(240)    → same trade, not yet triggered
 *   4. `auLine` capped at .max(240)    → one 241-char string lost 24 takes
 *
 * Each time the reasoning was about a single take rather than the batch it
 * arrives in, and each time the fix came with a test for that instance. An
 * instance test cannot prevent the fifth field: it passes happily while
 * someone adds `takeSummary: z.string().max(200)` next to it.
 *
 * So this asserts the RULE over the source, not the cases. Every
 * model-generated string in the take schema must truncate; none may reject.
 * Publishability is the validator's decision, per row, where an over-long or
 * empty value is a suppression rather than a lost batch.
 *
 * Reading source text is a blunt instrument. It is used deliberately: the
 * alternative is introspecting Zod internals, which is version-fragile and
 * would not obviously fail when someone writes the thing this exists to stop.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  TAKE_SYSTEM_PROMPT,
  TELL_CAP_CHARS,
  TELL_PROMPT_TARGET_CHARS,
  countTruncatedFields,
} from "../reddit-intel/take-writer";

const SOURCE = new URL("../reddit-intel/take-writer.ts", import.meta.url);

/**
 * The Zod object literal that shapes one generated take, with COMMENTS
 * STRIPPED.
 *
 * The first version of this guard failed on its own documentation: the schema
 * carries a comment reading "NOT .min(1)" explaining why that constraint was
 * removed, and the matcher read it as the constraint itself. A guard that
 * fires on prose about code is worse than no guard — it trains the next person
 * to dismiss it.
 */
function takeSchemaSource(): string {
  const src = readFileSync(SOURCE, "utf8");
  const start = src.indexOf("const TakeSchema = z.object({");
  expect(
    start,
    "TakeSchema not found — did the schema get renamed?",
  ).toBeGreaterThan(-1);
  const end = src.indexOf("});", start);
  return src
    .slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("take schema shape — the batch-rejection guard", () => {
  it("never rejects a model-written string on length", () => {
    // `.max(n)` on a string the MODEL writes throws a ZodError that takes the
    // whole batch with it. Length belongs in a transform.
    const schema = takeSchemaSource();
    const offenders = [...schema.matchAll(/z\s*\.?\s*string\(\)\s*\.max\(/g)];
    expect(
      offenders.length,
      "a model-written string field uses .max(), which rejects the entire " +
        "batch when the model overshoots by a word. Use the truncateOnWord " +
        "transform instead and let the validator decide publishability.",
    ).toBe(0);
  });

  it("never requires a minimum number of items from the model", () => {
    // `.min(1)` on `tells` discarded 23 good takes over 2 empty arrays. An
    // empty field is a suppression (`empty_take`), not a batch failure.
    const schema = takeSchemaSource();
    const offenders = [...schema.matchAll(/\.min\(\d+\)/g)];
    expect(
      offenders.length,
      "a field requires a minimum from the model. An absent or empty value " +
        "must be a per-row suppression, never a rejected batch.",
    ).toBe(0);
  });

  it("routes every prose field through the word-boundary truncator", () => {
    // The positive form of the first assertion: it is not enough to have
    // removed .max(), the cap has to actually be applied somewhere.
    const schema = takeSchemaSource();
    for (const field of ["tells", "where", "auLine"]) {
      expect(
        schema.includes(field),
        `${field} is missing from TakeSchema`,
      ).toBe(true);
    }
    expect(
      (schema.match(/truncateOnWord\(/g) ?? []).length,
      "each of tells / where / auLine must pass through truncateOnWord",
    ).toBeGreaterThanOrEqual(3);
  });

  /**
   * The cap and the instruction have to move together.
   *
   * The cap is a BACKSTOP: the prompt asks for 120 characters and the cap
   * exists so a model that overshoots produces a long tell instead of a lost
   * batch. That only holds while the cap sits well above the ask. It did not:
   * the cap was 140 against an ask of 120, a margin of 17%, and the model
   * cleared it often enough to clip 145 tells across 125 of the first 870
   * takes — one take in seven reached a reader with a visible "…".
   *
   * Nothing failed. A too-tight backstop is invisible to every gate: it
   * typechecks, it parses, it writes a row, and the page renders. It was
   * found by querying production for a trailing ellipsis a month later.
   *
   * So the ratio is the thing under test, and the prompt's number is PARSED
   * FROM THE PROMPT rather than repeated here — a copy would let the two drift
   * apart and still pass, which is the exact failure this guards.
   */
  it("keeps the tell cap a real backstop, not a second limit", () => {
    const asked = TAKE_SYSTEM_PROMPT.match(
      /each under (\d+) characters/,
    )?.[1];
    expect(
      asked,
      "the prompt no longer states a tell length in the form 'each under N " +
        "characters', so this guard has gone inert — update the pattern",
    ).toBeDefined();

    expect(
      Number(asked),
      "TELL_PROMPT_TARGET_CHARS disagrees with what the prompt actually asks",
    ).toBe(TELL_PROMPT_TARGET_CHARS);

    expect(
      TELL_CAP_CHARS / Number(asked),
      `the tell cap (${TELL_CAP_CHARS}) is not far enough above what the ` +
        `prompt asks for (${asked}). At 140 against 120 the model cleared it ` +
        "on 6% of tells and 14% of takes shipped visibly cut off. A backstop " +
        "the model reaches routinely is a second limit, and it fails silently.",
    ).toBeGreaterThanOrEqual(2);
  });

  it("counts a cut-short field so the cap can be tuned from production", () => {
    // The detector is what makes the cap adjustable from evidence instead of
    // from another ten-post dry run. If it stops counting, the next bad
    // threshold is invisible for as long as the last one was.
    expect(
      countTruncatedFields({
        feedItemId: 1,
        tells: ["fine", "cut off here…"],
        where: null,
        auLine: undefined,
      }),
    ).toBe(1);

    expect(
      countTruncatedFields({
        feedItemId: 1,
        tells: ["fine"],
        where: "also cut…",
        auLine: "and this one too…",
      }),
    ).toBe(2);

    expect(
      countTruncatedFields({
        feedItemId: 1,
        tells: ["fine", "also fine"],
        where: "complete sentence.",
        auLine: null,
      }),
    ).toBe(0);
  });

  it("keeps the identifier strict, because it is not model prose", () => {
    // The one field that SHOULD reject: a wrong feedItemId attaches a take to
    // the wrong post and publishes it beside the wrong Reddit permalink. This
    // asserts the rule is about model-written TEXT, not about laxness.
    expect(takeSchemaSource()).toContain("feedItemId: z.number().int()");
  });
});
