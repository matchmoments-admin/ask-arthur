import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Not-a-clone audit (#1238) inside the urlscan submit lane.
//
// Go-red record (2026-09-26, each guard reverted → its test failed → restored):
//   - composeSubmitBatch: dropped the `batchLimit - audit.length` slice on the
//     regular list                        → "never grows the batch past SUBMIT_BATCH_LIMIT" FAILED
//   - composeSubmitBatch: trimmed the regular HEAD instead of the tail
//                                       → "trims the freshest tail of the regular list" FAILED
//   - submit fn: p_limit back to `SUBMIT_BATCH_LIMIT - samples`
//                                       → "asks the regular worklist for the full batch" FAILED
//   - submit fn: stamped every offered sample instead of auditTally.attemptedIds
//                                       → "does not stamp a rate-limited sample" FAILED
//   - submit fn: ran samples in the SAME tally as the regular rows
//                                       → "records an attempt … keeps them out of units" FAILED
//   - submit fn: counted samples in `units` (candidates + audit)
//                                       → "a DNS-dead audit-only day is not silent_zero" FAILED
//   - submit fn: dropped the surface-audit-misses step (no Axiom warn)
//                                       → "ships one always-ship Axiom warn per miss …" FAILED
//   - submit fn: ran the Axiom warn loop OUTSIDE step.run
//                                       → "a replayed run does not re-ship the miss warns" FAILED
//   - submit fn: stamped miss_warned_at in the load step (before anything durable)
//                                       → "a failed Axiom flush leaves the misses unstamped" FAILED
//   - submit fn: dropped audit_miss_ids from the Outcome Row
//                                       → "ships one always-ship Axiom warn per miss …" FAILED
//   - submit fn: let loadAuditSamples' error throw out of the load step
//                                       → "keeps submitting the regular batch when the audit RPCs are missing" FAILED

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), submit: vi.fn(), log: vi.fn(), warn: vi.fn(),
  axiomWarn: vi.fn(), axiomFlush: vi.fn(),
  flags: { cloneWatchNotACloneAuditWeekly: false } as Record<string, boolean>,
}));
vi.mock("@askarthur/scam-engine/inngest/client", () => ({ inngest: {
  createFunction: (_c: unknown, _t: unknown, handler: unknown) => handler,
} }));
vi.mock("@askarthur/scam-engine/inngest/with-axiom-logging", () => ({
  withAxiomLogging: (_c: unknown, handler: unknown) => handler,
}));
vi.mock("@askarthur/supabase/server", () => ({ createServiceClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@askarthur/scam-engine/cost-log", () => ({ logCost: mocks.log }));
vi.mock("@askarthur/utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: mocks.warn, debug: vi.fn() },
}));
vi.mock("@askarthur/utils/axiom-logger", () => ({
  getLogger: () => ({
    debug: vi.fn(), info: vi.fn(), error: vi.fn(),
    warn: mocks.axiomWarn, flush: mocks.axiomFlush,
  }),
}));
vi.mock("@askarthur/utils/feature-flags", () => ({ featureFlags: new Proxy({}, {
  get: (_t, key: string) => (key in mocks.flags ? mocks.flags[key] : true),
}) }));
vi.mock("@/lib/clone-watch/urlscan-submit-one", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/clone-watch/urlscan-submit-one")>();
  return {
    ...actual,
    submitCandidateBatch: (...[c, b, o]: Parameters<typeof actual.submitCandidateBatch>) =>
      actual.submitCandidateBatch(c, b, { ...o, submitOne: mocks.submit }),
  };
});

import { AUDIT_SLOTS_PER_RUN, composeSubmitBatch } from "@/lib/clone-watch/not-a-clone-audit";
import { cloneWatchUrlscanSubmit } from "@/app/api/inngest/functions/clone-watch-urlscan-submit";
import { LANE_SHAPES } from "@/lib/laneHealth";

const cand = (id: number) => ({ id, candidate_url: `https://c${id}.example`, candidate_domain: `c${id}.example` });
const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => cand(from + i));

const SRC = readFileSync(
  new URL("../app/api/inngest/functions/clone-watch-urlscan-submit.ts", import.meta.url),
  "utf8",
);
const SUBMIT_BATCH_LIMIT = Number(/const SUBMIT_BATCH_LIMIT = (\d+)/.exec(SRC)![1]);

describe("composeSubmitBatch", () => {
  it("never grows the batch past SUBMIT_BATCH_LIMIT", () => {
    const plan = composeSubmitBatch(range(1, 75), range(1000, 40), 75);
    expect(plan.regular.length + plan.audit.length).toBe(75);
    expect(plan.audit).toHaveLength(AUDIT_SLOTS_PER_RUN);
    expect(plan.regularLeft).toBe(AUDIT_SLOTS_PER_RUN);
  });

  it("trims the freshest tail of the regular list (v285 puts the oldest reserve first)", () => {
    const plan = composeSubmitBatch(range(1, 75), range(1000, 25), 75);
    expect(plan.regular[0]!.id).toBe(1);
    expect(plan.regular.at(-1)!.id).toBe(50);
  });

  it("does not trim regular rows when samples fit in empty slots", () => {
    const plan = composeSubmitBatch(range(1, 33), range(1000, 25), 75);
    expect(plan.regular).toHaveLength(33);
    expect(plan.audit).toHaveLength(25);
    expect(plan.regularLeft).toBe(0);
  });

  it("de-duplicates an alert that is on both lists (it runs as regular)", () => {
    const plan = composeSubmitBatch([cand(1), cand(2)], [cand(2), cand(3)], 75);
    expect(plan.regular.map((c) => c.id)).toEqual([1, 2]);
    expect(plan.audit.map((c) => c.id)).toEqual([3]);
  });
});

describe("quota fit (urlscan unlisted: 60/min, 100/hour, 1,000/day)", () => {
  it("the audit reserve is a share of the batch, and the batch fits one hour's quota", () => {
    expect(AUDIT_SLOTS_PER_RUN).toBeLessThan(SUBMIT_BATCH_LIMIT);
    // The submit run is the only urlscan submitter in its hour (recheck fires
    // at :30 of 00/06/12/18 UTC). Samples ride inside the batch, never on top.
    expect(SUBMIT_BATCH_LIMIT).toBeLessThanOrEqual(100);
  });
});

describe("submit lane with audit samples", () => {
  const invoke = () =>
    (cloneWatchUrlscanSubmit as unknown as (ctx: unknown) => Promise<unknown>)({
      event: { ts: Date.now(), data: {} },
      step: { run: (_n: string, fn: () => unknown) => fn() },
    });
  const rpcs = (name: string) => mocks.rpc.mock.calls.filter(([n]) => n === name).map(([, a]) => a);
  const outcome = () => {
    const call = mocks.log.mock.calls.at(-1)![0] as { units: number; metadata: Record<string, unknown> };
    return { units: call.units, ...call.metadata };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("URLSCAN_API_KEY", "test");
    mocks.flags.cloneWatchNotACloneAuditWeekly = false;
    mocks.submit.mockResolvedValue({ kind: "submitted", reputationMalicious: false });
    mocks.axiomFlush.mockResolvedValue(undefined);
  });

  function worklists(
    regular: ReturnType<typeof cand>[],
    samples: ReturnType<typeof cand>[],
    misses: unknown[] = [],
  ) {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "list_clone_alerts_pending_urlscan_submit") return { data: regular, error: null };
      if (name === "list_clone_not_a_clone_audit_pending") return { data: samples, error: null };
      if (name === "list_clone_not_a_clone_audit_unwarned_misses") return { data: misses, error: null };
      if (name === "mark_clone_not_a_clone_audit_misses_warned") return { data: misses.length, error: null };
      if (name === "draw_clone_not_a_clone_audit_sample") return { data: 3, error: null };
      if (name === "mark_clone_not_a_clone_audit_attempted") return { data: 1, error: null };
      return { data: 0, error: null };
    });
  }

  it("asks the regular worklist for the full batch and runs samples after it", async () => {
    worklists(range(1, 5), range(1000, 10));
    await invoke();
    expect(rpcs("list_clone_alerts_pending_urlscan_submit")[0]).toMatchObject({ p_limit: SUBMIT_BATCH_LIMIT });
    expect(mocks.submit.mock.calls.map(([c]) => c.id)).toEqual([...range(1, 5), ...range(1000, 10)].map((c) => c.id));
  });

  it("records an attempt for the samples it tried and keeps them out of units", async () => {
    worklists(range(1, 2), range(1000, 2));
    await invoke();
    expect(rpcs("mark_clone_not_a_clone_audit_attempted")).toEqual([{ p_alert_ids: [1000, 1001] }]);
    expect(outcome()).toMatchObject({
      units: 2, submitted: 2, audit_offered: 2, audit_attempted: 2, audit_submitted: 2, audit_drawn: 0,
    });
  });

  it("does not stamp a rate-limited sample (quota says nothing about the URL)", async () => {
    worklists([], range(1000, 2));
    mocks.submit
      .mockResolvedValueOnce({ kind: "rate_limited", reputationMalicious: false })
      .mockResolvedValueOnce({ kind: "dns_no_host", reputationMalicious: false });
    await invoke();
    expect(rpcs("mark_clone_not_a_clone_audit_attempted")).toEqual([{ p_alert_ids: [1001] }]);
    expect(outcome()).toMatchObject({ audit_rate_limited: 1, audit_dns_skipped: 1 });
  });

  it("a DNS-dead audit-only day is not silent_zero", async () => {
    worklists([], range(1000, 25));
    mocks.submit.mockResolvedValue({ kind: "dns_no_host", reputationMalicious: false });
    await invoke();
    const o = outcome();
    expect(o).toMatchObject({ units: 0, submitted: 0, audit_offered: 25 });
    const shape = LANE_SHAPES["shopfront-clone-urlscan-submit"];
    expect(shape.silentZero(o as never)).toBe(false);
  });

  it("a genuinely broken regular batch still reads silent_zero with samples present", async () => {
    worklists(range(1, 3), range(1000, 2));
    mocks.submit.mockResolvedValue({ kind: "submit_failed", reputationMalicious: false });
    await invoke();
    const shape = LANE_SHAPES["shopfront-clone-urlscan-submit"];
    expect(shape.silentZero(outcome() as never)).toBe(true);
  });

  const MISSES = [
    { alert_id: 7, candidate_domain: "x.example", candidate_url: "https://x.example", cohort_key: "baseline:b", model_id: "jev-1.13.0", confidence: 0.2, miss_at: "2026-09-26T00:00:00Z" },
    { alert_id: 8, candidate_domain: "y.example", candidate_url: "https://y.example", cohort_key: "baseline:b", model_id: "jev-1.13.0", confidence: 0.3, miss_at: "2026-09-26T00:00:00Z" },
  ];

  it("ships one always-ship Axiom warn per miss, records the ids, then stamps them", async () => {
    worklists(range(1, 1), [], MISSES);
    await invoke();
    expect(mocks.axiomWarn.mock.calls.map(([, ctx]) => (ctx as { alertId: number }).alertId)).toEqual([7, 8]);
    expect(mocks.axiomFlush).toHaveBeenCalled();
    expect(outcome()).toMatchObject({ audit_misses: 2, audit_miss_ids: [7, 8] });
    expect(rpcs("mark_clone_not_a_clone_audit_misses_warned")).toEqual([{ p_alert_ids: [7, 8] }]);
    // Order: the Outcome Row is written before the stamp.
    const logAt = mocks.log.mock.invocationCallOrder.at(-1)!;
    const markIdx = mocks.rpc.mock.calls.findIndex(([n]) => n === "mark_clone_not_a_clone_audit_misses_warned");
    expect(mocks.rpc.mock.invocationCallOrder[markIdx]!).toBeGreaterThan(logAt);
  });

  it("records and stamps misses on a quiet day too", async () => {
    worklists([], [], MISSES);
    await invoke();
    expect(outcome()).toMatchObject({ reason: "no_gated_candidates", audit_miss_ids: [7, 8] });
    expect(rpcs("mark_clone_not_a_clone_audit_misses_warned")).toEqual([{ p_alert_ids: [7, 8] }]);
  });

  it("a replayed run does not re-ship the miss warns (they live inside a step)", async () => {
    worklists(range(1, 1), [], MISSES);
    // A replay: Inngest returns the memoised output of completed steps without
    // running them again.
    await (cloneWatchUrlscanSubmit as unknown as (ctx: unknown) => Promise<unknown>)({
      event: { ts: Date.now(), data: {} },
      runId: "run-1",
      step: {
        run: (name: string, fn: () => unknown) => (name === "surface-audit-misses" ? 2 : fn()),
      },
    });
    expect(mocks.axiomWarn).not.toHaveBeenCalled();
  });

  it("a failed Axiom flush leaves the misses unstamped (the step throws and retries)", async () => {
    worklists(range(1, 1), [], MISSES);
    mocks.axiomFlush.mockRejectedValue(new Error("axiom down"));
    await expect(invoke()).rejects.toThrow("axiom down");
    expect(rpcs("mark_clone_not_a_clone_audit_misses_warned")).toEqual([]);
  });

  it("cap_reached is set when samples displaced regular rows", async () => {
    worklists(range(1, 75), range(1000, 25));
    await invoke();
    expect(outcome()).toMatchObject({ units: 50, cap_reached: true, audit_offered: 25 });
  });

  it("draws the weekly sample only when the flag is on", async () => {
    worklists(range(1, 1), []);
    await invoke();
    expect(rpcs("draw_clone_not_a_clone_audit_sample")).toEqual([]);
    mocks.flags.cloneWatchNotACloneAuditWeekly = true;
    await invoke();
    expect(rpcs("draw_clone_not_a_clone_audit_sample")).toEqual([
      { p_cohort: "weekly", p_fraction: 0.05, p_horizon_days: 90 },
    ]);
    expect(outcome()).toMatchObject({ audit_drawn: 3 });
  });

  it("keeps submitting the regular batch when the audit RPCs are missing (v330 not applied)", async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "list_clone_alerts_pending_urlscan_submit") return { data: range(1, 3), error: null };
      if (name.includes("not_a_clone")) return { data: null, error: { message: "function does not exist" } };
      return { data: 0, error: null };
    });
    await invoke();
    expect(mocks.submit).toHaveBeenCalledTimes(3);
    expect(rpcs("mark_clone_not_a_clone_audit_attempted")).toEqual([]);
  });
});
