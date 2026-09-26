import { describe, expect, it } from "vitest";

import {
  AUTO_PARK_NOTE,
  autoParkNotClones,
  hasStrongBrandSignal,
  isAutoParkEligible,
} from "@/lib/clone-watch/auto-park";
import { primarySignalType } from "@/lib/clone-watch/weaponisation-risk";

/**
 * Auto-park (#1230) — moved out of the retired clone-watch-auto-triage into
 * lib/clone-watch/auto-park.ts, called by the pre-classifier batch and the
 * one-off backfill script. The eligibility cases are the auto-triage suite's,
 * carried over verbatim so "the conservative cut is unchanged" is a test, not
 * a claim.
 *
 * Go-red record (2026-09-26, run then reverted):
 *   - drop `.eq("triage_status", "pending")` from the UPDATE → "re-checks
 *     pending in the UPDATE itself" fails (a row a human actioned between the
 *     read and the write would be overwritten).
 *   - drop `.eq("source", "nrd")` from the read → "reads only pending nrd
 *     rows" fails.
 *   - rethrow from the outer catch → "never throws" fails. (Making only the
 *     read error `throw` stays green: the outer catch turns it back into a
 *     returned error — equivalent, so not a gap.)
 *   - return `parkIds.length` instead of the UPDATE's returned rows →
 *     "counts rows the UPDATE actually moved" fails (a lost race would be
 *     over-reported).
 *   - STRONG_SIGNALS = {confusable} → both levenshtein cases fail.
 */

describe("primarySignalType (the signal the cut reads)", () => {
  it("reads the FIRST signal's type", () => {
    expect(primarySignalType([{ signal_type: "confusable", score: 0.9 }])).toBe("confusable");
  });
  it("returns null for empty / malformed signals", () => {
    expect(primarySignalType([])).toBeNull();
    expect(primarySignalType(null)).toBeNull();
    expect(primarySignalType("nope")).toBeNull();
    expect(primarySignalType([{ score: 1 }])).toBeNull();
  });
});

describe("hasStrongBrandSignal", () => {
  it("accepts confusable and levenshtein primary signals", () => {
    expect(hasStrongBrandSignal([{ signal_type: "confusable" }])).toBe(true);
    expect(hasStrongBrandSignal([{ signal_type: "levenshtein" }])).toBe(true);
  });
  it("rejects the high-FP substring class and unknowns", () => {
    expect(hasStrongBrandSignal([{ signal_type: "substring" }])).toBe(false);
    expect(hasStrongBrandSignal([{ signal_type: "au_token" }])).toBe(false);
    expect(hasStrongBrandSignal([])).toBe(false);
  });
  it("only considers the PRIMARY (first) signal", () => {
    expect(
      hasStrongBrandSignal([{ signal_type: "substring" }, { signal_type: "confusable" }]),
    ).toBe(false);
  });
});

describe("isAutoParkEligible (the conservative cut)", () => {
  it("parks not-a-clone rows with a weak (non-confusable/levenshtein) signal", () => {
    expect(isAutoParkEligible(true, [{ signal_type: "substring" }])).toBe(true);
    expect(isAutoParkEligible(true, [{ signal_type: "au_token" }])).toBe(true);
    expect(isAutoParkEligible(true, [])).toBe(true);
  });
  it("KEEPS not-a-clone rows that carry a strong brand-similarity signal", () => {
    expect(isAutoParkEligible(true, [{ signal_type: "confusable" }])).toBe(false);
    expect(isAutoParkEligible(true, [{ signal_type: "levenshtein" }])).toBe(false);
  });
  it("never parks a row the pre-classifier considers a clone, regardless of signal", () => {
    expect(isAutoParkEligible(false, [{ signal_type: "substring" }])).toBe(false);
    expect(isAutoParkEligible(false, [{ signal_type: "confusable" }])).toBe(false);
  });
});

// ── autoParkNotClones against a recording fake ─────────────────────────────

type Call = { method: string; args: unknown[] };
interface FakeOpts {
  readRows?: Array<{ id: number; signals: unknown }>;
  readError?: { message: string } | null;
  updatedIds?: number[];
  updateError?: { message: string } | null;
  throwOnFrom?: boolean;
}

function fakeSb(opts: FakeOpts) {
  const queries: Call[][] = [];
  const sb = {
    from: (table: string) => {
      if (opts.throwOnFrom) throw new Error("boom");
      const calls: Call[] = [{ method: "from", args: [table] }];
      queries.push(calls);
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "in", "eq", "update"]) {
        builder[m] = (...args: unknown[]) => {
          calls.push({ method: m, args });
          return builder;
        };
      }
      builder.then = (resolve: (r: unknown) => unknown) => {
        const isUpdate = calls.some((c) => c.method === "update");
        const result = isUpdate
          ? opts.updateError
            ? { data: null, error: opts.updateError }
            : { data: (opts.updatedIds ?? []).map((id) => ({ id })), error: null }
          : opts.readError
            ? { data: null, error: opts.readError }
            : { data: opts.readRows ?? [], error: null };
        return Promise.resolve(result).then(resolve);
      };
      return builder;
    },
  };
  return { sb: sb as never, queries };
}

const has = (q: Call[], method: string, ...args: unknown[]) =>
  q.some((c) => c.method === method && JSON.stringify(c.args) === JSON.stringify(args));

describe("autoParkNotClones", () => {
  it("does nothing (no query) for an empty id list", async () => {
    const { sb, queries } = fakeSb({});
    expect(await autoParkNotClones(sb, [])).toEqual({ parked: 0, error: null });
    expect(queries).toHaveLength(0);
  });

  it("reads only pending nrd rows, then parks the weak ones in ONE update", async () => {
    const { sb, queries } = fakeSb({
      readRows: [
        { id: 1, signals: [{ signal_type: "substring" }] },
        { id: 2, signals: [{ signal_type: "levenshtein" }] }, // kept for a human
        { id: 3, signals: [] },
      ],
      updatedIds: [1, 3],
    });
    const out = await autoParkNotClones(sb, [1, 2, 3], "2026-09-26T08:31:00.000Z");
    expect(out).toEqual({ parked: 2, error: null });
    expect(queries).toHaveLength(2);
    const [read, update] = queries;
    expect(has(read, "in", "id", [1, 2, 3])).toBe(true);
    expect(has(read, "eq", "source", "nrd")).toBe(true);
    expect(has(read, "eq", "triage_status", "pending")).toBe(true);
    expect(has(update, "update", {
      triage_status: "needs_investigation",
      triage_at: "2026-09-26T08:31:00.000Z",
      triage_notes: AUTO_PARK_NOTE,
      // v335 (#1237): origin recorded apart from the note. Go-red 2026-09-27:
      // dropped triage_source from the auto-park UPDATE → this test FAILED.
      triage_source: "machine",
    })).toBe(true);
    expect(has(update, "in", "id", [1, 3])).toBe(true);
  });

  it("re-checks pending in the UPDATE itself (a human may have actioned it since the read)", async () => {
    const { sb, queries } = fakeSb({
      readRows: [{ id: 7, signals: [{ signal_type: "substring" }] }],
      updatedIds: [7],
    });
    await autoParkNotClones(sb, [7]);
    expect(has(queries[1], "eq", "triage_status", "pending")).toBe(true);
  });

  it("counts rows the UPDATE actually moved, not rows it attempted", async () => {
    const { sb } = fakeSb({
      readRows: [
        { id: 1, signals: [{ signal_type: "substring" }] },
        { id: 2, signals: [{ signal_type: "substring" }] },
      ],
      updatedIds: [2], // id 1 was triaged between the read and the write
    });
    expect(await autoParkNotClones(sb, [1, 2])).toEqual({ parked: 1, error: null });
  });

  it("skips the UPDATE when nothing is eligible", async () => {
    const { sb, queries } = fakeSb({
      readRows: [{ id: 2, signals: [{ signal_type: "confusable" }] }],
    });
    expect(await autoParkNotClones(sb, [2])).toEqual({ parked: 0, error: null });
    expect(queries).toHaveLength(1);
  });

  it("never throws: read error, update error and a thrown client all return error", async () => {
    expect(
      await autoParkNotClones(fakeSb({ readError: { message: "timeout" } }).sb, [1]),
    ).toEqual({ parked: 0, error: "read: timeout" });
    expect(
      await autoParkNotClones(
        fakeSb({
          readRows: [{ id: 1, signals: [] }],
          updateError: { message: "deadlock" },
        }).sb,
        [1],
      ),
    ).toEqual({ parked: 0, error: "update: deadlock" });
    expect(await autoParkNotClones(fakeSb({ throwOnFrom: true }).sb, [1])).toEqual({
      parked: 0,
      error: "boom",
    });
  });

  it("keeps the `auto-park:` prefix prod queries count on, and names no classifier vendor", () => {
    expect(AUTO_PARK_NOTE.startsWith("auto-park:")).toBe(true);
    expect(AUTO_PARK_NOTE).not.toMatch(/haiku/i);
  });
});
