import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Covers the 2026-07-29 fix that made the consumer reporting loop reachable
 * AND closed the IDOR that wiring it up would otherwise have exposed.
 *
 * Before: ResultCard gated its report CTA on a numeric `scamReportId` that the
 * web checker never had (the scam_reports row is written asynchronously), so
 * the CTA never rendered and `onward_report_log` sat at zero rows for the
 * platform's entire history. Meanwhile POST /api/report/onward accepted a raw
 * `scam_report_id` from the client with no ownership check — and report ids
 * are sequential integers.
 *
 * After: the client presents `analysis_ref` (the request ULID, 80 bits of
 * randomness, persisted as scam_reports.idempotency_key) and the server
 * resolves it. No client-supplied id is accepted at all.
 */

const submitMock = vi.fn();
vi.mock("@/lib/onward/submit", () => ({
  submitOnwardReports: (...a: unknown[]) => submitMock(...a),
  ONWARD_DEST_VALUES: ["scamwatch", "reportcyber", "idcare", "openphish"],
}));

const rateLimitMock = vi.fn().mockResolvedValue({ allowed: true });
vi.mock("@askarthur/utils/rate-limit", () => ({
  checkFormRateLimit: (...a: unknown[]) => rateLimitMock(...a),
}));

vi.mock("@askarthur/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

let reportLookupResult: { data: unknown; error: unknown } = {
  data: { id: 4242 },
  error: null,
};

vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => ({
    from: () => {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        maybeSingle: () => Promise.resolve(reportLookupResult),
      };
      return b;
    },
  }),
}));

import { POST } from "@/app/api/report/onward/route";

function makeRequest(body: unknown) {
  return new Request("https://askarthur.au/api/report/onward", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-real-ip": "1.2.3.4" },
    body: JSON.stringify(body),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
}

const VALID_PICK = [{ destination: "scamwatch", destination_key: "scamwatch" }];

describe("POST /api/report/onward — ref-based ownership", () => {
  beforeEach(() => {
    submitMock.mockReset().mockResolvedValue({ ok: true, results: [] });
    rateLimitMock.mockClear().mockResolvedValue({ allowed: true });
    reportLookupResult = { data: { id: 4242 }, error: null };
  });

  it("resolves analysis_ref to the report id and submits", async () => {
    const res = await POST(
      makeRequest({
        analysis_ref: "01JBXQ8Z9K2M4N6P8R0T2V4W6X",
        selected: VALID_PICK,
      })
    );

    expect(res.status).toBe(200);
    expect(submitMock).toHaveBeenCalledTimes(1);
    // The id the core is told to use came from the LOOKUP, not the client.
    expect(submitMock.mock.calls[0]![1]).toMatchObject({ scamReportId: 4242 });
  });

  it("rejects a body carrying only a numeric scam_report_id (the old IDOR shape)", async () => {
    const res = await POST(
      makeRequest({ scam_report_id: 1, selected: VALID_PICK })
    );

    expect(res.status).toBe(400);
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("ignores a client-supplied scam_report_id when a ref is present", async () => {
    // The attacker supplies someone else's id alongside their own valid ref.
    const res = await POST(
      makeRequest({
        analysis_ref: "01JBXQ8Z9K2M4N6P8R0T2V4W6X",
        scam_report_id: 7,
        selected: VALID_PICK,
      })
    );

    expect(res.status).toBe(200);
    // Still the resolved id — the supplied 7 never reaches the core.
    expect(submitMock.mock.calls[0]![1]).toMatchObject({ scamReportId: 4242 });
  });

  it("404s an unknown ref without revealing whether it is forged or just not written yet", async () => {
    reportLookupResult = { data: null, error: null };

    const res = await POST(
      makeRequest({
        analysis_ref: "01JBXQ8Z9K2M4N6P8R0T2V4W6X",
        selected: VALID_PICK,
      })
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "report_not_found" });
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("still enforces the per-IP rate limit before doing any lookup", async () => {
    rateLimitMock.mockResolvedValue({ allowed: false, message: "slow down" });

    const res = await POST(
      makeRequest({
        analysis_ref: "01JBXQ8Z9K2M4N6P8R0T2V4W6X",
        selected: VALID_PICK,
      })
    );

    expect(res.status).toBe(429);
    expect(submitMock).not.toHaveBeenCalled();
  });
});
