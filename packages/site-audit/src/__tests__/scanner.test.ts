import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock external dependencies
vi.mock("@askarthur/scam-engine/safebrowsing", () => ({
  isPrivateURL: vi.fn((url: string) => url.includes("127.0.0.1") || url.includes("localhost")),
}));

vi.mock("@askarthur/scam-engine/url-normalize", () => ({
  extractDomain: vi.fn((url: string) => {
    try {
      return new URL(url).hostname;
    } catch {
      return null;
    }
  }),
}));

vi.mock("@askarthur/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// Mock node:dns for email-security and domain-blacklist checks
vi.mock("node:dns", () => ({
  promises: {
    resolveTxt: vi.fn().mockRejectedValue(new Error("ENOTFOUND")),
    resolve4: vi.fn().mockRejectedValue(new Error("ENOTFOUND")),
  },
}));

// Mock tls for SSL/TLS checks
vi.mock("tls", () => {
  const EventEmitter = require("events");
  return {
    connect: vi.fn((...args: unknown[]) => {
      const socket = new EventEmitter();
      socket.destroy = vi.fn();
      socket.getPeerCertificate = vi.fn(() => ({
        valid_to: new Date(Date.now() + 90 * 86400000).toUTCString(),
        valid_from: new Date(Date.now() - 30 * 86400000).toUTCString(),
        issuer: { O: "Test CA", CN: "Test" },
      }));
      socket.getProtocol = vi.fn(() => "TLSv1.3");
      socket.getCipher = vi.fn(() => ({ name: "TLS_AES_256_GCM_SHA384" }));
      socket.authorized = true;

      setTimeout(() => {
        const callback = args.find((a) => typeof a === "function") as Function;
        if (callback) callback();
      }, 0);

      return socket;
    }),
  };
});

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { runSiteAudit } from "../scanner";

beforeEach(() => {
  mockFetch.mockReset();
});

describe("runSiteAudit", () => {
  it("rejects private URLs", async () => {
    await expect(
      runSiteAudit({ url: "http://127.0.0.1/admin" })
    ).rejects.toThrow("private or internal");
  });

  it("rejects invalid URLs", async () => {
    await expect(
      runSiteAudit({ url: "not-a-url" })
    ).rejects.toThrow();
  });

  it("returns a complete audit result for a well-configured site", async () => {
    // Mock the initial page fetch
    mockFetch.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (opts?.method === "HEAD") {
        // Admin paths check — return 404
        return { ok: false, status: 404 };
      }
      // Main page fetch
      return {
        ok: true,
        status: 200,
        url: "https://example.com",
        headers: new Headers({
          "strict-transport-security": "max-age=31536000; includeSubDomains",
          "x-content-type-options": "nosniff",
          "x-frame-options": "DENY",
          "referrer-policy": "strict-origin-when-cross-origin",
          "content-security-policy": "default-src 'self'; script-src 'self'",
          "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), autoplay=()",
          server: "cloudflare",
        }),
        text: async () => '<html><head></head><body><img src="https://cdn.example.com/img.png"></body></html>',
      };
    });

    const result = await runSiteAudit({
      url: "https://example.com",
      totalTimeoutMs: 10000,
    });

    expect(result.url).toBe("https://example.com");
    expect(result.domain).toBe("example.com");
    expect(result.overallScore).toBeGreaterThan(0);
    expect(result.grade).toBeDefined();
    expect(result.categories.length).toBeGreaterThan(0);
    expect(result.checks.length).toBeGreaterThan(0);
    expect(result.scannedAt).toBeDefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("handles fetch failure gracefully", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    // Scanner no longer throws on fetch failure — it returns a partial result
    // with fetchError populated and partial=true so async TLS/SSL/admin-path
    // checks can still run on the domain.
    const result = await runSiteAudit({ url: "https://example.com" });
    expect(result.partial).toBe(true);
    expect(result.fetchError).toMatchObject({ type: "network_error" });
    expect(result.url).toBe("https://example.com");
    expect(result.domain).toBe("example.com");
  });

  it("generates recommendations for failing checks", async () => {
    mockFetch.mockImplementation(async (_url: string, opts?: RequestInit) => {
      if (opts?.method === "HEAD") {
        return { ok: false, status: 404 };
      }
      return {
        ok: true,
        status: 200,
        url: "https://example.com",
        headers: new Headers({}), // No security headers at all
        text: async () => "<html><body></body></html>",
      };
    });

    const result = await runSiteAudit({
      url: "https://example.com",
      totalTimeoutMs: 10000,
    });

    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.grade).not.toBe("A+");
  });
});
