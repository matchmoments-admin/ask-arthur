import { describe, it, expect } from "vitest";
import { z } from "zod";

// Regression test for the 2026-05-10 reddit-intel classifier outage:
// the defensive preprocess that JSON.parse'd string-encoded arrays
// would throw a raw SyntaxError on malformed input, crashing the
// whole batch with an opaque "Unterminated string in JSON" error
// instead of a clean Zod schema-mismatch. The fix wraps JSON.parse
// in try/catch and returns the raw string on failure so Zod can
// produce a meaningful "expected array, received string" diagnostic.
//
// (The io: 'input' vs 'output' question explored during diagnosis
// turned out to be a no-op in Zod 4.3.6 — both modes produce a
// strict `type: "array"` for `z.preprocess(passthrough, z.array(X))`.
// Locked in below as a sanity check so a future Zod regression doesn't
// silently widen the schema sent to Anthropic.)

const InnerSchema = z.object({
  id: z.number().int(),
  label: z.string().max(40),
});

const StrictSchema = z.object({
  // Pattern from packages/scam-engine/src/inngest/reddit-intel-daily.ts
  perPost: z.preprocess(
    (v: unknown) => {
      if (typeof v !== "string") return v;
      try {
        return JSON.parse(v);
      } catch {
        return v;
      }
    },
    z.array(InnerSchema),
  ),
});

describe("z.toJSONSchema for preprocess'd arrays — anthropic.ts tool_use", () => {
  // Both io modes currently produce a strict array schema in Zod 4.3.6.
  // If a Zod upgrade ever widens io: 'input' back to permissive `{}`
  // (the historical concern), these tests fail loud and we add a
  // dedicated strict-mode schema for the wrapper.
  it("io: 'input' produces a strict array schema (current Zod 4.3.6 behaviour)", () => {
    const schema = z.toJSONSchema(StrictSchema, { io: "input" }) as Record<
      string,
      unknown
    >;
    const props = schema.properties as Record<string, Record<string, unknown>>;
    expect(props.perPost.type).toBe("array");
    expect(props.perPost.items).toBeDefined();
  });

  it("io: 'output' also produces a strict array schema", () => {
    const schema = z.toJSONSchema(StrictSchema, { io: "output" }) as Record<
      string,
      unknown
    >;
    const props = schema.properties as Record<string, Record<string, unknown>>;
    expect(props.perPost.type).toBe("array");
    expect(props.perPost.items).toBeDefined();
  });
});

describe("reddit-intel preprocess malformed-JSON tolerance", () => {
  // Belt-and-braces: even with io: 'output' the model could occasionally
  // stringify a value. The preprocess in reddit-intel-daily.ts now catches
  // JSON.parse errors and returns the string unchanged so Zod surfaces a
  // clean "expected array, received string" instead of a raw SyntaxError.
  const passthrough = (v: unknown) => {
    if (typeof v !== "string") return v;
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  };

  it("returns array unchanged when passed an array", () => {
    const arr = [{ id: 1, label: "a" }];
    expect(passthrough(arr)).toBe(arr);
  });

  it("parses valid JSON-encoded array strings", () => {
    const json = JSON.stringify([{ id: 1, label: "a" }]);
    expect(passthrough(json)).toEqual([{ id: 1, label: "a" }]);
  });

  it("returns the raw string (does NOT throw) on malformed JSON", () => {
    // Simulates the 2026-05-10 production failures where Sonnet emitted
    // a truncated JSON-encoded string and the old preprocess threw a raw
    // SyntaxError. Now we return the string and let Zod produce a
    // clean schema-mismatch error message.
    const malformed = '[{"id":1,"label":"abc';
    expect(() => passthrough(malformed)).not.toThrow();
    expect(passthrough(malformed)).toBe(malformed);
  });

  it("StrictSchema.safeParse surfaces a clean Zod issue (not a raw SyntaxError) on malformed input", () => {
    const malformed = '[{"id":1,"label":"abc';
    const sample = { perPost: malformed };
    // This is the production failure shape — Sonnet returns
    // `{ perPost: "<malformed JSON>" }`. Before the fix the preprocess
    // threw `SyntaxError: Expected ',' or '}' after property value`
    // straight from JSON.parse, crashing the Inngest step. After the
    // fix the preprocess returns the string and safeParse fails with
    // a typed Zod issue.
    expect(() => StrictSchema.safeParse(sample)).not.toThrow();
    const parse = StrictSchema.safeParse(sample);
    expect(parse.success).toBe(false);
    if (!parse.success) {
      const issue = parse.error.issues.find((i) => i.path[0] === "perPost");
      expect(issue).toBeDefined();
    }
  });
});
