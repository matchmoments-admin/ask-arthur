import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PR 7 wiring — the one producer (clone-watch-report-summary) and its reader
 * (report-brand-stewardship).
 *
 * Go-red record:
 *   - "a manual re-run of a frozen month writes nothing": delete the
 *     `if (frozenAt && !republish)` early return → upsertSummary and the store
 *     writer are both called.
 *   - "stewardship runs after the store": restore `{ cron: "0 9 1 * *" }` in
 *     STEWARDSHIP_TRIGGERS → the no-cron assertion fails.
 */

const m = vi.hoisted(() => ({
  loadCardInputs: vi.fn(),
  buildReportCard: vi.fn(),
  buildTrendRows: vi.fn(),
  upsertSummary: vi.fn(),
  readMonthFrozenAt: vi.fn(),
  writeMonthlyStats: vi.fn(),
  sendEvent: vi.fn(),
}));

vi.mock("@askarthur/scam-engine/inngest/client", () => ({
  inngest: {
    createFunction: (config: unknown, triggers: unknown, handler: unknown) => ({
      config,
      triggers,
      handler,
    }),
  },
}));
vi.mock("@askarthur/scam-engine/inngest/with-axiom-logging", () => ({
  withAxiomLogging: (_c: unknown, handler: unknown) => handler,
}));
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({ is: async () => ({ data: [], error: null }) }),
    }),
  }),
}));
vi.mock("@askarthur/scam-engine/active-watchlist", () => ({
  getActiveWatchlist: async () => [],
}));
vi.mock("@/lib/clone-watch/record-coverage", () => ({
  planCoverageSync: () => ({ toAdd: [], toClose: [], unchanged: 0 }),
  logCoverageChange: () => {},
}));
vi.mock("@/lib/bots/telegram/sendAdminMessage", () => ({
  sendAdminTelegramMessage: vi.fn(),
}));
vi.mock("@/lib/clone-watch/report-card-data", () => ({
  loadCardInputs: m.loadCardInputs,
}));
vi.mock("@/lib/clone-watch/report-card", () => ({
  buildReportCard: m.buildReportCard,
  buildTrendRows: m.buildTrendRows,
}));
vi.mock("@/lib/clone-watch/report-summary", () => ({
  upsertSummary: m.upsertSummary,
}));
vi.mock("@/lib/clone-watch/monthly-brand-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/clone-watch/monthly-brand-store")>()),
  readMonthFrozenAt: m.readMonthFrozenAt,
  writeMonthlyStats: m.writeMonthlyStats,
}));

import { cloneWatchReportSummary } from "@/app/api/inngest/functions/clone-watch-report-summary";
import { STEWARDSHIP_TRIGGERS } from "@/app/api/inngest/functions/report-brand-stewardship";
import { MONTHLY_STORE_WRITTEN_EVENT } from "@/lib/clone-watch/monthly-brand-store";

type Fn = { handler: (ctx: unknown) => Promise<Record<string, unknown>> };
const run = (event: { name: string; data?: unknown }) =>
  (cloneWatchReportSummary as unknown as Fn).handler({
    event,
    step: {
      run: (_n: string, fn: () => unknown) => fn(),
      sendEvent: m.sendEvent,
    },
  });

const card = {
  periodMonth: "2026-08-01",
  total: 10,
  brands: 2,
  durations: {
    declineToWeaponise: { medianHours: null },
    weaponiseToRefile: { medianHours: null },
    refileToTakedown: { medianHours: null },
    fullLoop: { medianHours: null },
    excludedNegativeN: 0,
    anomalousInversionsN: 0,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  m.loadCardInputs.mockImplementation(async (ym: string) => ({ ym, takedownEvents: [] }));
  m.buildReportCard.mockImplementation((i: { ym: string }) => ({ ...card, periodMonth: `${i.ym}-01` }));
  m.buildTrendRows.mockReturnValue({ periodMonth: "2026-08-01", brandRows: [], registrarRows: [] });
  m.readMonthFrozenAt.mockResolvedValue(null);
  m.writeMonthlyStats.mockResolvedValue({
    status: "written",
    frozenAt: "2026-09-01T11:02:00Z",
    previousFrozenAt: null,
    brandRows: 2,
    registrarRows: 1,
  });
});

describe("clone-watch-report-summary — the one producer", () => {
  it("scheduled run writes the store, then hands the month to stewardship", async () => {
    const out = await run({
      name: "inngest/scheduled.timer",
      data: { cron: "0 11 1 * *" }, // a cron tick carries a payload — not a manual override
    });
    expect(m.upsertSummary).toHaveBeenCalledTimes(1);
    expect(m.writeMonthlyStats).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      republish: false,
    });
    expect(m.sendEvent).toHaveBeenCalledWith("emit-monthly-store-written", {
      name: MONTHLY_STORE_WRITTEN_EVENT,
      id: expect.stringContaining("monthly-store-"),
      data: expect.objectContaining({ status: "written", frozenAt: "2026-09-01T11:02:00Z" }),
    });
    expect(out.emitted).toBe(true);
  });

  it("a manual re-run of a frozen month writes nothing and triggers nothing", async () => {
    m.readMonthFrozenAt.mockResolvedValue("2026-09-04T05:00:00Z");
    const out = await run({
      name: "clone-watch/report-summary.manual-trigger.v1",
      data: { periodMonth: "2026-07" },
    });
    expect(m.loadCardInputs).not.toHaveBeenCalled();
    expect(m.upsertSummary).not.toHaveBeenCalled();
    expect(m.writeMonthlyStats).not.toHaveBeenCalled();
    expect(m.sendEvent).not.toHaveBeenCalled();
    expect(out).toMatchObject({ skipped: "frozen", frozenAt: "2026-09-04T05:00:00Z" });
  });

  it("republish is the one deliberate restatement path", async () => {
    m.readMonthFrozenAt.mockResolvedValue("2026-09-04T05:00:00Z");
    m.writeMonthlyStats.mockResolvedValue({
      status: "republished",
      frozenAt: "2026-09-23T01:00:00Z",
      previousFrozenAt: "2026-09-04T05:00:00Z",
      brandRows: 2,
      registrarRows: 1,
    });
    await run({
      name: "clone-watch/report-summary.manual-trigger.v1",
      data: { periodMonth: "2026-07", republish: true },
    });
    expect(m.upsertSummary).toHaveBeenCalledTimes(1);
    expect(m.writeMonthlyStats).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      republish: true,
    });
    expect(m.sendEvent).toHaveBeenCalledWith(
      "emit-monthly-store-written",
      expect.objectContaining({ id: "monthly-store-2026-07-01-2026-09-23T01:00:00Z" }),
    );
  });

  it("the scheduled run still hands a frozen month to stewardship (its own retry)", async () => {
    m.readMonthFrozenAt.mockResolvedValue("2026-09-01T11:02:00Z");
    await run({ name: "inngest/scheduled.timer", data: { cron: "0 11 1 * *" } });
    expect(m.writeMonthlyStats).not.toHaveBeenCalled();
    // Same id as the original send → Inngest dedupes it if that one went out.
    expect(m.sendEvent).toHaveBeenCalledWith(
      "emit-monthly-store-written",
      expect.objectContaining({ id: expect.stringMatching(/-2026-09-01T11:02:00Z$/) }),
    );
  });
});

describe("report-brand-stewardship — reads the store after it is written", () => {
  it("is triggered by the store's completion event, never a free-running cron", () => {
    const triggers = STEWARDSHIP_TRIGGERS as ReadonlyArray<Record<string, unknown>>;
    expect(triggers.some((t) => t.event === MONTHLY_STORE_WRITTEN_EVENT)).toBe(true);
    expect(triggers.some((t) => "cron" in t)).toBe(false);
  });
});
