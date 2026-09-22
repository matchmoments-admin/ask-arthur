import { describe, expect, it } from "vitest";

import { squatStatus } from "@/lib/clone-watch/clone-metrics";

/**
 * squatStatus — the infrastructure view of a lookalike (held / parked / live),
 * derived only from what enrichment + urlscan already store. Fixture values are
 * the real shapes in prod (2026-09-22): RDAP statuses are lowercase-spaced
 * ("client hold"), nameservers sometimes carry a trailing dot.
 */
describe("squatStatus", () => {
  it("held wins over everything — the registry already suspended it", () => {
    expect(
      squatStatus({
        attribution: {
          whois: { statuses: ["client transfer prohibited", "client hold"], nameServers: ["ns1.afternic.com"] },
        },
        urlscan_evidence: { server: { ip: "1.2.3.4" } },
      }),
    ).toBe("held");
    expect(squatStatus({ attribution: { whois: { statuses: ["serverHold"] } } })).toBe("held");
  });

  it("parked on a parking/aftermarket nameserver (trailing dot tolerated)", () => {
    expect(
      squatStatus({ attribution: { whois: { nameServers: ["NS1.AFTERNIC.COM."] } } }),
    ).toBe("parked");
    expect(
      squatStatus({ attribution: { whois: { nameServers: ["ns1.dns-parking.com"] } } }),
    ).toBe("parked");
  });

  it("parked when urlscan landed on a for-sale page", () => {
    expect(squatStatus({ urlscan_classification: "parked_for_sale" })).toBe("parked");
  });

  it("does not treat a lookalike NS host as the parking root", () => {
    expect(
      squatStatus({
        attribution: { whois: { nameServers: ["ns1.evilafternic.com"] } },
      }),
    ).toBe("unknown");
  });

  it("live when urlscan saw a server; unknown with no evidence", () => {
    expect(
      squatStatus({
        attribution: { whois: { nameServers: ["amy.ns.cloudflare.com"] } },
        urlscan_evidence: { server: { ip: "104.21.34.215" } },
      }),
    ).toBe("live");
    expect(squatStatus({ attribution: null, urlscan_evidence: null })).toBe("unknown");
  });
});
