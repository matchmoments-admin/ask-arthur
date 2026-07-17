import { describe, expect, it } from "vitest";
import {
  parseBootstrap,
  resolveRegistryBase,
  buildRegistryDomainUrl,
} from "../rdap-bootstrap";

// Trimmed real shape of https://data.iana.org/rdap/dns.json (RFC 9224).
const BOOTSTRAP = {
  version: "1.0",
  publication: "2026-07-14T22:00:03Z",
  services: [
    [["com", "net"], ["https://rdap.verisign.com/com/v1/"]], // multi-tld
    [["au"], ["https://rdap.cctld.au/rdap/"]], // .au (the #772-relevant one)
    [["hamburg"], ["https://rdap.nic.hamburg/v1"]], // NO trailing slash
    [["insecure"], ["http://rdap.example/", "https://rdap.example/"]], // https preferred
    [["empty"], []], // no URLs → skipped
  ],
} as const;

describe("parseBootstrap", () => {
  it("expands multi-tld entries and lowercases keys", () => {
    const m = parseBootstrap(BOOTSTRAP)!;
    expect(m.get("com")).toBe("https://rdap.verisign.com/com/v1/");
    expect(m.get("net")).toBe("https://rdap.verisign.com/com/v1/");
    expect(m.get("au")).toBe("https://rdap.cctld.au/rdap/");
  });

  it("normalises a base URL to exactly one trailing slash", () => {
    const m = parseBootstrap(BOOTSTRAP)!;
    expect(m.get("hamburg")).toBe("https://rdap.nic.hamburg/v1/");
  });

  it("prefers an https base over http", () => {
    const m = parseBootstrap(BOOTSTRAP)!;
    expect(m.get("insecure")).toBe("https://rdap.example/");
  });

  it("skips entries with no URLs", () => {
    const m = parseBootstrap(BOOTSTRAP)!;
    expect(m.has("empty")).toBe(false);
  });

  it("returns null for an invalid shape", () => {
    expect(parseBootstrap(null)).toBeNull();
    expect(parseBootstrap({})).toBeNull();
    expect(parseBootstrap({ services: "nope" })).toBeNull();
    expect(parseBootstrap({ services: [] })).toBeNull(); // no keys → null
  });
});

describe("resolveRegistryBase", () => {
  const m = parseBootstrap(BOOTSTRAP)!;

  it("resolves a domain's TLD to the registry base", () => {
    expect(resolveRegistryBase("nimblepayday.com", m)).toBe(
      "https://rdap.verisign.com/com/v1/",
    );
    expect(resolveRegistryBase("telstra.com.au", m)).toBe(
      "https://rdap.cctld.au/rdap/",
    );
  });

  it("returns null for a TLD with no RDAP server (the real .ru case)", () => {
    expect(resolveRegistryBase("cartales.ru", m)).toBeNull();
  });

  it("returns null when there is no TLD label", () => {
    expect(resolveRegistryBase("localhost", m)).toBeNull();
    expect(resolveRegistryBase("", m)).toBeNull();
  });
});

describe("buildRegistryDomainUrl", () => {
  it("builds {base}domain/{name} with a trailing-slash base", () => {
    expect(
      buildRegistryDomainUrl("https://rdap.verisign.com/com/v1/", "x.com"),
    ).toBe("https://rdap.verisign.com/com/v1/domain/x.com");
  });

  it("tolerates a base without a trailing slash", () => {
    expect(buildRegistryDomainUrl("https://rdap.nic.hamburg/v1", "y.hamburg")).toBe(
      "https://rdap.nic.hamburg/v1/domain/y.hamburg",
    );
  });

  it("encodes the domain", () => {
    expect(buildRegistryDomainUrl("https://r/", "a b.com")).toBe(
      "https://r/domain/a%20b.com",
    );
  });
});
