import { describe, it, expect } from "vitest";
import { checkServerInfo, parseServerHeader } from "../checks/server-info";

function makeHeaders(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

describe("parseServerHeader", () => {
  it("parses Apache with version", () => {
    const result = parseServerHeader("Apache/2.4.51");
    expect(result.software).toBe("Apache");
    expect(result.version).toBe("2.4.51");
    expect(result.isDisclosed).toBe(true);
  });

  it("parses nginx without version", () => {
    const result = parseServerHeader("nginx");
    expect(result.software).toBe("nginx");
    expect(result.version).toBeNull();
    expect(result.isDisclosed).toBe(false);
  });

  it("parses Cloudflare", () => {
    const result = parseServerHeader("cloudflare");
    expect(result.software).toBe("Cloudflare");
  });

  it("handles null", () => {
    const result = parseServerHeader(null);
    expect(result.software).toBeNull();
    expect(result.isDisclosed).toBe(false);
  });
});

describe("checkServerInfo", () => {
  it("passes when no Server header", () => {
    const headers = makeHeaders({});
    const { check } = checkServerInfo(headers);
    expect(check.status).toBe("pass");
    expect(check.score).toBe(5);
  });

  it("passes for CDN platforms", () => {
    const headers = makeHeaders({ server: "cloudflare" });
    const { check } = checkServerInfo(headers);
    expect(check.status).toBe("pass");
  });

  it("passes for Vercel", () => {
    const headers = makeHeaders({ server: "Vercel" });
    const { check } = checkServerInfo(headers);
    expect(check.status).toBe("pass");
  });

  it("fails when version is disclosed", () => {
    const headers = makeHeaders({ server: "Apache/2.4.51" });
    const { check, info } = checkServerInfo(headers);
    expect(check.status).toBe("fail");
    expect(check.score).toBe(0);
    expect(info.version).toBe("2.4.51");
  });

  it("warns for generic server name without version", () => {
    const headers = makeHeaders({ server: "nginx" });
    const { check } = checkServerInfo(headers);
    expect(check.status).toBe("warn");
    expect(check.score).toBe(3);
  });
});
