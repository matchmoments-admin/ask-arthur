import { describe, it, expect } from "vitest";
import { verdictKindToStatus } from "../types";

describe("verdictKindToStatus", () => {
  it("maps tp → tp_confirmed (fires brand-notify fanout)", () => {
    expect(verdictKindToStatus("tp")).toBe("tp_confirmed");
  });

  it("maps inv → needs_investigation (keeps in queue, no fanout)", () => {
    expect(verdictKindToStatus("inv")).toBe("needs_investigation");
  });

  it("maps fp → fp (terminates the chain)", () => {
    expect(verdictKindToStatus("fp")).toBe("fp");
  });

  it("is exhaustive — every kind maps to a real backend status", () => {
    const kinds = ["tp", "inv", "fp"] as const;
    const statuses = kinds.map(verdictKindToStatus);
    expect(statuses).toEqual(["tp_confirmed", "needs_investigation", "fp"]);
  });
});
