import { beforeEach, describe, expect, it, vi } from "vitest";

// classifyOneWithJev is the ONE write path for the Jev shadow lane (live
// step + backfill). Its contract: never throws on vendor / shape / persist
// failure, and every failure is observable as a $0 diagnostic row keyed on
// the reason; success writes the RPC row and one `typesafe` cost row.
// Two module mocks + a two-method fake client are the whole test surface.

const mocks = vi.hoisted(() => ({
  askJev: vi.fn(),
  log: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@askarthur/scam-engine/providers/jev", () => ({
  askJev: mocks.askJev,
}));
vi.mock("@/lib/cost-telemetry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cost-telemetry")>()),
  logCostAsync: mocks.log,
}));

import {
  JEV_COST_FEATURE,
  JEV_ERROR_FEATURE,
  JevPrimaryError,
  PRECLASSIFY_COST_FEATURE,
  PRECLASSIFY_ERROR_FEATURE,
  classifyOneWithJev,
  classifyPrimaryWithJev,
} from "@/lib/clone-watch/jev-classify-one";
import { riskQuestionId } from "@/lib/clone-watch/jev-preclassify";
import { RISK_INDICATOR_VALUES } from "@/lib/clone-watch/preclassify-vocabulary";

const INPUT = {
  brand: "nab.com.au",
  candidateDomain: "nab-secure-login.com",
  candidateUrl: "https://nab-secure-login.com/",
};

function goodAnswers() {
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
    answers[riskQuestionId(ri)] = { type: "noul", noul: 0.1 };
  }
  return answers;
}

const sb = { rpc: mocks.rpc } as unknown as Parameters<
  typeof classifyOneWithJev
>[0]["sb"];
const run = (source: "live" | "backfill" = "live") =>
  classifyOneWithJev({
    sb,
    alertId: 42,
    input: INPUT,
    source,
    requestId: "t:42",
  });
const costRows = (feature: string) =>
  mocks.log.mock.calls
    .map(([ev]) => ev as { feature: string; [k: string]: unknown })
    .filter((ev) => ev.feature === feature);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  mocks.askJev.mockResolvedValue({
    ok: true,
    answers: goodAnswers(),
    model: "jev-1.13.0",
    usage: { inputTokens: 150, outputTokens: 0 },
    elapsedMs: 180,
  });
});

describe("classifyOneWithJev", () => {
  it("success: same three-field state, RPC with the source, one typesafe cost row", async () => {
    const out = await run("backfill");

    expect(out).toEqual({
      kind: "ok",
      isCloneP: 0.93,
      inputTokens: 150,
      latencyMs: 180,
    });
    const [state] = mocks.askJev.mock.calls[0] as [Record<string, string>];
    expect(state).toEqual({
      brand: "nab.com.au",
      candidate_domain: "nab-secure-login.com",
      candidate_url: "https://nab-secure-login.com/",
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "record_clone_watch_jev_classification",
      expect.objectContaining({
        p_alert_id: 42,
        p_is_clone_p: 0.93,
        p_clone_tactic: "brandjack",
        p_source: "backfill",
        p_model_id: "jev-1.13.0",
      }),
    );
    const rows = costRows(JEV_COST_FEATURE);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: "typesafe",
      operation: "classify",
      units: 150,
    });
    expect(rows[0]?.unitCostUsd).toBeCloseTo(0.042 / 1_000_000, 12);
    expect(costRows(JEV_ERROR_FEATURE)).toHaveLength(0);
  });

  it("vendor failure: no RPC, $0 diagnostic keyed on the adapter reason, never throws", async () => {
    mocks.askJev.mockResolvedValue({
      ok: false,
      reason: "rate_limited",
      status: 429,
      elapsedMs: 40,
    });

    await expect(run()).resolves.toEqual({
      kind: "error",
      reason: "rate_limited",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(costRows(JEV_ERROR_FEATURE)[0]).toMatchObject({
      provider: "typesafe",
      units: 0,
      unitCostUsd: 0,
      metadata: expect.objectContaining({
        alert_id: 42,
        reason: "rate_limited",
        status: 429,
        source: "live",
      }),
    });
    expect(costRows(JEV_COST_FEATURE)).toHaveLength(0);
  });

  it("malformed answers: no half-row, bad_answers diagnostic", async () => {
    const answers = goodAnswers();
    delete answers[riskQuestionId("suspicious_tld")];
    mocks.askJev.mockResolvedValue({
      ok: true,
      answers,
      model: "jev-1.13.0",
      usage: { inputTokens: 150, outputTokens: 0 },
      elapsedMs: 100,
    });

    await expect(run()).resolves.toEqual({
      kind: "error",
      reason: "bad_answers",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(costRows(JEV_ERROR_FEATURE)[0]?.metadata).toMatchObject({
      reason: "bad_answers",
    });
  });

  it("persist failure: diagnostic, no success cost row", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });

    await expect(run()).resolves.toEqual({
      kind: "error",
      reason: "persist_failed",
    });
    expect(costRows(JEV_COST_FEATURE)).toHaveLength(0);
    expect(costRows(JEV_ERROR_FEATURE)[0]?.metadata).toMatchObject({
      reason: "persist_failed",
    });
  });
});

describe("classifyPrimaryWithJev (ADR-0026 — Jev IS the pre-classifier)", () => {
  const runPrimary = () =>
    classifyPrimaryWithJev({
      sb,
      alertId: 42,
      input: INPUT,
      requestId: "p:42",
    });

  it("success: writes the v157 gate row FIRST, then the v311 raw row, then one cost row under the pre-classifier's own feature", async () => {
    const out = await runPrimary();

    expect(out).toMatchObject({
      is_clone: true,
      confidence: 0.93,
      clone_tactic: "brandjack",
      attack_intent: "credential_phishing",
      model_id: "jev-1.13.0",
      input_tokens: 150,
      latency_ms: 180,
    });
    const names = mocks.rpc.mock.calls.map(([n]) => n as string);
    expect(names).toEqual([
      "record_clone_watch_classification",
      "record_clone_watch_jev_classification",
    ]);
    expect(mocks.rpc.mock.calls[0]?.[1]).toMatchObject({
      p_alert_id: 42,
      p_is_clone: true,
      p_confidence: 0.93,
      p_model_id: "jev-1.13.0",
      p_prompt_version: "jev-v1",
      p_reason: expect.stringContaining("jev p=0.93"),
    });
    expect(mocks.rpc.mock.calls[1]?.[1]).toMatchObject({
      p_alert_id: 42,
      p_source: "live",
    });

    const rows = costRows(PRECLASSIFY_COST_FEATURE);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: "typesafe",
      operation: "classify",
      units: 150,
    });
    expect(costRows(JEV_COST_FEATURE)).toHaveLength(0);
    expect(costRows(PRECLASSIFY_ERROR_FEATURE)).toHaveLength(0);
  });

  it("vendor failure: logs the pre-classifier _error row (typesafe) and THROWS so Inngest retries", async () => {
    mocks.askJev.mockResolvedValue({
      ok: false,
      reason: "timeout",
      elapsedMs: 8000,
    });

    await expect(runPrimary()).rejects.toBeInstanceOf(JevPrimaryError);
    expect(mocks.rpc).not.toHaveBeenCalled();
    const err = costRows(PRECLASSIFY_ERROR_FEATURE);
    expect(err).toHaveLength(1);
    expect(err[0]).toMatchObject({
      provider: "typesafe",
      operation: "classify_error",
      units: 0,
      metadata: expect.objectContaining({ alert_id: 42, reason: "timeout" }),
    });
    expect(costRows(PRECLASSIFY_COST_FEATURE)).toHaveLength(0);
  });

  it("gate-row persist failure throws (the row every gate reads is the one that matters)", async () => {
    mocks.rpc.mockImplementation(async (name: string) =>
      name === "record_clone_watch_classification"
        ? { data: null, error: { message: "boom" } }
        : { data: null, error: null },
    );

    await expect(runPrimary()).rejects.toMatchObject({
      reason: "persist_failed",
    });
    expect(mocks.rpc.mock.calls.map(([n]) => n)).toEqual([
      "record_clone_watch_classification",
    ]);
    expect(costRows(PRECLASSIFY_COST_FEATURE)).toHaveLength(0);
  });

  it("raw-row persist failure is a warn, not a retry: gate row + cost row still land", async () => {
    mocks.rpc.mockImplementation(async (name: string) =>
      name === "record_clone_watch_jev_classification"
        ? { data: null, error: { message: "boom" } }
        : { data: null, error: null },
    );

    await expect(runPrimary()).resolves.toMatchObject({ is_clone: true });
    expect(costRows(PRECLASSIFY_COST_FEATURE)).toHaveLength(1);
    expect(costRows(PRECLASSIFY_ERROR_FEATURE)).toHaveLength(0);
  });
});

// isPreclassifyBraked delegates to the fail-closed brakeState policy; the
// three outcomes are pinned in packages/scam-engine/src/__tests__/brake-state.test.ts.
