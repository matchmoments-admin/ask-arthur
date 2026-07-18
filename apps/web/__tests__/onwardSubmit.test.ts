import { describe, it, expect, vi, beforeEach } from "vitest";

// Unit tests for the extracted onward-submit core (lib/onward/submit.ts) — the
// single source of truth both the /api/report/onward route and the bot
// "Report scam" flow drive. The route previously had no direct test; this adds
// coverage for the key-validation + insert/fire + dedup behaviour.

const sendMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@askarthur/scam-engine/inngest/client", () => ({
  inngest: { send: (...a: unknown[]) => sendMock(...a) },
}));
vi.mock("@askarthur/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { submitOnwardReports } from "@/lib/onward/submit";

type TableResults = Record<string, Record<string, { data: unknown; error: unknown }>>;

/** Minimal chainable Supabase stub. `.from(table)` returns a builder whose
 *  terminal resolves results[table][op], where op is select | insert | update. */
function makeClient(results: TableResults) {
  return {
    from(table: string) {
      let op = "select";
      const res = () =>
        Promise.resolve(results[table]?.[op] ?? { data: null, error: null });
      const b: Record<string, unknown> = {
        select: () => b,
        insert: () => {
          op = "insert";
          return b;
        },
        update: () => {
          op = "update";
          return b;
        },
        eq: () => b,
        in: () => b,
        maybeSingle: () => res(),
        single: () => res(),
        then: (onF: unknown, onR: unknown) =>
          res().then(onF as never, onR as never),
      };
      return b;
    },
  } as never;
}

beforeEach(() => {
  sendMock.mockClear();
});

const REPORT_OK = {
  scam_reports: {
    select: {
      data: { id: 42, scam_type: "phishing", impersonated_brand: "NAB" },
      error: null,
    },
  },
  known_brands: { select: { data: [{ brand_key: "nab" }], error: null } },
  onward_report_log: {
    select: { data: null, error: null }, // no existing row
    insert: { data: { id: "log-1" }, error: null },
  },
};

describe("submitOnwardReports", () => {
  it("logs + fires each valid destination and returns queued", async () => {
    const sb = makeClient(REPORT_OK);
    const outcome = await submitOnwardReports(sb, {
      scamReportId: 42,
      selected: [
        { destination: "scamwatch", destination_key: "scamwatch.gov.au" },
        { destination: "brand_abuse", destination_key: "nab" },
      ],
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.results).toHaveLength(2);
    expect(outcome.results.every((r) => r.status === "queued")).toBe(true);
    // one Inngest event per destination, correctly named
    expect(sendMock).toHaveBeenCalledTimes(2);
    const names = sendMock.mock.calls.map(([e]) => (e as { name: string }).name);
    expect(names).toContain("report.onward.scamwatch");
    expect(names).toContain("report.onward.brand_abuse");
    // brand display uses the impersonated brand
    const brand = outcome.results.find((r) => r.destination === "brand_abuse");
    expect(brand?.display_name).toBe("NAB security team");
  });

  it("404s when the scam_report does not exist", async () => {
    const sb = makeClient({
      scam_reports: { select: { data: null, error: null } },
    });
    const outcome = await submitOnwardReports(sb, {
      scamReportId: 999,
      selected: [{ destination: "scamwatch", destination_key: "scamwatch.gov.au" }],
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(404);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("400s on a non-canonical fixed destination_key (anti-fan-out)", async () => {
    const sb = makeClient(REPORT_OK);
    const outcome = await submitOnwardReports(sb, {
      scamReportId: 42,
      selected: [{ destination: "scamwatch", destination_key: "evil.example.com" }],
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(400);
    expect(outcome.error).toBe("invalid_destination");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("400s on a brand_abuse key not matching an active known_brand", async () => {
    const sb = makeClient({
      ...REPORT_OK,
      known_brands: { select: { data: [], error: null } }, // no match
    });
    const outcome = await submitOnwardReports(sb, {
      scamReportId: 42,
      selected: [{ destination: "brand_abuse", destination_key: "not_a_brand" }],
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(400);
  });
});
