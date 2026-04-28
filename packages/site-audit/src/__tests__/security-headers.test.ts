import { describe, it, expect } from "vitest";
import {
  checkHSTS,
  checkXContentTypeOptions,
  checkXFrameOptions,
  checkReferrerPolicy,
  checkSecurityHeaders,
} from "../checks/security-headers";

function makeHeaders(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

describe("checkHSTS", () => {
  it("passes with full HSTS config", () => {
    const headers = makeHeaders({
      "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
    });
    const result = checkHSTS(headers);
    expect(result.status).toBe("pass");
    expect(result.score).toBe(15);
  });

  it("warns with short max-age", () => {
    const headers = makeHeaders({
      "strict-transport-security": "max-age=86400",
    });
    const result = checkHSTS(headers);
    expect(result.status).toBe("warn");
    expect(result.score).toBeLessThan(15);
  });

  it("warns when missing includeSubDomains", () => {
    const headers = makeHeaders({
      "strict-transport-security": "max-age=31536000",
    });
    const result = checkHSTS(headers);
    expect(result.status).toBe("warn");
  });

  it("fails when header is missing", () => {
    const headers = makeHeaders({});
    const result = checkHSTS(headers);
    expect(result.status).toBe("fail");
    expect(result.score).toBe(0);
  });
});

describe("checkXContentTypeOptions", () => {
  it("passes with nosniff", () => {
    const headers = makeHeaders({ "x-content-type-options": "nosniff" });
    const result = checkXContentTypeOptions(headers);
    expect(result.status).toBe("pass");
    expect(result.score).toBe(5);
  });

  it("fails with wrong value", () => {
    const headers = makeHeaders({ "x-content-type-options": "something" });
    const result = checkXContentTypeOptions(headers);
    expect(result.status).toBe("fail");
    expect(result.score).toBe(0);
  });

  it("fails when missing", () => {
    const headers = makeHeaders({});
    const result = checkXContentTypeOptions(headers);
    expect(result.status).toBe("fail");
  });
});

describe("checkXFrameOptions", () => {
  it("passes with DENY", () => {
    const headers = makeHeaders({ "x-frame-options": "DENY" });
    const result = checkXFrameOptions(headers);
    expect(result.status).toBe("pass");
  });

  it("passes with SAMEORIGIN", () => {
    const headers = makeHeaders({ "x-frame-options": "SAMEORIGIN" });
    const result = checkXFrameOptions(headers);
    expect(result.status).toBe("pass");
  });

  it("fails with ALLOW-FROM", () => {
    const headers = makeHeaders({ "x-frame-options": "ALLOW-FROM https://example.com" });
    const result = checkXFrameOptions(headers);
    expect(result.status).toBe("fail");
  });

  it("fails when missing", () => {
    const headers = makeHeaders({});
    const result = checkXFrameOptions(headers);
    expect(result.status).toBe("fail");
  });
});

describe("checkReferrerPolicy", () => {
  it("passes with strict-origin-when-cross-origin", () => {
    const headers = makeHeaders({ "referrer-policy": "strict-origin-when-cross-origin" });
    const result = checkReferrerPolicy(headers);
    expect(result.status).toBe("pass");
    expect(result.score).toBe(5);
  });

  it("passes with no-referrer", () => {
    const headers = makeHeaders({ "referrer-policy": "no-referrer" });
    const result = checkReferrerPolicy(headers);
    expect(result.status).toBe("pass");
  });

  it("warns with unsafe-url", () => {
    const headers = makeHeaders({ "referrer-policy": "unsafe-url" });
    const result = checkReferrerPolicy(headers);
    expect(result.status).toBe("warn");
  });

  it("fails when missing", () => {
    const headers = makeHeaders({});
    const result = checkReferrerPolicy(headers);
    expect(result.status).toBe("fail");
  });
});

describe("checkSecurityHeaders", () => {
  it("returns 5 results (HSTS, XCTO, XFO, ReferrerPolicy, CacheControl)", () => {
    const headers = makeHeaders({});
    const results = checkSecurityHeaders(headers);
    expect(results).toHaveLength(5);
    expect(results.map((r) => r.id)).toEqual([
      "hsts",
      "x-content-type-options",
      "x-frame-options",
      "referrer-policy",
      "cache-control",
    ]);
  });
});
