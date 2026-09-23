import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Bounded Netcraft deferral (v248 issue / v252 resubmit). Until this Module,
 * neither lane's deferral RPC args were asserted anywhere: a changed interval
 * or round cap shipped silently. These pin each lane's RPC, args and error
 * policy, and that both lanes route through the Module.
 */
const m = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("@askarthur/utils/logger", () => ({
  logger: { warn: m.warn, info: vi.fn(), error: vi.fn() },
}));

import {
  deferNetcraftAlerts,
  NETCRAFT_DEFERRAL,
} from "@/lib/clone-watch/netcraft-deferral";

const NOW = Date.parse("2026-09-24T00:00:00.000Z");
const H = 3600 * 1000;

function fakeSb(result: { data?: unknown; error?: { message: string } | null }) {
  const rpc = vi.fn(async () => ({ data: result.data ?? null, error: result.error ?? null }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { sb: { rpc } as any, rpc };
}

beforeEach(() => m.warn.mockReset());

describe("lane policies", () => {
  it("pins the issue lane: v248 RPC, 5 rounds, 72h dead / 24h unavailable+transient, throws", () => {
    expect(NETCRAFT_DEFERRAL.issue).toEqual({
      rpc: "defer_clone_alert_netcraft_issue",
      maxRounds: 5,
      onError: "throw",
      deadRecheckMs: 72 * H,
      unavailableRecheckMs: 24 * H,
      transientRecheckMs: 24 * H,
    });
  });

  it("pins the resubmit lane: v252 RPC, 5 rounds, 7-day dead recheck, warns", () => {
    expect(NETCRAFT_DEFERRAL.resubmit).toEqual({
      rpc: "defer_clone_alert_netcraft_resubmit",
      maxRounds: 5,
      onError: "warn",
      deadRecheckMs: 7 * 24 * H,
    });
  });
});

describe("deferNetcraftAlerts", () => {
  it("issue: calls the v248 RPC with the exact args", async () => {
    const { sb, rpc } = fakeSb({ data: 2 });
    const n = await deferNetcraftAlerts(sb, "issue", [1, 2], "dead_at_probe", 72 * H, NOW);
    expect(n).toBe(2);
    expect(rpc).toHaveBeenCalledWith("defer_clone_alert_netcraft_issue", {
      p_alert_ids: [1, 2],
      p_reason: "dead_at_probe",
      p_recheck_after: "2026-09-27T00:00:00.000Z",
      p_max_rounds: 5,
    });
  });

  it("resubmit: calls the v252 RPC with the exact args", async () => {
    const { sb, rpc } = fakeSb({ data: 3 });
    const n = await deferNetcraftAlerts(
      sb,
      "resubmit",
      [7, 8, 9],
      "dead_at_probe",
      NETCRAFT_DEFERRAL.resubmit.deadRecheckMs,
      NOW,
    );
    expect(n).toBe(3);
    expect(rpc).toHaveBeenCalledWith("defer_clone_alert_netcraft_resubmit", {
      p_alert_ids: [7, 8, 9],
      p_reason: "dead_at_probe",
      p_recheck_after: "2026-10-01T00:00:00.000Z",
      p_max_rounds: 5,
    });
  });

  it("empty id list makes no RPC call", async () => {
    const { sb, rpc } = fakeSb({ data: 0 });
    expect(await deferNetcraftAlerts(sb, "issue", [], "unavailable", 24 * H)).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("issue: an RPC error throws (the step retries; a lost deferral re-presents the row)", async () => {
    const { sb } = fakeSb({ error: { message: "boom" } });
    await expect(
      deferNetcraftAlerts(sb, "issue", [1], "transient_state", 24 * H),
    ).rejects.toThrow("defer_clone_alert_netcraft_issue(transient_state) failed (1 alerts): boom");
  });

  it("resubmit: an RPC error warns and returns 0 (live rows still get filed)", async () => {
    const { sb } = fakeSb({ error: { message: "boom" } });
    const n = await deferNetcraftAlerts(sb, "resubmit", [4, 5], "dead_at_probe", 7 * 24 * H);
    expect(n).toBe(0);
    expect(m.warn).toHaveBeenCalledWith(
      "netcraft-resubmit: deferral failed",
      expect.objectContaining({ error: "boom", alertIds: [4, 5] }),
    );
  });

  it("a non-numeric RPC result counts as 0", async () => {
    const { sb } = fakeSb({ data: null });
    expect(await deferNetcraftAlerts(sb, "resubmit", [1], "dead_at_probe", H)).toBe(0);
  });
});

describe("both lanes route through the Module", () => {
  const fnDir = path.join(__dirname, "../app/api/inngest/functions");
  const read = (f: string) => fs.readFileSync(path.join(fnDir, f), "utf8");

  it.each([
    ["clone-watch-netcraft-issue.ts", "issue"],
    ["clone-watch-netcraft-auto.ts", "resubmit"],
  ])("%s calls deferNetcraftAlerts(sb, %j, …) and never the RPC directly", (file, lane) => {
    const src = read(file);
    expect(src).not.toMatch(/\.rpc\(\s*"defer_clone_alert_netcraft_/);
    expect(src).toMatch(new RegExp(`deferNetcraftAlerts\\(\\s*sb,\\s*"${lane}"`));
  });
});
