import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock node:dns before importing the module
vi.mock("node:dns", () => ({
  promises: {
    resolveTxt: vi.fn(),
    resolve4: vi.fn(),
  },
}));

import * as dns from "node:dns";
import { checkEmailSecurity } from "../checks/email-security";

const mockResolveTxt = dns.promises.resolveTxt as ReturnType<typeof vi.fn>;
const mockResolve4 = dns.promises.resolve4 as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockResolveTxt.mockReset();
  mockResolve4.mockReset();
  // Default: no records found
  mockResolveTxt.mockRejectedValue(new Error("ENOTFOUND"));
  mockResolve4.mockRejectedValue(new Error("ENOTFOUND"));
});

describe("checkEmailSecurity", () => {
  describe("SPF", () => {
    it("passes when SPF record exists", async () => {
      mockResolveTxt.mockImplementation(async (hostname: string) => {
        if (hostname === "example.com") {
          return [["v=spf1 include:_spf.google.com ~all"]];
        }
        throw new Error("ENOTFOUND");
      });

      const results = await checkEmailSecurity("example.com");
      const spf = results.find((r) => r.id === "spf");
      expect(spf?.status).toBe("pass");
      expect(spf?.score).toBe(3);
    });

    it("fails when no SPF record exists", async () => {
      const results = await checkEmailSecurity("example.com");
      const spf = results.find((r) => r.id === "spf");
      expect(spf?.status).toBe("fail");
      expect(spf?.score).toBe(0);
    });
  });

  describe("DMARC", () => {
    it("passes with p=reject policy", async () => {
      mockResolveTxt.mockImplementation(async (hostname: string) => {
        if (hostname === "_dmarc.example.com") {
          return [["v=DMARC1; p=reject; rua=mailto:dmarc@example.com"]];
        }
        throw new Error("ENOTFOUND");
      });

      const results = await checkEmailSecurity("example.com");
      const dmarc = results.find((r) => r.id === "dmarc");
      expect(dmarc?.status).toBe("pass");
      expect(dmarc?.score).toBe(4);
    });

    it("warns with p=quarantine policy", async () => {
      mockResolveTxt.mockImplementation(async (hostname: string) => {
        if (hostname === "_dmarc.example.com") {
          return [["v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com"]];
        }
        throw new Error("ENOTFOUND");
      });

      const results = await checkEmailSecurity("example.com");
      const dmarc = results.find((r) => r.id === "dmarc");
      expect(dmarc?.status).toBe("warn");
      expect(dmarc?.score).toBe(2);
    });

    it("warns with p=none policy", async () => {
      mockResolveTxt.mockImplementation(async (hostname: string) => {
        if (hostname === "_dmarc.example.com") {
          return [["v=DMARC1; p=none"]];
        }
        throw new Error("ENOTFOUND");
      });

      const results = await checkEmailSecurity("example.com");
      const dmarc = results.find((r) => r.id === "dmarc");
      expect(dmarc?.status).toBe("warn");
      expect(dmarc?.score).toBe(2);
    });

    it("fails when no DMARC record exists", async () => {
      const results = await checkEmailSecurity("example.com");
      const dmarc = results.find((r) => r.id === "dmarc");
      expect(dmarc?.status).toBe("fail");
      expect(dmarc?.score).toBe(0);
    });
  });

  describe("DKIM", () => {
    it("passes when a common selector is found", async () => {
      mockResolveTxt.mockImplementation(async (hostname: string) => {
        if (hostname === "google._domainkey.example.com") {
          return [["v=DKIM1; k=rsa; p=MIIBIjANBg..."]];
        }
        throw new Error("ENOTFOUND");
      });

      const results = await checkEmailSecurity("example.com");
      const dkim = results.find((r) => r.id === "dkim");
      expect(dkim?.status).toBe("pass");
      expect(dkim?.score).toBe(3);
      expect(dkim?.details).toContain("google");
    });

    it("warns when no DKIM selectors found", async () => {
      const results = await checkEmailSecurity("example.com");
      const dkim = results.find((r) => r.id === "dkim");
      expect(dkim?.status).toBe("warn");
      expect(dkim?.score).toBe(1);
    });
  });

  it("returns 3 check results", async () => {
    const results = await checkEmailSecurity("example.com");
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.id)).toEqual(["spf", "dmarc", "dkim"]);
  });

  it("all checks have email category", async () => {
    const results = await checkEmailSecurity("example.com");
    for (const result of results) {
      expect(result.category).toBe("email");
    }
  });
});
