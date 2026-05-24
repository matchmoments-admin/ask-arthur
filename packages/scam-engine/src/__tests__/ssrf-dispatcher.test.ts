import { describe, expect, it } from "vitest";
import type { LookupFunction } from "node:net";

import { buildSsrfLookup, isPrivateIP } from "../ssrf-dispatcher";

/** Run a `LookupFunction` and collect its callback result as a Promise. */
function runLookup(
  lookup: LookupFunction,
  hostname: string,
): Promise<{
  err: NodeJS.ErrnoException | null;
  address: string | unknown;
  family: number | undefined;
}> {
  return new Promise((resolve) => {
    lookup(hostname, { all: false }, (err, address, family) => {
      resolve({ err, address, family });
    });
  });
}

describe("isPrivateIP", () => {
  it.each([
    ["127.0.0.1"], //         IPv4 loopback
    ["127.255.255.255"], //   IPv4 loopback range edge
    ["10.0.0.1"], //          RFC1918 class A
    ["10.255.255.255"], //    RFC1918 class A edge
    ["172.16.0.1"], //        RFC1918 class B start
    ["172.31.255.255"], //    RFC1918 class B end
    ["192.168.1.1"], //       RFC1918 class C
    ["169.254.169.254"], //   AWS / GCP instance metadata
    ["169.254.0.1"], //       link-local
    ["0.0.0.0"], //           current network
    ["100.64.0.1"], //        CGNAT start
    ["100.127.255.255"], //   CGNAT end
    ["198.18.0.1"], //        benchmarking
    ["::1"], //               IPv6 loopback
    ["fe80::1"], //           IPv6 link-local
    ["fc00::1"], //           IPv6 unique local (fc range)
    ["fd00::1"], //           IPv6 unique local (fd range)
  ])("returns true for private IP %s", (ip) => {
    expect(isPrivateIP(ip)).toBe(true);
  });

  it.each([
    ["8.8.8.8"], //                  Google DNS
    ["1.1.1.1"], //                  Cloudflare DNS
    ["172.15.0.1"], //               just BELOW RFC1918 class B start (172.16/12)
    ["172.32.0.1"], //               just ABOVE RFC1918 class B end
    ["100.63.255.255"], //           just BELOW CGNAT start
    ["100.128.0.1"], //              just ABOVE CGNAT end
    ["198.17.255.255"], //           just BELOW benchmarking range
    ["198.20.0.1"], //               just ABOVE benchmarking range
    ["2001:4860:4860::8888"], //     Google IPv6 DNS
    ["2606:4700:4700::1111"], //     Cloudflare IPv6 DNS
  ])("returns false for public IP %s", (ip) => {
    expect(isPrivateIP(ip)).toBe(false);
  });
});

describe("buildSsrfLookup", () => {
  it("rejects a hostname that resolves to an IPv4 loopback (the rebinding case)", async () => {
    // A hostname like "rebind.example.com" with an A record pointing at
    // 127.0.0.1 passes the syntactic `isPrivateURL` check but resolves
    // to a private IP. This is the attack the dispatcher closes.
    const fakeLookup: LookupFunction = (_hostname, _options, callback) => {
      callback(null, "127.0.0.1", 4);
    };
    const lookup = buildSsrfLookup(fakeLookup);

    const result = await runLookup(lookup, "rebind.example.com");

    expect(result.err).not.toBeNull();
    expect(result.err?.code).toBe("EPRIVATEHOST");
    expect(result.err?.message).toContain("rebind.example.com");
    expect(result.err?.message).toContain("127.0.0.1");
  });

  it("rejects a hostname that resolves to AWS instance metadata", async () => {
    const fakeLookup: LookupFunction = (_hostname, _options, callback) => {
      callback(null, "169.254.169.254", 4);
    };
    const lookup = buildSsrfLookup(fakeLookup);

    const result = await runLookup(lookup, "metadata-cloak.example.com");

    expect(result.err?.code).toBe("EPRIVATEHOST");
  });

  it("rejects a hostname that resolves to IPv6 loopback", async () => {
    const fakeLookup: LookupFunction = (_hostname, _options, callback) => {
      callback(null, "::1", 6);
    };
    const lookup = buildSsrfLookup(fakeLookup);

    const result = await runLookup(lookup, "ipv6-rebind.example.com");

    expect(result.err?.code).toBe("EPRIVATEHOST");
  });

  it("forwards the resolved IP unchanged when public", async () => {
    const fakeLookup: LookupFunction = (_hostname, _options, callback) => {
      callback(null, "8.8.8.8", 4);
    };
    const lookup = buildSsrfLookup(fakeLookup);

    const result = await runLookup(lookup, "dns.google");

    expect(result.err).toBeNull();
    expect(result.address).toBe("8.8.8.8");
    expect(result.family).toBe(4);
  });

  it("propagates a dns.lookup ENOTFOUND error unchanged", async () => {
    const dnsErr: NodeJS.ErrnoException = new Error("getaddrinfo ENOTFOUND");
    dnsErr.code = "ENOTFOUND";
    const fakeLookup: LookupFunction = (_hostname, _options, callback) => {
      callback(dnsErr, "", 0);
    };
    const lookup = buildSsrfLookup(fakeLookup);

    const result = await runLookup(lookup, "does-not-exist.example.com");

    expect(result.err?.code).toBe("ENOTFOUND");
    // Critically: an upstream DNS error is NOT re-coded as EPRIVATEHOST —
    // a NOTFOUND must surface to the caller as NOTFOUND so retry / error
    // taxonomies stay correct.
  });

  it("rejects when dns.lookup returns an empty address", async () => {
    // Pathological case — should never happen in real DNS, but defensive.
    const fakeLookup: LookupFunction = (_hostname, _options, callback) => {
      callback(null, "", 0);
    };
    const lookup = buildSsrfLookup(fakeLookup);

    const result = await runLookup(lookup, "blank.example.com");

    expect(result.err?.code).toBe("EPRIVATEHOST");
  });
});
