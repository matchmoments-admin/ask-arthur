import { describe, expect, it } from "vitest";

import {
  aggregateStepRuntime,
  buildScraperTelemetryRows,
  pullGitHubScraperRuntime,
  type ScraperConfig,
} from "../scraper-cost-audit";

const configs: Pick<ScraperConfig, "source" | "stepName">[] = [
  { source: "urlhaus", stepName: "URLhaus" },
  { source: "openphish", stepName: "OpenPhish" },
];

describe("aggregateStepRuntime", () => {
  it("sums matching step durations and ignores skipped/incomplete steps", () => {
    const runtime = aggregateStepRuntime(
      [
        {
          steps: [
            {
              name: "URLhaus",
              started_at: "2026-05-19T00:00:00Z",
              completed_at: "2026-05-19T00:02:00Z",
            },
            {
              name: "URLhaus",
              conclusion: "skipped",
              started_at: "2026-05-19T00:03:00Z",
              completed_at: "2026-05-19T00:04:00Z",
            },
            {
              name: "OpenPhish",
              started_at: "2026-05-19T00:10:00Z",
              completed_at: "2026-05-19T00:10:30Z",
            },
            { name: "Untracked scraper" },
          ],
        },
      ],
      configs,
    );

    expect(runtime.get("urlhaus")).toEqual({ runtimeSeconds: 120, runs: 1 });
    expect(runtime.get("openphish")).toEqual({ runtimeSeconds: 30, runs: 1 });
  });
});

describe("buildScraperTelemetryRows", () => {
  it("joins row counts and runtime, defaulting missing sources to zero", () => {
    const rows = buildScraperTelemetryRows(
      "2026-05-19",
      configs,
      { urlhaus: 42 },
      { urlhaus: { runtimeSeconds: 90, runs: 2 } },
    );

    expect(rows).toEqual([
      {
        date: "2026-05-19",
        source: "openphish",
        rows_added: 0,
        runtime_seconds: 0,
        runs: 0,
      },
      {
        date: "2026-05-19",
        source: "urlhaus",
        rows_added: 42,
        runtime_seconds: 90,
        runs: 2,
      },
    ]);
  });
});

describe("pullGitHubScraperRuntime", () => {
  it("fetches workflow runs once per workflow and returns JSON-safe runtime rows", async () => {
    const scraperConfigs: ScraperConfig[] = [
      {
        source: "urlhaus",
        workflowId: "scrape-feeds.yml",
        stepName: "URLhaus",
        rowCountFilters: [],
      },
      {
        source: "openphish",
        workflowId: "scrape-feeds.yml",
        stepName: "OpenPhish",
        rowCountFilters: [],
      },
    ];
    const requestedUrls: string[] = [];
    const fetchImpl = async (url: RequestInfo | URL): Promise<Response> => {
      const requestedUrl = String(url);
      requestedUrls.push(requestedUrl);
      if (requestedUrl.includes("/actions/workflows/scrape-feeds.yml/runs")) {
        return Response.json({
          workflow_runs: [{ jobs_url: "https://api.github.test/jobs/1" }],
        });
      }
      return Response.json({
        jobs: [
          {
            steps: [
              {
                name: "URLhaus",
                started_at: "2026-05-19T00:00:00Z",
                completed_at: "2026-05-19T00:01:00Z",
              },
            ],
          },
        ],
      });
    };

    const runtime = await pullGitHubScraperRuntime(
      "2026-05-19",
      scraperConfigs,
      "token",
      "owner/repo",
      fetchImpl as typeof fetch,
    );

    expect(runtime).toEqual({
      openphish: { runtimeSeconds: 0, runs: 0 },
      urlhaus: { runtimeSeconds: 60, runs: 1 },
    });
    expect(requestedUrls).toEqual([
      "https://api.github.com/repos/owner/repo/actions/workflows/scrape-feeds.yml/runs?created=2026-05-19&per_page=100",
      "https://api.github.test/jobs/1?per_page=100",
    ]);
  });
});
