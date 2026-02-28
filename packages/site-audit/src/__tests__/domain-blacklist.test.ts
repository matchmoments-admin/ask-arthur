import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:dns", () => ({
  promises: {
    resolve4: vi.fn(),
  },
}));

import * as dns from "node:dns";
import { checkDomainBlacklist } from "../checks/domain-blacklist";

const mockResolve4 = dns.promises.resolve4 as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockResolve4.mockReset();
  // Default: not listed on any blacklist (ENOTFOUND)
  mockResolve4.mockRejectedValue(new Error("ENOTFOUND"));
});

describe("checkDomainBlacklist", () => {
  it("passes when domain is not listed on any blacklist", async () => {
    const result = await checkDomainBlacklist("example.com");
    expect(result.status).toBe("pass");
    expect(result.score).toBe(5);
    expect(result.id).toBe("domain-blacklist");
    expect(result.category).toBe("server");
  });

  it("fails when domain is listed on a blacklist", async () => {
    mockResolve4.mockImplementation(async (query: string) => {
      if (query.includes("dbl.spamhaus.org")) {
        return ["127.0.1.2"];
      }
      throw new Error("ENOTFOUND");
    });

    const result = await checkDomainBlacklist("malicious.com");
    expect(result.status).toBe("fail");
    expect(result.score).toBe(0);
    expect(result.details).toContain("Spamhaus DBL");
  });

  it("fails and lists multiple blacklists when listed on several", async () => {
    mockResolve4.mockImplementation(async (query: string) => {
      if (
        query.includes("dbl.spamhaus.org") ||
        query.includes("multi.surbl.org")
      ) {
        return ["127.0.0.2"];
      }
      throw new Error("ENOTFOUND");
    });

    const result = await checkDomainBlacklist("very-malicious.com");
    expect(result.status).toBe("fail");
    expect(result.score).toBe(0);
    expect(result.details).toContain("Spamhaus DBL");
    expect(result.details).toContain("SURBL");
    expect(result.details).toContain("2 blacklists");
  });

  it("handles DNS timeouts gracefully (treats as not listed)", async () => {
    mockResolve4.mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 50))
    );

    const result = await checkDomainBlacklist("slow-dns.com");
    expect(result.status).toBe("pass");
    expect(result.score).toBe(5);
  });
});
