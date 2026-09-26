import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The pre-classifier batch's auto-park contract (#1230) — the HANDLER side;
 * the park itself is unit-tested in cloneWatchAutoPark.test.ts.
 *
 *   (a) after the batch's classifications, the is_clone=false alerts (and
 *       only those) go to ONE autoParkNotClones call, inside `classify-batch`
 *       — no new step boundary;
 *   (b) the Outcome Row carries `auto_parked` / `auto_park_failed`;
 *   (c) a failed park never fails the batch;
 *   (d) a braked batch parks nothing; a replay of a pre-#1230 memo writes
 *       auto_parked 0 without re-running anything.
 *
 * Go-red record (2026-09-26, run then reverted):
 *   - wrap the autoParkNotClones call in its own step.run("auto-park") →
 *     (a) fails (a third boundary).
 *   - filter `r.ok && r.is_clone` (inverted) together with dropping
 *     `auto_park_failed` from the Outcome Row → (a), (c) and the replay case
 *     fail.
 *   - `throw` when park.error is set → (c) fails.
 */

const mocks = vi.hoisted(() => ({
  classifyAlert: vi.fn(),
  autoPark: vi.fn(),
  braked: vi.fn(),
  outcome: vi.fn(),
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
  (cloneWatchHaikuPreclassify as unknown as (ctx: unknown) => Promise<Record<string, unknown>>)({
    events,
    step: { run: stepRun },
  });

const outcomeMeta = () => mocks.outcome.mock.calls.at(-1)?.[2] as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  steps.length = 0;
  mocks.braked.mockResolvedValue(false);
  // 1 and 3 not a clone, 2 a clone, 4 a vendor failure.
  mocks.classifyAlert.mockImplementation(async (_sb: unknown, a: { alertId: number }) => {
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
  });
  mocks.autoPark.mockResolvedValue({ parked: 2, error: null });
});

describe("pre-classifier auto-park", () => {
  it("(a)+(b) parks exactly the batch's is_clone=false alerts, inside classify-batch, and counts them", async () => {
    const out = await run([ev(1), ev(2), ev(3), ev(4)]);

    expect(steps).toEqual(["classify-batch", "log-outcome"]);
    expect(mocks.autoPark).toHaveBeenCalledTimes(1);
    const ids = (mocks.autoPark.mock.calls[0][1] as number[]).slice().sort();
    expect(ids).toEqual([1, 3]);
    // After every classification (none is started after the park).
    expect(mocks.autoPark.mock.invocationCallOrder[0]).toBeGreaterThan(
      Math.max(...mocks.classifyAlert.mock.invocationCallOrder),
    );
    expect(outcomeMeta()).toMatchObject({
      alerts: 4,
      classified: 3,
      failed: 1,
      auto_parked: 2,
      auto_park_failed: false,
    });
    expect(out).toMatchObject({ ok: true, autoParked: 2 });
  });

  it("(c) a failed park is logged and counted, never fails the batch", async () => {
    mocks.autoPark.mockResolvedValue({ parked: 0, error: "update: deadlock" });
    const out = await run([ev(1), ev(2)]);
    expect(out).toMatchObject({ ok: true, classified: 2, autoParked: 0 });
    expect(outcomeMeta()).toMatchObject({ auto_parked: 0, auto_park_failed: true });
  });

  it("(d) a braked batch classifies and parks nothing", async () => {
    mocks.braked.mockResolvedValue(true);
    const out = await run([ev(1)]);
    expect(out).toMatchObject({ skipped: true, reason: "cost_brake_engaged" });
    expect(mocks.autoPark).not.toHaveBeenCalled();
  });

  it("(d) replaying a classify-batch memo from before #1230 writes auto_parked 0 and re-runs nothing", async () => {
    const preFix = {
      braked: false,
      mode: "jev",
      results: [{ alertId: 1, ok: true, is_clone: false, confidence: 0.1, clone_tactic: "unrelated", attack_intent: "unknown", jev: "primary" }],
    };
    const out = await run([ev(1)], (name, fn) => (name === "classify-batch" ? preFix : fn()));
    expect(out).toMatchObject({ ok: true, classified: 1, autoParked: 0 });
    expect(mocks.autoPark).not.toHaveBeenCalled();
    expect(mocks.classifyAlert).not.toHaveBeenCalled();
    expect(outcomeMeta()).toMatchObject({ auto_parked: 0, auto_park_failed: false });
  });
});
