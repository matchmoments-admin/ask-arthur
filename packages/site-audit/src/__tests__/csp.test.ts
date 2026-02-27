import { describe, it, expect } from "vitest";
import {
  checkCSPPresent,
  checkCSPUnsafeInline,
  checkCSPUnsafeEval,
  checkCSP,
} from "../checks/csp";

function makeHeaders(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

describe("checkCSPPresent", () => {
  it("passes with default-src", () => {
    const headers = makeHeaders({
      "content-security-policy": "default-src 'self'; script-src 'self'",
    });
    const result = checkCSPPresent(headers);
    expect(result.status).toBe("pass");
    expect(result.score).toBe(10);
  });

  it("passes with script-src only", () => {
    const headers = makeHeaders({
      "content-security-policy": "script-src 'self'",
    });
    const result = checkCSPPresent(headers);
    expect(result.status).toBe("pass");
  });

  it("warns when CSP exists but lacks key directives", () => {
    const headers = makeHeaders({
      "content-security-policy": "img-src 'self'",
    });
    const result = checkCSPPresent(headers);
    expect(result.status).toBe("warn");
    expect(result.score).toBe(5);
  });

  it("fails when header is missing", () => {
    const headers = makeHeaders({});
    const result = checkCSPPresent(headers);
    expect(result.status).toBe("fail");
    expect(result.score).toBe(0);
  });
});

describe("checkCSPUnsafeInline", () => {
  it("passes when no unsafe-inline", () => {
    const headers = makeHeaders({
      "content-security-policy": "default-src 'self'; script-src 'self'",
    });
    const result = checkCSPUnsafeInline(headers);
    expect(result.status).toBe("pass");
    expect(result.score).toBe(5);
  });

  it("warns when unsafe-inline present", () => {
    const headers = makeHeaders({
      "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'",
    });
    const result = checkCSPUnsafeInline(headers);
    expect(result.status).toBe("warn");
    expect(result.score).toBe(0);
  });

  it("skips when no CSP header", () => {
    const headers = makeHeaders({});
    const result = checkCSPUnsafeInline(headers);
    expect(result.status).toBe("skipped");
  });
});

describe("checkCSPUnsafeEval", () => {
  it("passes when no unsafe-eval", () => {
    const headers = makeHeaders({
      "content-security-policy": "default-src 'self'",
    });
    const result = checkCSPUnsafeEval(headers);
    expect(result.status).toBe("pass");
  });

  it("fails when unsafe-eval present", () => {
    const headers = makeHeaders({
      "content-security-policy": "default-src 'self'; script-src 'unsafe-eval'",
    });
    const result = checkCSPUnsafeEval(headers);
    expect(result.status).toBe("fail");
    expect(result.score).toBe(0);
  });

  it("skips when no CSP header", () => {
    const headers = makeHeaders({});
    const result = checkCSPUnsafeEval(headers);
    expect(result.status).toBe("skipped");
  });
});

describe("checkCSP", () => {
  it("returns 3 results", () => {
    const headers = makeHeaders({
      "content-security-policy": "default-src 'self'",
    });
    const results = checkCSP(headers);
    expect(results).toHaveLength(3);
  });
});
