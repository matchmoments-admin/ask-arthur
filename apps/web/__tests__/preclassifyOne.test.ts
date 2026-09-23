import { beforeEach, describe, expect, it, vi } from "vitest";

// The pre-classifier Module (lib/clone-watch/preclassify-one.ts) tested
// WITHOUT the Inngest function — the point of moving it out (architecture
// review 2026-09-24, #5): the ADR-0026 rollback adapter (Haiku) is now
// reachable directly.

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  log: vi.fn(),
  callClaude: vi.fn(),
  askJev: vi.fn(),
  flags: { cloneWatchJevShadow: false, cloneWatchJevPrimary: true },
}));

vi.mock("@askarthur/utils/feature-flags", () => ({ featureFlags: mocks.flags }));
vi.mock("@askarthur/scam-engine/anthropic", () => ({ callClaudeJson: mocks.callClaude }));
vi.mock("@askarthur/scam-engine/providers/jev", () => ({ askJev: mocks.askJev }));
vi.mock("@/lib/cost-telemetry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cost-telemetry")>()),
  logCost: mocks.log,
  logCostAsync: mocks.log,
}));

import {
  classifyAlert,
  concurrencyFor,
  preclassifyMode,
} from "@/lib/clone-watch/preclassify-one";

const sb = { rpc: mocks.rpc } as unknown as Parameters<typeof classifyAlert>[0];
const ALERT = {
  alertId: 7,
  brand: "nab.com.au",
  candidateDomain: "nab-secure-login.com",
  candidateUrl: "https://nab-secure-login.com/",
} as Parameters<typeof classifyAlert>[1];

const HAIKU_OK = {
  result: {
    is_clone: true,
    confidence: 0.9,
    clone_tactic: "brandjack",
    attack_intent: "credential_phishing",
    risk_indicators: [],
    reason: "brand + secure-login",
  },
  modelId: "claude-haiku-4-5-20251001",
  usage: { inputTokens: 400, outputTokens: 60 },
  cacheHit: false,
  estimatedCostUsd: 0.0006,
};

const rows = (feature: string) =>
  mocks.log.mock.calls.map(([r]) => r).filter((r) => r.feature === feature);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.flags.cloneWatchJevShadow = false;
  mocks.flags.cloneWatchJevPrimary = true;
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  mocks.callClaude.mockResolvedValue(HAIKU_OK);
});

describe("mode", () => {
  it("follows FF_CLONE_WATCH_JEV_PRIMARY, with the adapter's concurrency", () => {
    expect(preclassifyMode()).toBe("jev");
    mocks.flags.cloneWatchJevPrimary = false;
    expect(preclassifyMode()).toBe("haiku");
    expect(concurrencyFor("jev")).toBeGreaterThan(concurrencyFor("haiku"));
  });

  it("an explicit mode wins over the flag (the batch reads it once)", async () => {
    mocks.flags.cloneWatchJevPrimary = true;
    await classifyAlert(sb, ALERT, "haiku");
    expect(mocks.callClaude).toHaveBeenCalledTimes(1);
    expect(mocks.askJev).not.toHaveBeenCalled();
  });
});

describe("Haiku adapter (ADR-0026 rollback)", () => {
  it("persists, writes one anthropic cost row, and reports jev:off with the shadow disabled", async () => {
    const out = await classifyAlert(sb, ALERT, "haiku");
    expect(out).toMatchObject({ ok: true, is_clone: true, confidence: 0.9, jev: "off" });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "record_clone_watch_classification",
      expect.objectContaining({ p_alert_id: 7, p_model_id: "claude-haiku-4-5-20251001" }),
    );
    expect(rows("shopfront_clone_preclassify")).toEqual([
      expect.objectContaining({ provider: "anthropic", operation: "classify", units: 460 }),
    ]);
  });

  it("a vendor failure writes the _error row, then throws", async () => {
    mocks.callClaude.mockRejectedValue(new Error("overloaded"));
    await expect(classifyAlert(sb, ALERT, "haiku")).rejects.toThrow("overloaded");
    expect(rows("shopfront_clone_preclassify_error")).toEqual([
      expect.objectContaining({ operation: "classify_error" }),
    ]);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  // Fixed 2026-09-24: this path threw with NO _error row, so a rollback-mode
  // persist failure never reached the health digest (the Jev adapter logged).
  it("a persist failure writes the _error row, then throws", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "db down" } });
    await expect(classifyAlert(sb, ALERT, "haiku")).rejects.toThrow("db down");
    expect(rows("shopfront_clone_preclassify_error")).toEqual([
      expect.objectContaining({
        operation: "persist_error",
        metadata: expect.objectContaining({ alert_id: 7, error_message: "db down" }),
      }),
    ]);
    expect(rows("shopfront_clone_preclassify")).toHaveLength(0);
  });
});
