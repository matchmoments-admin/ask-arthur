// The Brand Send Gate (lib/clone-watch/brand-send-gate.ts) — ONE conjunction
// for every Clone Watch brand send (PR-C, 2026-09-28).
//
// Proves, per profile, that each check the profile names refuses with its own
// code when it fails, that every read error refuses (fail closed), that the
// profile table closes the three copy gaps, and that the outreach override
// lets a not-ready send through only with a warn AND a durable record.
//
// The per-check refusal cases are GENERATED from each profile's check list, so
// deleting a check from a profile removes its cases rather than failing them —
// the explicit "three copy gaps are closed" test and the route-level tests
// (readinessSendGate / readinessAutoSendGate) are what go red.
//
// Go-red record (2026-09-28, mutation applied → tests failed → restored; run
// across this file + brandSendGateScan + brandOutreach + readinessSendGate +
// readinessAutoSendGate):
//   - "brake" removed from stewardship-real
//        → "the three copy gaps are closed" + "stewardship refuses on an
//          engaged brake" FAILED (2)
//   - "unsubscribe" removed from batch
//        → gaps test + "a non-boolean STOP answer is not an answer" + "batch
//          refuses an unsubscribed recipient" FAILED (3)
//   - "directory" removed from auto-send
//        → gaps test + "a directory mismatch keeps the batch for manual
//          approval" FAILED (2)
//   - `typeof stop !== "boolean"` guard deleted (a null answer read as "not
//     suppressed") → "a non-boolean STOP answer is not an answer" FAILED
//   - settle(): `recorded = true` instead of awaiting recordOverride
//        → both override-record tests here and both in brandOutreach FAILED (4)
//   - settle(): `if (!target)` preflight guard deleted
//        → "preflight never lets an override through" FAILED
// PR-C review additions (2026-09-28):
//   - "legal_signoff" removed from batch → gaps test + "batch refuses without
//     the #371 sign-off" FAILED (2); from auto-send → gaps test + "no #371
//     sign-off … keeps the batch for manual approval" FAILED (2)
//   - "unsubscribe" removed from outreach → gaps test + "the override never
//     lets an opt-out through" + three brandOutreach opt-out tests FAILED (5)

import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  flags: {
    brandStewardshipSend: true,
    shopfrontCloneOutreach: true,
    shopfrontCloneNotifyBrand: true,
    shopfrontCloneNotifyBrandAutoSend: true,
  } as Record<string, boolean>,
  readiness: { ready: true, months: ["2026-09-01", "2026-08-01"] } as Record<string, unknown>,
  braked: false as boolean | "throw",
  override: false,
  brakeReads: 0,
  warn: vi.fn(),
}));

vi.mock("@askarthur/utils/feature-flags", () => ({ featureFlags: m.flags }));
vi.mock("@askarthur/utils/env", () => ({
  readBoolEnv: (n: string) => (n === "BRAND_OUTREACH_READINESS_OVERRIDE" ? m.override : false),
  readStringEnv: () => null,
}));
vi.mock("@askarthur/utils/logger", () => ({
  logger: { info: vi.fn(), warn: m.warn, error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@askarthur/scam-engine/cost-log", () => ({
  isFeatureBrakedOrUnknown: async () => {
    m.brakeReads++;
    if (m.braked === "throw") throw new Error("brake read threw");
    return m.braked;
  },
}));
vi.mock("@/lib/clone-watch/readiness-data", () => ({
  readReadinessGate: async () => m.readiness,
}));

import {
  BRAND_SEND_PROFILES,
  checkBrandSend,
  createBrandSendGate,
  refusalStatus,
  type BrandSendProfile,
} from "@/lib/clone-watch/brand-send-gate";

// ── Fake service client ──
type Res = { data: unknown; error: unknown };
let tables: Record<string, Res>;
let suppressed: Res;
let costInsert: Res;
const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
function builder(table: string) {
  const b: Record<string, unknown> = {};
  for (const k of ["select", "eq", "in", "limit"]) b[k] = () => b;
  b.maybeSingle = async () => tables[table] ?? { data: null, error: null };
  b.then = (ok: (v: Res) => unknown, bad: (e: unknown) => unknown) =>
    Promise.resolve(tables[table] ?? { data: null, error: null }).then(ok, bad);
  b.insert = async (row: Record<string, unknown>) => {
    inserts.push({ table, row });
    return costInsert;
  };
  return b;
}
const sb = {
  from: (t: string) => builder(t),
  rpc: async () => suppressed,
} as unknown as Parameters<typeof checkBrandSend>[1];

const RECIPIENT = "security@auspost.com.au";
const TARGET = { recipient: RECIPIENT, brand: "auspost.com.au", brandKey: "auspost.com.au" };

beforeEach(() => {
  for (const k of Object.keys(m.flags)) m.flags[k] = true;
  m.readiness = { ready: true, months: ["2026-09-01", "2026-08-01"] };
  m.braked = false;
  m.override = false;
  m.warn.mockClear();
  inserts.length = 0;
  costInsert = { data: null, error: null };
  suppressed = { data: false, error: null };
  tables = {
    brand_report_unsubscribes: { data: null, error: null },
    known_brands: { data: { last_verified_at: "2026-09-01T00:00:00Z" }, error: null },
    brand_contact_directory: {
      data: [{ recipient: RECIPIENT, channel_type: "security_txt" }],
      error: null,
    },
  };
});

// ── One failure per check, and its expected code ──
const FAILURES: Record<string, Array<{ name: string; arrange: () => void; code: string }>> = {
  flags: [
    { name: "outreach flag OFF", arrange: () => (m.flags.shopfrontCloneOutreach = false), code: "clone_outreach_disabled" },
  ],
  legal_signoff: [
    { name: "FF_BRAND_STEWARDSHIP_SEND OFF", arrange: () => (m.flags.brandStewardshipSend = false), code: "send_disabled" },
  ],
  readiness: [
    { name: "not ready", arrange: () => (m.readiness = { ready: false, months: ["2026-09-01"], reason: "not_ready:2026-09-01" }), code: "not_ready" },
  ],
  brake: [
    { name: "engaged", arrange: () => (m.braked = true), code: "cost_brake_engaged" },
    { name: "read threw", arrange: () => (m.braked = "throw"), code: "gate_error" },
  ],
  unsubscribe: [
    { name: "unsubscribed", arrange: () => (tables.brand_report_unsubscribes = { data: { email: RECIPIENT }, error: null }), code: "recipient_unsubscribed" },
    { name: "STOP reply", arrange: () => (suppressed = { data: true, error: null }), code: "recipient_suppressed" },
    { name: "unsubscribe read error", arrange: () => (tables.brand_report_unsubscribes = { data: null, error: { message: "down" } }), code: "unsubscribe_unreadable" },
    { name: "STOP read error", arrange: () => (suppressed = { data: null, error: { message: "down" } }), code: "unsubscribe_unreadable" },
  ],
  verified_contact: [
    { name: "unverified", arrange: () => (tables.known_brands = { data: { last_verified_at: null }, error: null }), code: "contact_unverified" },
    { name: "read error", arrange: () => (tables.known_brands = { data: null, error: { message: "down" } }), code: "contact_unreadable" },
  ],
  directory: [
    { name: "row missing", arrange: () => (tables.brand_contact_directory = { data: [], error: null }), code: "directory_row_missing" },
    { name: "recipient mismatch", arrange: () => (tables.brand_contact_directory = { data: [{ recipient: "other@x.au", channel_type: "security_txt" }], error: null }), code: "recipient_mismatch" },
    { name: "unaccepted channel", arrange: () => (tables.brand_contact_directory = { data: [{ recipient: RECIPIENT, channel_type: "web_form" }], error: null }), code: "recipient_mismatch" },
    { name: "read error", arrange: () => (tables.brand_contact_directory = { data: null, error: { message: "down" } }), code: "directory_lookup_failed" },
  ],
};

const PROFILES = Object.keys(BRAND_SEND_PROFILES) as BrandSendProfile[];

describe("every profile passes when every check passes", () => {
  for (const p of PROFILES) {
    it(`${p}: allowed`, async () => {
      const d = await checkBrandSend(p, sb, TARGET);
      expect(d).toEqual({ allowed: true, reasons: [] });
    });
  }
});

describe("each profile refuses with the right code for each failing check", () => {
  for (const p of PROFILES) {
    for (const check of BRAND_SEND_PROFILES[p].checks) {
      for (const f of FAILURES[check] ?? []) {
        it(`${p} refuses when ${check} fails (${f.name}) → ${f.code}`, async () => {
          f.arrange();
          const d = await checkBrandSend(p, sb, TARGET);
          expect(d.allowed).toBe(false);
          expect(d.reasons.map((r) => r.code)).toContain(f.code);
          expect(refusalStatus(d.reasons[0])).toBeGreaterThanOrEqual(400);
        });
      }
    }
  }
});

describe("a check a profile does not name never refuses it", () => {
  it("outreach ignores the #371 flag, brake, contact and directory", async () => {
    m.flags.brandStewardshipSend = false;
    m.braked = true;
    tables.known_brands = { data: null, error: null };
    tables.brand_contact_directory = { data: [], error: null };
    expect((await checkBrandSend("outreach", sb, TARGET)).allowed).toBe(true);
  });
});

describe("the three copy gaps are closed", () => {
  it("stewardship has the brake, batch has unsubscribe, auto-send has the directory", () => {
    expect(BRAND_SEND_PROFILES["stewardship-real"].checks).toContain("brake");
    expect(BRAND_SEND_PROFILES.batch.checks).toContain("unsubscribe");
    expect(BRAND_SEND_PROFILES["auto-send"].checks).toContain("directory");
    // PR-C review: real brand contact of any kind needs the #371 sign-off,
    // and outreach honours opt-outs.
    expect(BRAND_SEND_PROFILES.batch.checks).toContain("legal_signoff");
    expect(BRAND_SEND_PROFILES["auto-send"].checks).toContain("legal_signoff");
    expect(BRAND_SEND_PROFILES.outreach.checks).toContain("unsubscribe");
    // …and auto-send is at least as strict as a human-approved batch.
    for (const c of BRAND_SEND_PROFILES.batch.checks) {
      expect(BRAND_SEND_PROFILES["auto-send"].checks).toContain(c);
    }
  });
});

describe("fail closed", () => {
  it("a non-boolean STOP answer is not an answer", async () => {
    suppressed = { data: null, error: null };
    const d = await checkBrandSend("batch", sb, TARGET);
    expect(d.reasons[0].code).toBe("unsubscribe_unreadable");
  });

  it("no service client refuses every recipient check", async () => {
    const d = await checkBrandSend("stewardship-real", null, TARGET);
    expect(d.allowed).toBe(false);
    expect(d.reasons.map((r) => r.code)).toEqual(
      expect.arrayContaining(["unsubscribe_unreadable", "contact_unreadable"]),
    );
  });

  it("a missing recipient refuses as no_recipient", async () => {
    const d = await checkBrandSend("stewardship-real", sb, { recipient: "  " });
    expect(d.reasons.map((r) => r.code)).toEqual(["no_recipient"]);
    expect(refusalStatus(d.reasons[0])).toBe(422);
  });
});

describe("preflight and memoisation", () => {
  it("preflight runs only send-scoped checks", async () => {
    tables.brand_contact_directory = { data: [], error: null };
    const gate = createBrandSendGate("batch", sb);
    expect((await gate.preflight()).allowed).toBe(true);
    expect((await gate.check(TARGET)).reasons[0].code).toBe("directory_row_missing");
  });

  it("reads readiness and the brake once per gate, however many recipients", async () => {
    m.brakeReads = 0;
    const gate = createBrandSendGate("auto-send", sb);
    await gate.check(TARGET);
    await gate.check(TARGET);
    await gate.check(TARGET);
    expect(m.brakeReads).toBe(1);
  });
});

describe("outreach readiness override", () => {
  beforeEach(() => {
    m.readiness = { ready: false, months: ["2026-09-01", "2026-08-01"], reason: "not_computed:2026-08-01" };
  });

  it("without the override a not-ready outreach send is refused", async () => {
    const d = await checkBrandSend("outreach", sb, TARGET);
    expect(d.allowed).toBe(false);
    expect(d.reasons[0].code).toBe("not_ready");
    expect(inserts).toHaveLength(0);
  });

  it("with the override it is allowed, warned always-ship and recorded", async () => {
    m.override = true;
    const d = await checkBrandSend("outreach", sb, { ...TARGET, context: { brand: "Australia Post" } });
    expect(d.allowed).toBe(true);
    expect(d.overridden?.[0].code).toBe("not_ready");
    expect(m.warn).toHaveBeenCalledWith(
      "brand_send_gate_override",
      expect.objectContaining({ profile: "outreach", brand: "Australia Post" }),
    );
    expect(inserts).toEqual([
      expect.objectContaining({
        table: "cost_telemetry",
        row: expect.objectContaining({
          feature: "brand_outreach",
          provider: "internal",
          operation: "readiness_override",
          estimated_cost_usd: 0,
        }),
      }),
    ]);
    // No address in the record — a hash only.
    expect(JSON.stringify(inserts[0].row)).not.toContain(RECIPIENT);
  });

  it("override is NOT honoured when its record cannot be written", async () => {
    m.override = true;
    costInsert = { data: null, error: { message: "insert failed" } };
    const d = await checkBrandSend("outreach", sb, TARGET);
    expect(d.allowed).toBe(false);
    expect(d.reasons[0].code).toBe("override_unrecorded");
  });

  it("preflight never lets an override through", async () => {
    m.override = true;
    const d = await createBrandSendGate("outreach", sb).preflight();
    expect(d.allowed).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it("the override never lets an opt-out through", async () => {
    m.override = true;
    tables.brand_report_unsubscribes = { data: { email: RECIPIENT }, error: null };
    const d = await checkBrandSend("outreach", sb, TARGET);
    expect(d.allowed).toBe(false);
    expect(d.reasons.map((r) => r.code)).toEqual(["recipient_unsubscribed"]);
    expect(inserts).toHaveLength(0);
  });

  it("the override applies only to the outreach profile", async () => {
    m.override = true;
    const d = await checkBrandSend("batch", sb, TARGET);
    expect(d.allowed).toBe(false);
    expect(d.reasons[0].code).toBe("not_ready");
  });
});
