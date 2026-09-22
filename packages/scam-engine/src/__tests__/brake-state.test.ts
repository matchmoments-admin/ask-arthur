import { beforeEach, describe, expect, it, vi } from "vitest";

// brakeState is the ONE read of feature_brakes. Before 2026-09-23 five copies
// disagreed on the third outcome: a PostgREST error is RETURNED, not thrown,
// so isFeatureBraked read it as "clear" while three inline copies read it as
// "engaged". These pin the three outcomes and both caller policies.
let result: { data: unknown; error: unknown } | "throw" | "no-client" = {
  data: null,
  error: null,
};

vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => {
    if (result === "no-client") return null;
    const chain: Record<string, unknown> = {};
    for (const m of ["from", "select", "eq"]) chain[m] = () => chain;
    chain.maybeSingle = async () => {
      if (result === "throw") throw new Error("network");
      return result;
    };
    return chain;
  },
}));

import {
  brakeState,
  isFeatureBraked,
  isFeatureBrakedOrUnknown,
} from "../cost-log";

const future = () => new Date(Date.now() + 3_600_000).toISOString();
const past = () => new Date(Date.now() - 3_600_000).toISOString();

describe("brakeState", () => {
  beforeEach(() => {
    result = { data: null, error: null };
  });

  it("engaged when paused_until is in the future", async () => {
    result = { data: { paused_until: future() }, error: null };
    expect(await brakeState("x")).toBe("engaged");
  });

  it("clear when absent or in the past", async () => {
    expect(await brakeState("x")).toBe("clear");
    result = { data: { paused_until: past() }, error: null };
    expect(await brakeState("x")).toBe("clear");
  });

  it.each([
    ["a returned PostgREST error", { data: null, error: { message: "db" } }],
    ["a thrown error", "throw"],
    ["no client", "no-client"],
  ] as const)("unknown on %s", async (_label, r) => {
    result = r as typeof result;
    expect(await brakeState("x")).toBe("unknown");
  });
});

describe("brake policies", () => {
  it("fail-open: only a confirmed engaged brake stops", async () => {
    result = { data: null, error: { message: "db" } };
    expect(await isFeatureBraked("x")).toBe(false);
    result = { data: { paused_until: future() }, error: null };
    expect(await isFeatureBraked("x")).toBe(true);
  });

  it("fail-closed: an unreadable brake counts as engaged", async () => {
    result = { data: null, error: { message: "db" } };
    expect(await isFeatureBrakedOrUnknown("x")).toBe(true);
    result = { data: null, error: null };
    expect(await isFeatureBrakedOrUnknown("x")).toBe(false);
  });
});
