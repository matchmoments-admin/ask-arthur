import { describe, expect, it } from "vitest";
import { buildAuRegistrantBlock } from "@/lib/clone-watch/au-registrant";

const AT = new Date("2026-07-17T00:00:00.000Z");
const RAW = {
  registrantName: "Telstra Corporation Ltd",
  abn: "33051775556",
  entityType: "Company",
};

const ABR_ACTIVE = {
  abn: "33051775556",
  entityName: "TELSTRA CORPORATION LIMITED",
  entityType: "Australian Public Company",
  status: "Active",
  state: "VIC",
  postcode: "3000",
  businessNames: ["Telstra"],
  isAcncRegistered: false,
  dgrEndorsed: false,
  dgrItemNumber: null,
  dgrEffectiveFrom: null,
  dgrEffectiveTo: null,
  taxConcessionCharity: false,
};

describe("buildAuRegistrantBlock", () => {
  it("active ABN + matching name → active, nameMatchesAbn true", () => {
    const b = buildAuRegistrantBlock(RAW, ABR_ACTIVE, AT)!;
    expect(b.abnStatus).toBe("active");
    expect(b.legalName).toBe("Telstra Corporation Ltd");
    expect(b.nameMatchesAbn).toBe(true);
    expect(b.entityName).toBe("TELSTRA CORPORATION LIMITED");
  });

  it("cancelled ABR status → cancelled", () => {
    const b = buildAuRegistrantBlock(RAW, { ...ABR_ACTIVE, status: "Cancelled" }, AT)!;
    expect(b.abnStatus).toBe("cancelled");
  });

  it("ABR not-found → not-found (never confused with cancelled)", () => {
    const b = buildAuRegistrantBlock(RAW, { ok: false, reason: "not-found" }, AT)!;
    expect(b.abnStatus).toBe("not-found");
  });

  it("ABR lookup-failed is NOT treated as cancelled/not-found (ADR-0009)", () => {
    const b = buildAuRegistrantBlock(RAW, { ok: false, reason: "lookup-failed" }, AT)!;
    expect(b.abnStatus).toBe("lookup-failed");
  });

  it("name mismatch (borrowed ABN) → nameMatchesAbn false", () => {
    const b = buildAuRegistrantBlock(
      { ...RAW, registrantName: "Totally Different Holdings" },
      ABR_ACTIVE,
      AT,
    )!;
    expect(b.nameMatchesAbn).toBe(false);
  });

  it("PII guard: no ABN → legalName dropped, status no-abn", () => {
    const b = buildAuRegistrantBlock(
      { registrantName: "Jane Citizen", abn: null, entityType: null },
      null,
      AT,
    )!;
    expect(b.legalName).toBeNull();
    expect(b.abnStatus).toBe("no-abn");
  });

  it("PII guard: sole trader with an ABN → legalName still dropped (ABR entity type)", () => {
    const b = buildAuRegistrantBlock(
      { registrantName: "John Smith", abn: "51824753556", entityType: "Registered Business" },
      { ...ABR_ACTIVE, abn: "51824753556", entityType: "Individual/Sole Trader", entityName: "SMITH, JOHN" },
      AT,
    )!;
    expect(b.legalName).toBeNull(); // personal name never stored
    expect(b.abn).toBe("51824753556"); // non-PII fields retained
    expect(b.abnStatus).toBe("active");
  });

  it("PII guard: sole trader flagged by auDA eligibility type → legalName dropped", () => {
    const b = buildAuRegistrantBlock(
      { registrantName: "John Smith", abn: "51824753556", entityType: "Sole Trader" },
      { ...ABR_ACTIVE, abn: "51824753556", entityType: "Australian Private Company", entityName: "SMITH, JOHN" },
      AT,
    )!;
    expect(b.legalName).toBeNull();
  });

  it("no .au data → null block", () => {
    expect(buildAuRegistrantBlock(null, null, AT)).toBeNull();
  });
});
