import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The pre-classifier batch's FAILURE STAMP (#1300, v345) — the handler side;
 * the SQL is tested in preclassifyWorklistSql.test.ts.
 *
 *   (a) the alerts the classifier threw on (and only those — not successes,
 *       not alerts the budget never reached) go to ONE stamp call, inside
 *       `classify-batch` (no new step boundary, a replay does not re-stamp);
 *   (b) the Outcome Row carries `failure_stamped` / `failure_stamp_failed`;
 *   (c) a failed stamp never fails the batch;
 *   (d) a replayed pre-#1300 memo writes failure_stamped 0, re-runs nothing.
 *
 * Go-red record (2026-10-13, run then reverted):
 *   - removed the stampPreclassifyFailures call → (a)+(b) and (c) FAILED.
 *   - wrapped it in its own step.run("stamp-failures") → (a) FAILED.
 *   - stamped every result (dropped the `r.ok ? []` filter) → (a) FAILED.
 *   - dropped `failure_stamp_failed` from the Outcome Row → all three FAILED.
 */

const mocks = vi.hoisted(() => ({
  classifyAlert: vi.fn(),
  autoPark: vi.fn(),
  braked: vi.fn(),
  outcome: vi.fn(),
  stamp: vi.fn(),
}));

vi.mock("@askarthur/scam-engine/inngest/client", () => ({
  inngest: {
    createFunction: (_c: unknown, _t: unknown, handler: unknown) => handler,
  },
}));
vi.mock("@askarthur/scam-engine/inngest/with-axiom-logging", () => ({
  withAxiomLogging: (_c: unknown, handler: unknown) => handler,
}));
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => ({}),
}));
vi.mock("@askarthur/utils/feature-flags", () => ({
  featureFlags: new Proxy({} as Record<string, boolean>, { get: () => true }),
}));
vi.mock("@askarthur/scam-engine/lane-outcome", () => ({
  recordLaneOutcome: mocks.outcome,
}));
vi.mock("@/lib/clone-watch/jev-classify-one", () => ({
  isPreclassifyBraked: mocks.braked,
}));
vi.mock("@/lib/clone-watch/auto-park", () => ({
  autoParkNotClones: mocks.autoPark,
}));
vi.mock("@/lib/clone-watch/preclassify-failure-stamp", () => ({
  stampPreclassifyFailures: mocks.stamp,
}));
vi.mock("@/lib/clone-watch/preclassify-one", () => ({
  ClassificationOutputSchema: {},
  PROMPT_VERSION: "test",
  SYSTEM_PROMPT: "test",
  classifyAlert: mocks.classifyAlert,
  concurrencyFor: () => 4,
  preclassifyMode: () => "jev",
}));

import { cloneWatchHaikuPreclassify } from "@/app/api/inngest/functions/clone-watch-haiku-preclassify";

const ev = (alertId: number) => ({
  data: {
    alertId,
    brand: "nab.com.au",
    candidateDomain: `nab-${alertId}.com`,
    candidateUrl: `https://nab-${alertId}.com/`,
  },
});

const steps: string[] = [];
const run = (
  events: unknown[],
  stepRun: (name: string, fn: () => unknown) => unknown = (name, fn) => {
    steps.push(name);
    return fn();
  },
) =>
  (
    cloneWatchHaikuPreclassify as unknown as (
      ctx: unknown,
    ) => Promise<Record<string, unknown>>
  )({
    events,
    step: { run: stepRun },
  });

const outcomeMeta = () =>
  mocks.outcome.mock.calls.at(-1)?.[2] as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  steps.length = 0;
  mocks.braked.mockResolvedValue(false);
  // 1 and 3 not a clone, 2 a clone, 4 a vendor failure.
  mocks.classifyAlert.mockImplementation(
    async (_sb: unknown, a: { alertId: number }) => {
      if (a.alertId === 4) throw new Error("vendor 529");
      return {
        alertId: a.alertId,
        ok: true,
        is_clone: a.alertId === 2,
        confidence: a.alertId === 2 ? 0.9 : 0.1,
        clone_tactic: "unrelated",
        attack_intent: "unknown",
        jev: "primary",
      };
    },
  );
  mocks.autoPark.mockResolvedValue({ parked: 2, error: null });
  mocks.stamp.mockResolvedValue({ stamped: 1, error: null });
});

describe("pre-classifier failure stamp", () => {
  it("(a)+(b) stamps exactly the failed alerts, inside classify-batch, and counts them", async () => {
    const out = await run([ev(1), ev(2), ev(4)]);
    expect(steps).toEqual(["classify-batch", "log-outcome"]);
    expect(mocks.stamp).toHaveBeenCalledTimes(1);
    expect(mocks.stamp.mock.calls[0]![1]).toEqual([
      { alertId: 4, error: "vendor 529" },
    ]);
    expect(outcomeMeta()).toMatchObject({
      failed: 1,
      failure_stamped: 1,
      failure_stamp_failed: false,
    });
    expect(out).toMatchObject({ ok: true, classified: 2 });
  });

  it("(c) a failed stamp is counted and never fails the batch", async () => {
    mocks.stamp.mockResolvedValue({ stamped: 0, error: "rpc: 42883" });
    const out = await run([ev(1), ev(4)]);
    expect(out).toMatchObject({ ok: true, classified: 1 });
    expect(outcomeMeta()).toMatchObject({
      failure_stamped: 0,
      failure_stamp_failed: true,
    });
  });

  it("(d) a braked batch stamps nothing; a pre-#1300 memo replays as failure_stamped 0", async () => {
    mocks.braked.mockResolvedValue(true);
    await run([ev(4)]);
    expect(mocks.stamp).not.toHaveBeenCalled();

    mocks.braked.mockResolvedValue(false);
    const preFix = {
      braked: false,
      mode: "jev",
      results: [{ alertId: 4, ok: false, error: "vendor 529" }],
      autoParked: 0,
      autoParkError: null,
    };
    await run([ev(4)], (name, fn) =>
      name === "classify-batch" ? preFix : fn(),
    );
    expect(mocks.stamp).not.toHaveBeenCalled();
    expect(outcomeMeta()).toMatchObject({
      failed: 1,
      failure_stamped: 0,
      failure_stamp_failed: false,
    });
  });
});
