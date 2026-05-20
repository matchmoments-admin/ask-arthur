import { describe, expect, it, vi } from "vitest";

import {
  aggregateInngestFinishedEvents,
  buildVercelCronRows,
  countCronInvocationsForDay,
  pullInngestFunctionInvocationRows,
} from "../function-invocation-audit";

describe("function invocation audit helpers", () => {
  it("aggregates Inngest finished events by function and average runtime", () => {
    const rows = aggregateInngestFinishedEvents("2026-05-19", [
      { data: { function_id: "reddit-intel-daily", runtime_ms: 1200 } },
      { data: { function_id: "reddit-intel-daily", runtime_ms: 1800 } },
      { data: { function_id: "feed-items-embed" } },
      { data: { function_id: "" } },
    ]);

    expect(rows).toEqual([
      {
        date: "2026-05-19",
        function_name: "feed-items-embed",
        invocations: 1,
        avg_duration_ms: null,
        source: "inngest",
      },
      {
        date: "2026-05-19",
        function_name: "reddit-intel-daily",
        invocations: 2,
        avg_duration_ms: 1500,
        source: "inngest",
      },
    ]);
  });

  it("paginates the Inngest events API and counts function ids", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ data: { function_id: "a", runtime_ms: 100 } }],
          next_cursor: "next-page",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          events: [
            { data: { function_id: "a", runtime_ms: 300 } },
            { data: { function_id: "b", runtime_ms: 50 } },
          ],
        }),
      });

    const rows = await pullInngestFunctionInvocationRows(
      "2026-05-19",
      "test-token",
      fetchMock as unknown as typeof fetch,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "name=inngest%2Ffunction.finished",
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("cursor=next-page");
    expect(rows).toEqual([
      {
        date: "2026-05-19",
        function_name: "a",
        invocations: 2,
        avg_duration_ms: 200,
        source: "inngest",
      },
      {
        date: "2026-05-19",
        function_name: "b",
        invocations: 1,
        avg_duration_ms: 50,
        source: "inngest",
      },
    ]);
  });

  it("counts common Vercel cron schedules for one UTC day", () => {
    expect(countCronInvocationsForDay("*/5 * * * *", "2026-05-19")).toBe(288);
    expect(countCronInvocationsForDay("0 */6 * * *", "2026-05-19")).toBe(4);
    expect(countCronInvocationsForDay("0 12 * * 1", "2026-05-18")).toBe(1);
    expect(countCronInvocationsForDay("0 12 * * 1", "2026-05-19")).toBe(0);
  });

  it("builds Vercel cron rows with normalized function names", () => {
    const rows = buildVercelCronRows("2026-05-19", [
      { path: "/api/cron/pg-stuck-query-watchdog", schedule: "*/5 * * * *" },
      { path: "/api/cron/cost-daily-check", schedule: "0 */6 * * *" },
    ]);

    expect(rows).toEqual([
      {
        date: "2026-05-19",
        function_name: "pg-stuck-query-watchdog",
        invocations: 288,
        avg_duration_ms: null,
        source: "vercel-cron",
      },
      {
        date: "2026-05-19",
        function_name: "cost-daily-check",
        invocations: 4,
        avg_duration_ms: null,
        source: "vercel-cron",
      },
    ]);
  });
});
