import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Jev shadow lane (v311) inside clone-watch-haiku-preclassify — the
// HANDLER's contract only (the body is unit-tested in jevShadowOne.test.ts):
// (a) flag OFF → the vendor is never reached, Haiku's persist untouched, no
// extra step; (b) flag ON → the Jev call rides at the tail of `persist`
// (no fourth boundary) AFTER Haiku's row + cost row, stamped source='live';
// (c) a Jev failure never fails the Haiku result.

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  log: vi.fn(),
  callClaude: vi.fn(),
  askJev: vi.fn(),
  flags: { shopfrontClonePreclassify: true, cloneWatchJevShadow: true },
}));

vi.mock("@askarthur/scam-engine/inngest/client", () => ({
  inngest: {
    createFunction: (_config: unknown, _trigger: unknown, handler: unknown) =>
      handler,
  },
}));
vi.mock("@askarthur/scam-engine/inngest/with-axiom-logging", () => ({
  withAxiomLogging: (_config: unknown, handler: unknown) => handler,
}));
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
}));
vi.mock("@askarthur/utils/feature-flags", () => ({
  featureFlags: mocks.flags,
}));
vi.mock("@askarthur/scam-engine/anthropic", () => ({
  callClaudeJson: mocks.callClaude,
}));
vi.mock("@askarthur/scam-engine/providers/jev", () => ({
  askJev: mocks.askJev,
}));
vi.mock("@/lib/cost-telemetry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cost-telemetry")>()),
  logCost: mocks.log,
  logCostAsync: mocks.log,
}));

import { cloneWatchHaikuPreclassify } from "@/app/api/inngest/functions/clone-watch-haiku-preclassify";
import { RISK_INDICATOR_VALUES } from "@/lib/clone-watch/preclassify-vocabulary";

const EVENT = {
  ts: Date.now(),
  data: {
    alertId: 42,
    brand: "nab.com.au",
    candidateDomain: "nab-secure-login.com",
    candidateUrl: "https://nab-secure-login.com/",
  },
};

const steps: string[] = [];
const invoke = () =>
  (cloneWatchHaikuPreclassify as unknown as (ctx: unknown) => Promise<unknown>)(
    {
      event: EVENT,
      step: {
        run: (name: string, fn: () => unknown) => {
          steps.push(name);
          return fn();
        },
      },
    },
  );

function query(result: unknown) {
  const chain: Record<string, unknown> = {
    then: (resolve: (r: unknown) => unknown) =>
      Promise.resolve(result).then(resolve),
  };
  for (const m of ["select", "eq", "maybeSingle"]) chain[m] = () => chain;
  return chain;
}

function goodJevAnswers() {
  const answers: Record<string, unknown> = {
    is_clone: { type: "noul", noul: 0.93 },
    clone_tactic: {
      type: "choice",
      choice: "brandjack",
      probabilities: { brandjack: 0.8, typosquat: 0.2 },
      confidence: 0.7,
    },
    attack_intent: {
      type: "choice",
      choice: "credential_phishing",
      probabilities: { credential_phishing: 0.9, unknown: 0.1 },
      confidence: 0.85,
    },
  };
  for (const ri of RISK_INDICATOR_VALUES) {
    answers[`ri_${ri}`] = { type: "noul", noul: 0.1 };
  }
  return answers;
}

const rpcCalls = (name: string) =>
  mocks.rpc.mock.calls.filter(([n]) => n === name);
const costRows = (feature: string) =>
  mocks.log.mock.calls
    .map(([ev]) => ev as { feature: string; [k: string]: unknown })
    .filter((ev) => ev.feature === feature);

afterEach(() => {
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.clearAllMocks();
  steps.length = 0;
  mocks.flags.shopfrontClonePreclassify = true;
  mocks.flags.cloneWatchJevShadow = true;
  // No brake row → not braked.
  mocks.from.mockReturnValue(query({ data: null, error: null }));
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  mocks.callClaude.mockResolvedValue({
    result: {
      is_clone: true,
      confidence: 0.9,
      clone_tactic: "brandjack",
      attack_intent: "credential_phishing",
      risk_indicators: ["login_form_url"],
      reason: "brand + appended word",
    },
    usage: {
      inputTokens: 500,
      outputTokens: 60,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    estimatedCostUsd: 0.0008,
    modelId: "claude-haiku-4-5-20251001",
    cacheHit: false,
  });
  mocks.askJev.mockResolvedValue({
    ok: true,
    answers: goodJevAnswers(),
    model: "jev-1.13.0",
    usage: { inputTokens: 150, outputTokens: 0 },
    elapsedMs: 180,
  });
});

describe("jev-shadow step", () => {
  it("flag OFF: Jev is never called, Haiku persist + cost unchanged, no jev step", async () => {
    mocks.flags.cloneWatchJevShadow = false;

    const out = (await invoke()) as { ok: boolean; jev: string };

    expect(out.ok).toBe(true);
    expect(out.jev).toBe("off");
    expect(mocks.askJev).not.toHaveBeenCalled();
    expect(steps).toEqual(["classify-haiku", "persist"]);
    expect(rpcCalls("record_clone_watch_classification")).toHaveLength(1);
    expect(rpcCalls("record_clone_watch_jev_classification")).toHaveLength(0);
    expect(costRows("shopfront_clone_preclassify")).toHaveLength(1);
  });

  it("success: same input as Haiku, RPC with source='live', typesafe cost row", async () => {
    const out = (await invoke()) as { ok: boolean; jev: string };

    expect(out.ok).toBe(true);
    expect(out.jev).toBe("ok");
    // Folded: no fourth boundary.
    expect(steps).toEqual(["classify-haiku", "persist"]);
    // …and Haiku's row + cost row are written BEFORE Jev is asked.
    const order = mocks.rpc.mock.calls.map(([n]) => n as string);
    expect(order.indexOf("record_clone_watch_classification")).toBeLessThan(
      order.indexOf("record_clone_watch_jev_classification"),
    );
    const haikuCostIdx = mocks.log.mock.calls.findIndex(
      ([ev]) =>
        (ev as { feature: string }).feature === "shopfront_clone_preclassify",
    );
    expect(haikuCostIdx).toBeGreaterThanOrEqual(0);
    expect(mocks.askJev.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.log.mock.invocationCallOrder[haikuCostIdx] ??
        Number.POSITIVE_INFINITY,
    );

    // Apples to apples: the state Jev sees is the same three fields.
    expect(mocks.askJev).toHaveBeenCalledTimes(1);
    const [state] = mocks.askJev.mock.calls[0] as [Record<string, string>];
    expect(state).toEqual({
      brand: "nab.com.au",
      candidate_domain: "nab-secure-login.com",
      candidate_url: "https://nab-secure-login.com/",
    });

    const jevRpc = rpcCalls("record_clone_watch_jev_classification");
    expect(jevRpc).toHaveLength(1);
    expect(jevRpc[0]?.[1]).toMatchObject({
      p_alert_id: 42,
      p_is_clone_p: 0.93,
      p_clone_tactic: "brandjack",
      p_attack_intent: "credential_phishing",
      p_model_id: "jev-1.13.0",
      p_source: "live",
      p_input_tokens: 150,
      p_latency_ms: 180,
    });

    const rows = costRows("shopfront_clone_preclassify_jev");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: "typesafe",
      operation: "classify",
      units: 150,
    });
    expect(rows[0]?.unitCostUsd).toBeCloseTo(0.042 / 1_000_000, 12);
    expect(costRows("shopfront_clone_preclassify_jev_error")).toHaveLength(0);
  });

  it("vendor failure: fail-soft for Haiku, observable as a $0 diagnostic keyed on the reason", async () => {
    mocks.askJev.mockResolvedValue({
      ok: false,
      reason: "rate_limited",
      status: 429,
      elapsedMs: 40,
    });

    const out = (await invoke()) as { ok: boolean; jev: string };

    expect(out.ok).toBe(true);
    expect(out.jev).toBe("error");
    expect(rpcCalls("record_clone_watch_classification")).toHaveLength(1);
    expect(rpcCalls("record_clone_watch_jev_classification")).toHaveLength(0);

    const err = costRows("shopfront_clone_preclassify_jev_error");
    expect(err).toHaveLength(1);
    expect(err[0]).toMatchObject({
      provider: "typesafe",
      units: 0,
      unitCostUsd: 0,
      metadata: expect.objectContaining({
        alert_id: 42,
        reason: "rate_limited",
        status: 429,
      }),
    });
    expect(costRows("shopfront_clone_preclassify_jev")).toHaveLength(0);
  });
});
