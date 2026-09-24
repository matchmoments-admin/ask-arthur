import { beforeEach, describe, expect, it, vi } from "vitest";

// supabase-js RETURNS a PostgREST error rather than throwing, so logCost's
// try/catch never saw a rejected insert — a lost Outcome Row was silent
// (review 2026-09-24). It must at least warn.
const warn = vi.hoisted(() => vi.fn());
let insertResult: { error: { message: string } | null } = { error: null };

vi.mock("@askarthur/utils/logger", () => ({
  logger: { warn, info: vi.fn(), error: vi.fn() },
}));
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => ({
    from: () => ({ insert: async () => insertResult }),
  }),
}));

import { logCost } from "../cost-log";

const ARGS = {
  feature: "shopfront_clone_recheck",
  provider: "internal",
  operation: "recheck_batch",
  estimatedCostUsd: 0,
};

describe("logCost", () => {
  beforeEach(() => warn.mockClear());

  it("warns when the insert is rejected (returned, not thrown)", async () => {
    insertResult = { error: { message: "violates check constraint" } };
    await expect(logCost(ARGS)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "logCost insert rejected",
      expect.objectContaining({
        feature: "shopfront_clone_recheck",
        error: "violates check constraint",
      }),
    );
  });

  it("stays quiet on success", async () => {
    insertResult = { error: null };
    await logCost(ARGS);
    expect(warn).not.toHaveBeenCalled();
  });
});
