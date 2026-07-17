import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchRdapDomain } from "../rdap";
import { logCost } from "../cost-log";
import { getRdapBootstrap } from "../rdap-bootstrap";

// First network-path coverage for fetchRdapDomain (the pure parser is covered by
// rdap.test.ts). We mock the bootstrap resolver and cost log, and stub fetch to
// inspect which URL each call targets.
vi.mock("../cost-log", () => ({ logCost: vi.fn() }));
vi.mock("../rdap-bootstrap", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../rdap-bootstrap")>();
  return { ...actual, getRdapBootstrap: vi.fn() };
});

const COM_MAP = new Map([["com", "https://rdap.verisign.com/com/v1/"]]);
const RDAP_JSON = { objectClassName: "domain", status: ["active"] };

function stubFetch(impl: (url: string) => unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => impl(url)),
  );
}

describe("fetchRdapDomain — direct-registry with rdap.org fallback", () => {
  beforeEach(() => {
    vi.mocked(logCost).mockClear();
    vi.mocked(getRdapBootstrap).mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("hits the registry directly when the bootstrap has the TLD (rdap.org never called)", async () => {
    vi.mocked(getRdapBootstrap).mockResolvedValue(COM_MAP);
    const urls: string[] = [];
    stubFetch((url) => {
      urls.push(url);
      return { ok: true, json: async () => RDAP_JSON };
    });

    const out = await fetchRdapDomain("nimblepayday.com");

    expect(out).toEqual(RDAP_JSON);
    expect(urls).toEqual(["https://rdap.verisign.com/com/v1/domain/nimblepayday.com"]);
    expect(urls.some((u) => u.includes("rdap.org"))).toBe(false);
    expect(logCost).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "whois",
        provider: "rdap",
        operation: "domain-lookup",
        units: 1,
        estimatedCostUsd: 0,
        metadata: { via: "registry" },
      }),
    );
  });

  it("falls back to rdap.org when the registry errors", async () => {
    vi.mocked(getRdapBootstrap).mockResolvedValue(COM_MAP);
    const urls: string[] = [];
    stubFetch((url) => {
      urls.push(url);
      if (url.includes("verisign")) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, json: async () => RDAP_JSON }; // rdap.org
    });

    const out = await fetchRdapDomain("nimblepayday.com");

    expect(out).toEqual(RDAP_JSON);
    expect(urls[0]).toContain("verisign");
    expect(urls[1]).toBe("https://rdap.org/domain/nimblepayday.com");
    expect(logCost).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { via: "rdap.org" } }),
    );
  });

  it("uses rdap.org directly when the bootstrap is unavailable", async () => {
    vi.mocked(getRdapBootstrap).mockResolvedValue(null);
    const urls: string[] = [];
    stubFetch((url) => {
      urls.push(url);
      return { ok: true, json: async () => RDAP_JSON };
    });

    await fetchRdapDomain("x.com");

    expect(urls).toEqual(["https://rdap.org/domain/x.com"]);
  });

  it("uses rdap.org when the TLD has no registry (the .ru case)", async () => {
    vi.mocked(getRdapBootstrap).mockResolvedValue(COM_MAP); // no 'ru' key
    const urls: string[] = [];
    stubFetch((url) => {
      urls.push(url);
      return { ok: true, json: async () => RDAP_JSON };
    });

    await fetchRdapDomain("cartales.ru");

    expect(urls).toEqual(["https://rdap.org/domain/cartales.ru"]);
  });

  it("returns null and logs no cost when both registry and rdap.org 404", async () => {
    vi.mocked(getRdapBootstrap).mockResolvedValue(COM_MAP);
    stubFetch(() => ({ ok: false, status: 404, json: async () => ({}) }));

    const out = await fetchRdapDomain("unregistered.com");

    expect(out).toBeNull();
    expect(logCost).not.toHaveBeenCalled();
  });
});
