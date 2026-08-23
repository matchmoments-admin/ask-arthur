// AU jurisdiction pack — the ABN chain's four states and their epistemics.
// Real extractAbnCandidates + isValidAbnChecksum run unmocked; only the
// network (ABR) and telemetry seams are mocked. The load-bearing assertions
// are the ADR-0009 ones: lookup-failed is unverified (no finding), and only
// checksum-fail / register-answered-not-found ever accuse.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { isValidAbnChecksum } from "../abn-checksum";

const abrState = vi.hoisted(() => ({
  mode: "registered" as "registered" | "cancelled" | "not-found" | "lookup-failed",
  cached: false,
  calls: [] as string[],
}));
const brakeState = vi.hoisted(() => ({ braked: false }));
const costState = vi.hoisted(() => ({ calls: 0 }));

vi.mock("../abr-lookup", () => ({
  lookupABN: vi.fn(async (abn: string) => {
    abrState.calls.push(abn);
    if (abrState.mode === "registered" || abrState.mode === "cancelled") {
      return {
        abn,
        entityName: "EXAMPLE PTY LTD",
        entityType: "PRV",
        status: abrState.mode === "cancelled" ? "Cancelled" : "Active",
        ...(abrState.cached ? { cached: true } : {}),
      };
    }
    return { ok: false, reason: abrState.mode };
  }),
}));
vi.mock("../cost-log", () => ({
  isFeatureBraked: vi.fn(async () => brakeState.braked),
  logCost: vi.fn(async () => {
    costState.calls++;
  }),
}));

import { runAuPack } from "../document-check/packs/au";

/** Deterministically generate distinct VALID ABNs (real checksum). */
function validAbns(n: number): string[] {
  const out: string[] = [];
  for (let base = 10_000_000_000; out.length < n; base += 1) {
    const s = String(base);
    if (s.length === 11 && isValidAbnChecksum(s)) out.push(s);
  }
  return out;
}
const INVALID_ABN = "11111111111"; // fails the mod-89 checksum

beforeEach(() => {
  abrState.mode = "registered";
  abrState.cached = false;
  abrState.calls.length = 0;
  brakeState.braked = false;
  costState.calls = 0;
});

describe("runAuPack", () => {
  it("null text (extraction unavailable) → textExtracted:false, zero findings", async () => {
    const r = await runAuPack(null);
    expect(r.content.textExtracted).toBe(false);
    expect(r.content.checks).toEqual([]);
    expect(r.findings).toEqual([]);
    expect(abrState.calls).toEqual([]);
  });

  it("checksum-fail ABN → finding, and NO ABR call is wasted on it", async () => {
    const r = await runAuPack(`Invoice from Acme. ABN: ${INVALID_ABN}. Pay now.`);
    expect(r.content.checks).toEqual([
      { kind: "abn", identifier: INVALID_ABN, status: "invalid_checksum", entityName: null },
    ]);
    expect(r.findings.map((f) => f.signal)).toEqual(["abn_checksum_fail"]);
    expect(abrState.calls).toEqual([]);
  });

  it("registered ABN → entity name, no finding", async () => {
    const [abn] = validAbns(1);
    const r = await runAuPack(`ABN ${abn}`);
    expect(r.content.checks).toEqual([
      { kind: "abn", identifier: abn, status: "registered", entityName: "EXAMPLE PTY LTD" },
    ]);
    expect(r.findings).toEqual([]);
  });

  it("register-answered-not-found → abn_not_registered finding", async () => {
    abrState.mode = "not-found";
    const [abn] = validAbns(1);
    const r = await runAuPack(`ABN ${abn}`);
    expect(r.content.checks[0]!.status).toBe("not_registered");
    expect(r.findings.map((f) => f.signal)).toEqual(["abn_not_registered"]);
  });

  it("lookup-failed → unverified, NO finding (ADR-0009: could-not-check ≠ fake)", async () => {
    abrState.mode = "lookup-failed";
    const [abn] = validAbns(1);
    const r = await runAuPack(`ABN ${abn}`);
    expect(r.content.checks[0]!.status).toBe("unverified");
    expect(r.findings).toEqual([]);
  });

  it("braked → checksum still runs, ABR skipped, survivors unverified", async () => {
    brakeState.braked = true;
    const [abn] = validAbns(1);
    const r = await runAuPack(`ABN ${abn} and ABN ${INVALID_ABN}`);
    expect(abrState.calls).toEqual([]);
    expect(r.content.checks).toContainEqual({ kind: "abn", identifier: abn, status: "unverified", entityName: null });
    expect(r.findings.map((f) => f.signal)).toEqual(["abn_checksum_fail"]);
  });

  it("a BARE 11-digit junk number (phone/account) is neither accused nor listed", async () => {
    // 11 digits, no "ABN" label, fails checksum — matching it would amber-
    // flag ordinary invoices (review finding, PR #1030).
    const r = await runAuPack("Payment reference 61412345678 due 30 days.");
    expect(r.findings).toEqual([]);
    expect(r.content.checks).toEqual([]);
    expect(abrState.calls).toEqual([]);
  });

  it("a real-but-cancelled ABN → status cancelled + abn_cancelled finding, never 'registered'", async () => {
    abrState.mode = "cancelled";
    const [abn] = validAbns(1);
    const r = await runAuPack(`ABN ${abn}`);
    expect(r.content.checks).toEqual([
      { kind: "abn", identifier: abn, status: "cancelled", entityName: "EXAMPLE PTY LTD" },
    ]);
    expect(r.findings.map((f) => f.signal)).toEqual(["abn_cancelled"]);
  });

  it("cache-served lookups do NOT log a cost row (the cost-log contract)", async () => {
    abrState.cached = true;
    const [abn] = validAbns(1);
    await runAuPack(`ABN ${abn}`);
    expect(costState.calls).toBe(0);
    abrState.cached = false;
    const [, abn2] = validAbns(2);
    await runAuPack(`ABN ${abn2}`);
    expect(costState.calls).toBe(1);
  });

  it("checksum junk cannot crowd a genuine candidate out of the lookup slots", async () => {
    const [real] = validAbns(1);
    // Six labelled checksum-fail numbers ahead of the one real ABN.
    const junk = Array.from({ length: 6 }, (_, i) => `ABN 1111111111${i}`).join("\n");
    const r = await runAuPack(`${junk}\nABN ${real}`);
    expect(abrState.calls).toEqual([real]);
    expect(r.content.checks).toContainEqual({
      kind: "abn",
      identifier: real,
      status: "registered",
      entityName: "EXAMPLE PTY LTD",
    });
  });

  it("caps ABR lookups at 5 per document", async () => {
    const abns = validAbns(8);
    const text = abns.map((a) => `ABN ${a}`).join("\n");
    const r = await runAuPack(text);
    expect(r.content.checks.length).toBeLessThanOrEqual(5);
    expect(abrState.calls.length).toBeLessThanOrEqual(5);
  });
});
