import { describe, expect, it } from "vitest";

import {
  NETCRAFT_ACTIONED,
  NETCRAFT_DECLINED,
  normaliseNetcraftState,
} from "@/app/api/inngest/functions/clone-watch-poll-netcraft";

/**
 * Regression tests for the v199 Netcraft state-model fix.
 *
 * The pre-v199 bug: a Netcraft "no threats" verdict was treated as a TERMINAL
 * takedown (it matched an invented `no_action_required`/`not_phishing` allowlist
 * that Netcraft never actually returns), so a declined lookalike was silently
 * marked resolved AND miscounted as a takedown. These tests pin the corrected
 * mapping against the REAL Netcraft v3 enum.
 */

/** Mirror of pollOne's classification branch — the single source-of-truth logic. */
function classify(raw: string): "takedown" | "declined" | "pending" {
  const s = normaliseNetcraftState(raw);
  if (NETCRAFT_ACTIONED.has(s)) return "takedown";
  if (NETCRAFT_DECLINED.has(s)) return "declined";
  return "pending";
}

describe("normaliseNetcraftState", () => {
  it("lowercases and collapses whitespace to underscores", () => {
    expect(normaliseNetcraftState("No Threats")).toBe("no_threats");
    expect(normaliseNetcraftState("already blocked")).toBe("already_blocked");
    expect(normaliseNetcraftState("  MALICIOUS  ")).toBe("malicious");
  });
});

describe("Netcraft verdict → lifecycle classification (v199)", () => {
  it("maps live-threat verdicts to a takedown", () => {
    expect(classify("malicious")).toBe("takedown");
    expect(classify("already blocked")).toBe("takedown");
  });

  it("maps 'no threats' to DECLINED, never a takedown (the founder-reported bug)", () => {
    expect(classify("no threats")).toBe("declined");
    expect(classify("No Threats")).toBe("declined");
    // The critical invariant: a declined verdict is NOT a takedown.
    expect(classify("no threats")).not.toBe("takedown");
  });

  it("keeps polling for non-terminal verdicts", () => {
    expect(classify("processing")).toBe("pending");
    expect(classify("suspicious")).toBe("pending");
    expect(classify("unavailable")).toBe("pending");
  });

  it("treats an unrecognised state as pending (drift-safe — never mis-terminalised)", () => {
    expect(classify("some_new_netcraft_label")).toBe("pending");
    expect(classify("unknown")).toBe("pending");
  });

  it("does NOT trap on the invented pre-v199 labels", () => {
    // These strings drove the old bug; they are NOT actioned states now.
    expect(classify("no_action_required")).toBe("pending");
    expect(classify("not_phishing")).toBe("pending");
  });
});
