import { describe, expect, it, vi } from "vitest";

import {
  PRECLASSIFY_FANOUT_CAP,
  fanOutPreclassify,
  type FanOutDb,
} from "../preclassify-fanout";

// #1300 — the fan-out's Outcome Row fields.
//
// Go-red record (2026-10-13; each reverted → the named test failed → restored):
//   - ignore the selector's `error` (the pre-#1300 `const { data } = …`)
//        → "a selector error is errored, not 'nothing to classify'" FAILED
//   - cap_reached = rows.length >= cap (a full batch is not demand over cap)
//        → "cap_reached is demand over the cap …" FAILED
//   - let send() throw out of the module
//        → "a send failure is recorded, never thrown" FAILED
//   - p_limit: 50 (the old ask)
//        → "asks the selector for the cap …" FAILED

const row = (id: number) => ({
  id,
  inferred_target_domain: "nab.com.au",
  candidate_domain: `nab-${id}.com`,
  candidate_url: `https://nab-${id}.com/`,
});
const coverage = (due: number) => ({
  data: [
    { due_total: due, gave_up_total: 1, gave_up_24h: 0, aged_out_total: 0 },
  ],
  error: null,
});

function db(opts: {
  list?: { data: unknown; error: { message: string } | null };
  cov?: { data: unknown; error: { message: string } | null };
}): FanOutDb & { calls: Array<[string, unknown]> } {
  const calls: Array<[string, unknown]> = [];
  return {
    calls,
    rpc: (fn: string, args?: Record<string, unknown>) => {
      calls.push([fn, args]);
      if (fn === "clone_watch_preclassify_coverage")
        return Promise.resolve(opts.cov ?? coverage(0));
      return Promise.resolve(opts.list ?? { data: [], error: null });
    },
  };
}

describe("fanOutPreclassify", () => {
  it("asks the selector for the cap and sends one date-stamped event per alert", async () => {
    const sb = db({
      list: { data: [row(1), row(2)], error: null },
      cov: coverage(2),
    });
    const send = vi.fn().mockResolvedValue(undefined);
    const out = await fanOutPreclassify(sb, send, "2026-10-13");
    expect(sb.calls).toContainEqual([
      "list_clone_alerts_pending_preclassify",
      { p_limit: PRECLASSIFY_FANOUT_CAP },
    ]);
    expect(send.mock.calls[0]![0].map((e: { id: string }) => e.id)).toEqual([
      "clone-watch-preclassify:1:2026-10-13",
      "clone-watch-preclassify:2:2026-10-13",
    ]);
    expect(out).toMatchObject({
      preclassify_fanned_out: 2,
      preclassify_errored: false,
      preclassify_cap: 100,
      preclassify_cap_reached: false,
      preclassify_due_total: 2,
      preclassify_gave_up: 1,
      preclassify_gave_up_24h: 0,
      preclassify_aged_out: 0,
    });
  });

  it("a selector error is errored, not 'nothing to classify'", async () => {
    const send = vi.fn();
    const out = await fanOutPreclassify(
      db({ list: { data: null, error: { message: "57014 timeout" } } }),
      send,
      "d",
    );
    expect(out.preclassify_errored).toBe(true);
    expect(out.preclassify_error).toContain("list: 57014");
    expect(send).not.toHaveBeenCalled();
  });

  it("cap_reached is demand over the cap, not a full batch", async () => {
    const full = { data: [row(1), row(2)], error: null };
    const send = vi.fn().mockResolvedValue(undefined);
    expect(
      (
        await fanOutPreclassify(
          db({ list: full, cov: coverage(2) }),
          send,
          "d",
          2,
        )
      ).preclassify_cap_reached,
    ).toBe(false);
    expect(
      (
        await fanOutPreclassify(
          db({ list: full, cov: coverage(3) }),
          send,
          "d",
          2,
        )
      ).preclassify_cap_reached,
    ).toBe(true);
  });

  it("a coverage failure is errored but the fan-out still runs (and falls back to a full batch for cap_reached)", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const out = await fanOutPreclassify(
      db({
        list: { data: [row(1), row(2)], error: null },
        cov: { data: null, error: { message: "boom" } },
      }),
      send,
      "d",
      2,
    );
    expect(out).toMatchObject({
      preclassify_fanned_out: 2,
      preclassify_errored: true,
      preclassify_due_total: null,
      preclassify_cap_reached: true,
    });
  });

  it("a send failure is recorded, never thrown", async () => {
    const send = vi.fn().mockRejectedValue(new Error("inngest 502"));
    const out = await fanOutPreclassify(
      db({ list: { data: [row(1)], error: null }, cov: coverage(1) }),
      send,
      "d",
    );
    expect(out).toMatchObject({
      preclassify_fanned_out: 0,
      preclassify_errored: true,
    });
    expect(out.preclassify_error).toContain("send: inngest 502");
  });
});
