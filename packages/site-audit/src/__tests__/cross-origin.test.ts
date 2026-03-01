import { describe, it, expect } from "vitest";
import {
  checkCOEP,
  checkCOOP,
  checkCORP,
  checkCrossOriginHeaders,
} from "../checks/cross-origin";

function makeHeaders(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

describe("checkCOEP", () => {
  it("passes with require-corp", () => {
    const headers = makeHeaders({ "cross-origin-embedder-policy": "require-corp" });
    const result = checkCOEP(headers);
    expect(result.status).toBe("pass");
    expect(result.score).toBe(3);
  });

  it("passes with credentialless", () => {
    const headers = makeHeaders({ "cross-origin-embedder-policy": "credentialless" });
    const result = checkCOEP(headers);
    expect(result.status).toBe("pass");
    expect(result.score).toBe(3);
  });

  it("warns with unknown value", () => {
    const headers = makeHeaders({ "cross-origin-embedder-policy": "unsafe-none" });
    const result = checkCOEP(headers);
    expect(result.status).toBe("warn");
    expect(result.score).toBe(1);
  });

  it("fails when missing", () => {
    const headers = makeHeaders({});
    const result = checkCOEP(headers);
    expect(result.status).toBe("fail");
    expect(result.score).toBe(0);
  });
});

describe("checkCOOP", () => {
  it("passes with same-origin", () => {
    const headers = makeHeaders({ "cross-origin-opener-policy": "same-origin" });
    const result = checkCOOP(headers);
    expect(result.status).toBe("pass");
    expect(result.score).toBe(3);
  });

  it("warns with same-origin-allow-popups", () => {
    const headers = makeHeaders({ "cross-origin-opener-policy": "same-origin-allow-popups" });
    const result = checkCOOP(headers);
    expect(result.status).toBe("warn");
    expect(result.score).toBe(2);
  });

  it("fails with unsafe-none", () => {
    const headers = makeHeaders({ "cross-origin-opener-policy": "unsafe-none" });
    const result = checkCOOP(headers);
    expect(result.status).toBe("fail");
    expect(result.score).toBe(0);
  });

  it("fails when missing", () => {
    const headers = makeHeaders({});
    const result = checkCOOP(headers);
    expect(result.status).toBe("fail");
    expect(result.score).toBe(0);
  });
});

describe("checkCORP", () => {
  it("passes with same-origin", () => {
    const headers = makeHeaders({ "cross-origin-resource-policy": "same-origin" });
    const result = checkCORP(headers);
    expect(result.status).toBe("pass");
    expect(result.score).toBe(3);
  });

  it("warns with same-site (score 2)", () => {
    const headers = makeHeaders({ "cross-origin-resource-policy": "same-site" });
    const result = checkCORP(headers);
    expect(result.status).toBe("warn");
    expect(result.score).toBe(2);
  });

  it("warns with cross-origin (score 1)", () => {
    const headers = makeHeaders({ "cross-origin-resource-policy": "cross-origin" });
    const result = checkCORP(headers);
    expect(result.status).toBe("warn");
    expect(result.score).toBe(1);
  });

  it("fails when missing", () => {
    const headers = makeHeaders({});
    const result = checkCORP(headers);
    expect(result.status).toBe("fail");
    expect(result.score).toBe(0);
  });
});

describe("checkCrossOriginHeaders", () => {
  it("returns 3 results", () => {
    const headers = makeHeaders({});
    const results = checkCrossOriginHeaders(headers);
    expect(results).toHaveLength(3);
  });

  it("all pass with full isolation headers", () => {
    const headers = makeHeaders({
      "cross-origin-embedder-policy": "require-corp",
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-resource-policy": "same-origin",
    });
    const results = checkCrossOriginHeaders(headers);
    expect(results.every((r) => r.status === "pass")).toBe(true);
    expect(results.reduce((sum, r) => sum + r.score, 0)).toBe(9);
  });
});
