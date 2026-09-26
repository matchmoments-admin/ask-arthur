import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Not-a-clone audit (#1238) inside the urlscan submit lane.
//
// Go-red record (2026-09-26, each guard reverted → its test failed → restored):
//   - composeSubmitBatch: dropped the `batchLimit - audit.length` slice on the
//     regular list                        → "never grows the batch past SUBMIT_BATCH_LIMIT" FAILED
//   - composeSubmitBatch: samples placed FIRST → "samples go last" FAILED
//   - submit fn: stamped `auditIds` instead of attemptedAuditIds(...)
//                                       → "does not stamp a rate-limited sample" FAILED
//   - submit fn: let loadAuditSamples' error throw out of the load step
//                                       → "keeps submitting the regular batch when the audit RPCs are missing" FAILED

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), submit: vi.fn(), log: vi.fn(), flags: { cloneWatchNotACloneAuditWeekly: false },
}));
vi.mock("@askarthur/scam-engine/inngest/client", () => ({ inngest: {
  createFunction: (_c: unknown, _t: unknown, handler: unknown) => handler,
} }));
vi.mock("@askarthur/scam-engine/inngest/with-axiom-logging", () => ({
  withAxiomLogging: (_c: unknown, handler: unknown) => handler,
}));
vi.mock("@askarthur/supabase/server", () => ({ createServiceClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@askarthur/scam-engine/cost-log", () => ({ logCost: mocks.log }));
vi.mock("@askarthur/utils/feature-flags", () => ({ featureFlags: new Proxy({}, {
  get: (_t, key: string) => (key in mocks.flags ? mocks.flags[key as keyof typeof mocks.flags] : true),
}) }));
vi.mock("@/lib/clone-watch/urlscan-submit-one", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/clone-watch/urlscan-submit-one")>();
  return {
    ...actual,
    submitCandidateBatch: (...[c, b, o]: Parameters<typeof actual.submitCandidateBatch>) =>
      actual.submitCandidateBatch(c, b, { ...o, submitOne: mocks.submit }),
  };
});

import {
  AUDIT_SLOTS_PER_RUN,
  attemptedAuditIds,
  composeSubmitBatch,
} from "@/lib/clone-watch/not-a-clone-audit";
import { cloneWatchUrlscanSubmit } from "@/app/api/inngest/functions/clone-watch-urlscan-submit";

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
    expect(plan.candidates).toHaveLength(75);
    expect(plan.auditIds).toHaveLength(AUDIT_SLOTS_PER_RUN);
  });

  it("samples go last, regular candidates first", () => {
    const plan = composeSubmitBatch(range(1, 3), range(1000, 2), 75);
    expect(plan.candidates.map((c) => c.id)).toEqual([1, 2, 3, 1000, 1001]);
  });

  it("de-duplicates an alert that is on both lists", () => {
    const plan = composeSubmitBatch([cand(1), cand(2)], [cand(2)], 75);
    expect(plan.candidates.map((c) => c.id)).toEqual([1, 2]);
    expect(plan.auditIds).toEqual([2]);
  });

  it("attemptedAuditIds keeps only tried samples", () => {
    expect(attemptedAuditIds([1, 1000, 3], [1000, 1001])).toEqual([1000]);
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

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("URLSCAN_API_KEY", "test");
    mocks.flags.cloneWatchNotACloneAuditWeekly = false;
    mocks.submit.mockResolvedValue({ kind: "submitted", reputationMalicious: false });
  });

  function worklists(regular: ReturnType<typeof cand>[], samples: ReturnType<typeof cand>[]) {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "list_clone_alerts_pending_urlscan_submit") return { data: regular, error: null };
      if (name === "list_clone_not_a_clone_audit_pending") return { data: samples, error: null };
      if (name === "draw_clone_not_a_clone_audit_sample") return { data: 3, error: null };
      if (name === "mark_clone_not_a_clone_audit_attempted") return { data: 1, error: null };
      return { data: 0, error: null };
    });
  }

  it("asks the regular worklist only for the slots the samples leave", async () => {
    worklists(range(1, 5), range(1000, 10));
    await invoke();
    expect(rpcs("list_clone_alerts_pending_urlscan_submit")[0]).toMatchObject({ p_limit: SUBMIT_BATCH_LIMIT - 10 });
    expect(mocks.submit).toHaveBeenCalledTimes(15);
  });

  it("stamps the samples it tried and writes the audit fields on the Outcome Row", async () => {
    worklists(range(1, 2), range(1000, 2));
    await invoke();
    expect(rpcs("mark_clone_not_a_clone_audit_attempted")).toEqual([{ p_alert_ids: [1000, 1001] }]);
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({
      operation: "submit_batch",
      metadata: expect.objectContaining({ audit_drawn: 0, audit_offered: 2, audit_attempted: 2 }),
    }));
  });

  it("does not stamp a rate-limited sample (quota says nothing about the URL)", async () => {
    worklists([], range(1000, 2));
    mocks.submit
      .mockResolvedValueOnce({ kind: "rate_limited", reputationMalicious: false })
      .mockResolvedValueOnce({ kind: "dns_no_host", reputationMalicious: false });
    await invoke();
    expect(rpcs("mark_clone_not_a_clone_audit_attempted")).toEqual([{ p_alert_ids: [1001] }]);
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
    expect(mocks.log).toHaveBeenLastCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ audit_drawn: 3 }),
    }));
  });

  it("keeps submitting the regular batch when the audit RPCs are missing (v330 not applied)", async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "list_clone_alerts_pending_urlscan_submit") return { data: range(1, 3), error: null };
      if (name.includes("not_a_clone")) return { data: null, error: { message: "function does not exist" } };
      return { data: 0, error: null };
    });
    await invoke();
    expect(mocks.submit).toHaveBeenCalledTimes(3);
    expect(rpcs("list_clone_alerts_pending_urlscan_submit")[0]).toMatchObject({ p_limit: SUBMIT_BATCH_LIMIT });
    expect(rpcs("mark_clone_not_a_clone_audit_attempted")).toEqual([]);
  });
});
