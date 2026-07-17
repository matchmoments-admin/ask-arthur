import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// /api/image-check/[ref]/pdf — flag gates, ref-format gate, 404-identical
// behaviour, and the happy path returning a real rendered PDF (react-pdf
// runs for real here — the one-page render is fast enough for unit tests).

const recordState = vi.hoisted(() => ({
  record: null as Record<string, unknown> | null,
}));

vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({ data: recordState.record, error: null })),
    })),
  })),
}));
vi.mock("@askarthur/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("@askarthur/utils/feature-flags", () => ({
  featureFlags: { imageCheck: true, imageCheckRecords: true },
}));

import { GET } from "@/app/api/image-check/[ref]/pdf/route";
import { featureFlags } from "@askarthur/utils/feature-flags";

const REF = "IC-0123456789AB";

const RECORD = {
  check_ref: REF,
  checked_at: "2026-07-17T05:00:00.000Z",
  image_url: "https://images.example.com/a.jpg",
  page_url: "https://example.com/feed",
  image_sha256: "ab".repeat(32),
  ai_confidence: 0.97,
  deepfake_confidence: 0.12,
  generator_source: "midjourney",
  generator_breakdown: [{ class: "midjourney", score: 0.62 }],
  content_credentials: { present: true, format: "jpeg" },
  vision_summary: "Appears to show a public figure endorsing an investment platform.",
  impersonated_brand: null,
  impersonated_celebrity: "Gina Rinehart",
};

function makeReq(ref: string) {
  return [
    new NextRequest(`http://localhost/api/image-check/${ref}/pdf`),
    { params: Promise.resolve({ ref }) },
  ] as const;
}

beforeEach(() => {
  vi.clearAllMocks();
  recordState.record = RECORD;
  (featureFlags as { imageCheck: boolean }).imageCheck = true;
  (featureFlags as { imageCheckRecords: boolean }).imageCheckRecords = true;
});

describe("evidence PDF route", () => {
  it("renders a real one-page PDF with attachment headers", async () => {
    const res = await GET(...makeReq(REF));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain(
      `askarthur-evidence-${REF}.pdf`,
    );
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("404s for an unknown ref", async () => {
    recordState.record = null;
    const res = await GET(...makeReq(REF));
    expect(res.status).toBe(404);
  });

  it("404s for a malformed ref without touching the database", async () => {
    const res = await GET(...makeReq("IC-lowercase-bad"));
    expect(res.status).toBe(404);
  });

  it("404s identically when the records flag is off", async () => {
    (featureFlags as { imageCheckRecords: boolean }).imageCheckRecords = false;
    const res = await GET(...makeReq(REF));
    expect(res.status).toBe(404);
  });
});
