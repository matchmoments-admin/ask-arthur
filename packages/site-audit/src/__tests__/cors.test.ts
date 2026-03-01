import { describe, it, expect } from "vitest";
import { checkCORS } from "../checks/cors";

function makeHeaders(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

describe("checkCORS", () => {
  it("passes when no ACAO header present", () => {
    const headers = makeHeaders({});
    const result = checkCORS(headers);
    expect(result.status).toBe("pass");
    expect(result.score).toBe(3);
  });

  it("passes with specific origin", () => {
    const headers = makeHeaders({
      "access-control-allow-origin": "https://example.com",
    });
    const result = checkCORS(headers);
    expect(result.status).toBe("pass");
    expect(result.score).toBe(3);
  });

  it("warns with wildcard *", () => {
    const headers = makeHeaders({
      "access-control-allow-origin": "*",
    });
    const result = checkCORS(headers);
    expect(result.status).toBe("warn");
    expect(result.score).toBe(1);
  });

  it("has correct id and category", () => {
    const headers = makeHeaders({});
    const result = checkCORS(headers);
    expect(result.id).toBe("cors");
    expect(result.category).toBe("headers");
    expect(result.maxScore).toBe(3);
  });
});
