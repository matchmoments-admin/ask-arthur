import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkExposedAdminPaths } from "../checks/admin-paths";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe("checkExposedAdminPaths", () => {
  it("passes when no paths are accessible", async () => {
    mockFetch.mockRejectedValue(new Error("Not found"));
    const result = await checkExposedAdminPaths("https://example.com");
    expect(result.status).toBe("pass");
    expect(result.score).toBe(5);
  });

  it("warns when admin path is accessible", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/admin")) {
        return { ok: true, status: 200 };
      }
      throw new Error("Not found");
    });
    const result = await checkExposedAdminPaths("https://example.com");
    expect(result.status).toBe("warn");
    expect(result.details).toContain("/admin");
  });

  it("fails when .env is accessible", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/.env")) {
        return { ok: true, status: 200 };
      }
      throw new Error("Not found");
    });
    const result = await checkExposedAdminPaths("https://example.com");
    expect(result.status).toBe("fail");
    expect(result.details).toContain("/.env");
  });

  it("fails when .git/config is accessible", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/.git/config")) {
        return { ok: true, status: 200 };
      }
      throw new Error("Not found");
    });
    const result = await checkExposedAdminPaths("https://example.com");
    expect(result.status).toBe("fail");
  });

  it("ignores allowed paths like robots.txt", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/robots.txt")) {
        return { ok: true, status: 200 };
      }
      throw new Error("Not found");
    });
    const result = await checkExposedAdminPaths("https://example.com");
    expect(result.status).toBe("pass");
  });
});
