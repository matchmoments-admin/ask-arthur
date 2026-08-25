import { describe, it, expect, vi, beforeEach } from "vitest";
import { inspectPdfStructure, collectStructuralFindings } from "@askarthur/scam-engine/document-check";

// recordDocumentCheck — the ONE evidence-write path. The load-bearing
// assertions are the ADR-0022 invariants: flagged-only, flag-gated,
// metadata-only (no byte or extracted-text fields in the row).

const flagState = vi.hoisted(() => ({ documentCheckRecords: true }));
const inserts = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));
const dbState = vi.hoisted(() => ({ fail: false }));

vi.mock("@askarthur/utils/feature-flags", () => ({ featureFlags: flagState }));
vi.mock("@askarthur/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => p }));
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      insert: vi.fn(async (row: Record<string, unknown>) => {
        if (dbState.fail) return { error: { message: "insert failed" } };
        inserts.rows.push(row);
        return { error: null };
      }),
    })),
  })),
}));

import { recordDocumentCheck } from "@/lib/document-check-records";

// A doctored PDF via the REAL engine so the summary shape stays honest.
const DOCTORED = Buffer.from(
  `%PDF-1.7\n4 0 obj\n<< /Producer (Adobe Photoshop) >>\nendobj\n` +
    `trailer\n<< /Info 4 0 R /ID [<aa> <aa>] >>\nstartxref\n9\n%%EOF\n` +
    `4 0 obj\n<< /Producer (Adobe Photoshop) >>\nendobj\ntrailer\n<< /Prev 9 >>\nstartxref\n200\n%%EOF\n`,
  "latin1",
);

function flaggedInspection() {
  const structural = inspectPdfStructure(DOCTORED);
  return {
    docSha256: "a".repeat(64),
    structural,
    findings: collectStructuralFindings(structural),
    content: null,
  };
}

beforeEach(() => {
  flagState.documentCheckRecords = true;
  inserts.rows.length = 0;
  dbState.fail = false;
});

describe("recordDocumentCheck", () => {
  it("returns null and writes nothing while the records flag is off", async () => {
    flagState.documentCheckRecords = false;
    expect(await recordDocumentCheck(flaggedInspection(), { source: "web" })).toBeNull();
    expect(inserts.rows).toHaveLength(0);
  });

  it("returns null for a clean check — flagged-only is structural", async () => {
    const structural = inspectPdfStructure(
      Buffer.from("%PDF-1.7\ntrailer\n<< >>\nstartxref\n9\n%%EOF\n", "latin1"),
    );
    const clean = { docSha256: "b".repeat(64), structural, findings: [], content: null };
    expect(await recordDocumentCheck(clean, { source: "web" })).toBeNull();
    expect(inserts.rows).toHaveLength(0);
  });

  it("never hands out a ref whose row failed to write — insert error → null", async () => {
    dbState.fail = true;
    expect(await recordDocumentCheck(flaggedInspection(), { source: "web" })).toBeNull();
  });

  it("writes a DC- keyed, metadata-only row for a flagged check", async () => {
    const inspection = flaggedInspection();
    expect(inspection.findings.length).toBeGreaterThan(0);
    const ref = await recordDocumentCheck(inspection, {
      source: "api",
      orgId: "org-123",
      apiKeyHash: "hash-abc",
    });
    expect(ref).toMatch(/^DC-[0-9A-HJKMNP-TV-Z]{12}$/);
    expect(inserts.rows).toHaveLength(1);
    const row = inserts.rows[0]!;
    expect(row.check_ref).toBe(ref);
    expect(row.source).toBe("api");
    expect(row.org_id).toBe("org-123");
    expect(row.api_key_hash).toBe("hash-abc");
    // METADATA ONLY: no document bytes, no extracted text, and the
    // structural summary is the curated subset — not the raw buffer.
    const serialized = JSON.stringify(row);
    expect(row).not.toHaveProperty("text");
    expect(row).not.toHaveProperty("bytes");
    expect(serialized).not.toContain("%PDF");
    expect((row.structural_summary as Record<string, unknown>).producer).toBe(
      "Adobe Photoshop",
    );
  });
});
