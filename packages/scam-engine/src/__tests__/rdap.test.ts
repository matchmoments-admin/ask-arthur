import { describe, expect, it } from "vitest";
import { parseRdapResponse } from "../rdap";

// A trimmed but realistic RDAP domain response (RFC 9083 / jCard vcards).
const GTLD_RESPONSE = {
  objectClassName: "domain",
  ldhName: "nab-login.shop",
  status: ["client transfer prohibited", "client hold"],
  events: [
    { eventAction: "registration", eventDate: "2026-06-01T00:00:00Z" },
    { eventAction: "expiration", eventDate: "2027-06-01T00:00:00Z" },
  ],
  nameservers: [{ ldhName: "NS1.EVIL.COM" }, { ldhName: "NS2.EVIL.COM" }],
  entities: [
    {
      roles: ["registrar"],
      publicIds: [{ type: "IANA Registrar ID", identifier: "1068" }],
      vcardArray: ["vcard", [["fn", {}, "text", "NameCheap, Inc."]]],
      entities: [
        {
          roles: ["abuse"],
          vcardArray: [
            "vcard",
            [
              ["fn", {}, "text", "Abuse Dept"],
              ["email", {}, "text", "abuse@namecheap.com"],
              ["tel", {}, "text", "+1.6613102107"],
            ],
          ],
        },
      ],
    },
    {
      roles: ["registrant"],
      vcardArray: [
        "vcard",
        [["country-name", {}, "text", "Russia"]],
      ],
    },
  ],
};

describe("parseRdapResponse", () => {
  it("extracts registrar, IANA id, abuse contact, statuses, dates, nameservers", () => {
    const r = parseRdapResponse(GTLD_RESPONSE, "nab-login.shop");
    expect(r.registrar).toBe("NameCheap, Inc.");
    expect(r.registrarIanaId).toBe("1068");
    expect(r.abuseContact).toEqual({
      email: "abuse@namecheap.com",
      phone: "+1.6613102107",
    });
    expect(r.statuses).toEqual(["client transfer prohibited", "client hold"]);
    expect(r.createdDate).toBe("2026-06-01");
    expect(r.expiresDate).toBe("2027-06-01");
    expect(r.nameServers).toEqual(["ns1.evil.com", "ns2.evil.com"]);
    expect(r.registrantCountry).toBe("Russia");
    expect(r.source).toBe("rdap");
  });

  it("flags clientHold via the statuses array (registrar-suspended signal)", () => {
    const r = parseRdapResponse(GTLD_RESPONSE, "nab-login.shop");
    expect(r.statuses.some((s) => s.replace(/\s+/g, "").toLowerCase() === "clienthold")).toBe(true);
  });

  it("degrades gracefully on a sparse/redacted response", () => {
    const r = parseRdapResponse(
      {
        objectClassName: "domain",
        status: [],
        entities: [
          {
            roles: ["registrant"],
            vcardArray: ["vcard", [["fn", {}, "text", "REDACTED FOR PRIVACY"]]],
          },
        ],
      },
      "x.shop",
    );
    expect(r.registrar).toBeNull();
    expect(r.registrarIanaId).toBeNull();
    expect(r.abuseContact).toBeNull();
    expect(r.createdDate).toBeNull();
    expect(r.nameServers).toEqual([]);
    expect(r.isPrivate).toBe(true);
  });
});
