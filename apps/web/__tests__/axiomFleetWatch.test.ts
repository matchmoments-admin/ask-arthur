import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/cron-auth", () => ({ requireCronAuth: vi.fn(() => null) }));
vi.mock("@/lib/axiom-query", () => ({ axiomQuery: vi.fn() }));
vi.mock("@/lib/bots/telegram/sendAdminMessage", () => ({
  sendAdminTelegramMessage: vi.fn(),
}));

import { axiomQuery } from "@/lib/axiom-query";
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";
import { GET } from "@/app/api/cron/axiom-fleet-watch/route";

const req = () => new Request("https://askarthur.au/api/cron/axiom-fleet-watch");

/** Mock axiomQuery: route the bucket query vs the per-fn query by APL shape. */
function mockAxiom(
  buckets: Array<{ cat: string; n: number }>,
  byFn: Array<{ "fields.fn": string; n: number }> = [],
) {
  vi.mocked(axiomQuery).mockImplementation(async (apl: string) =>
    apl.includes("by cat") ? buckets : byFn,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AXIOM_QUERY_TOKEN = "xaat-test";
  // Clear any threshold overrides so defaults (5/3/300/10) apply.
  delete process.env.AXIOM_FLEET_ERROR_THRESHOLD;
  delete process.env.AXIOM_FLEET_PER_FN_ERROR_THRESHOLD;
  delete process.env.AXIOM_FLEET_RUNAWAY_THRESHOLD;
  delete process.env.AXIOM_FLEET_5XX_THRESHOLD;
});

describe("axiom-fleet-watch cron", () => {
  it("no-ops when AXIOM_QUERY_TOKEN is unset", async () => {
    delete process.env.AXIOM_QUERY_TOKEN;
    const res = await GET(req());
    expect((await res.json()).skipped).toBe(true);
    expect(axiomQuery).not.toHaveBeenCalled();
  });

  it("does NOT page when all signals are below threshold", async () => {
    mockAxiom([
      { cat: "inngest_error", n: 2 },
      { cat: "inngest_start", n: 40 },
      { cat: "http_5xx", n: 1 },
    ], [{ "fields.fn": "feed-sync", n: 2 }]);
    const res = await GET(req());
    const json = await res.json();
    expect(json.tripped).toBe(false);
    expect(sendAdminTelegramMessage).not.toHaveBeenCalled();
  });

  it("pages on an inngest error spike (>= 5)", async () => {
    mockAxiom([{ cat: "inngest_error", n: 7 }], [
      { "fields.fn": "scam-alert-push", n: 4 },
      { "fields.fn": "feed-sync", n: 3 },
    ]);
    const res = await GET(req());
    expect((await res.json()).paged).toBe(true);
    expect(sendAdminTelegramMessage).toHaveBeenCalledOnce();
    const msg = vi.mocked(sendAdminTelegramMessage).mock.calls[0][0];
    expect(msg).toContain("Inngest errors");
    expect(msg).toContain("scam-alert-push");
  });

  it("pages when one fn fails repeatedly (>= 3) even if total < 5", async () => {
    mockAxiom([{ cat: "inngest_error", n: 3 }], [
      { "fields.fn": "report-onward-acma-email-spam", n: 3 },
    ]);
    const res = await GET(req());
    expect((await res.json()).paged).toBe(true);
    expect(vi.mocked(sendAdminTelegramMessage).mock.calls[0][0]).toContain(
      "report-onward-acma-email-spam",
    );
  });

  it("pages on a runaway fn.start volume (>= 300)", async () => {
    mockAxiom([{ cat: "inngest_start", n: 412 }]);
    const res = await GET(req());
    expect((await res.json()).paged).toBe(true);
    expect(vi.mocked(sendAdminTelegramMessage).mock.calls[0][0]).toContain("Runaway");
  });

  it("pages on a 5xx spike (>= 10)", async () => {
    mockAxiom([{ cat: "http_5xx", n: 14 }]);
    const res = await GET(req());
    expect((await res.json()).paged).toBe(true);
    expect(vi.mocked(sendAdminTelegramMessage).mock.calls[0][0]).toContain("5xx");
  });

  it("skips the run (no page) when the Axiom query fails", async () => {
    vi.mocked(axiomQuery).mockResolvedValue(null);
    const res = await GET(req());
    expect((await res.json()).checked).toBe(false);
    expect(sendAdminTelegramMessage).not.toHaveBeenCalled();
  });
});
