import { describe, expect, it } from "vitest";
import { parseAuEligibility } from "../rdap-au";

// Real shape from auDA RDAP (via rdap.org) for a .com.au domain.
const TELSTRA_ELIGIBILITY = [
  { name: "registrant name", value: "Telstra Corporation Ltd" },
  { name: "registrant id", value: "ABN 33051775556" },
  { name: "eligibility type", value: "Company" },
  { name: "eligibility id", value: "ABN 33051775556" },
];

describe("parseAuEligibility", () => {
  it("extracts registrant name, checksum-valid ABN, and entity type", () => {
    const r = parseAuEligibility(TELSTRA_ELIGIBILITY);
    expect(r).not.toBeNull();
    expect(r!.registrantName).toBe("Telstra Corporation Ltd");
    expect(r!.abn).toBe("33051775556");
    expect(r!.entityType).toBe("Company");
  });

  it("rejects an ABN that fails the checksum (never propagates a bad id)", () => {
    const r = parseAuEligibility([
      { name: "registrant name", value: "Sketchy Pty Ltd" },
      { name: "registrant id", value: "ABN 12345678901" }, // invalid checksum
    ]);
    expect(r!.registrantName).toBe("Sketchy Pty Ltd");
    expect(r!.abn).toBeNull();
  });

  it("returns null when auDA disclosed nothing", () => {
    expect(parseAuEligibility(undefined)).toBeNull();
    expect(parseAuEligibility([])).toBeNull();
  });
});
