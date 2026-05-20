// Nightly per-scraper telemetry -> scraper_telemetry (v139).
//
// This is observability only. It joins:
//   - rows_added: count aggregates from the destination tables each scraper
//     actually writes to;
//   - runtime_seconds/runs: GitHub Actions job-step timings for the scraper
//     step in scrape-feeds.yml / scrape-vulnerabilities.yml.
//
// Expected duration <3 min for ~2 workflows and ~1 day of runs. No hot-table
// writes; destination is one lean row per (date, source).

import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

import { inngest } from "./client";

const DAY_MS = 86_400_000;
const GITHUB_API = "https://api.github.com";
const DEFAULT_REPO = "matchmoments-admin/ask-arthur";

export type RowCountFilter =
  | {
      table: "feed_items";
      column: "source";
      dateColumn: "created_at";
      value: string;
    }
  | {
      table: "scam_urls" | "scam_ips" | "scam_crypto_wallets" | "scam_entities";
      arrayColumn: "feed_sources";
      dateColumn: "created_at";
      value: string;
    }
  | {
      table: "vulnerabilities";
      arrayColumn: "source_feeds";
      dateColumn: "ingested_at";
      value: string;
    }
  | {
      table: "acnc_charities" | "pfra_members";
      dateColumn: "ingested_at";
    };

export interface ScraperConfig {
  source: string;
  workflowId: "scrape-feeds.yml" | "scrape-vulnerabilities.yml";
  stepName: string;
  rowCountFilters: RowCountFilter[];
}

export interface ScraperTelemetryRow {
  date: string;
  source: string;
  rows_added: number;
  runtime_seconds: number;
  runs: number;
}

export interface StepRuntime {
  runtimeSeconds: number;
  runs: number;
}

type RowsAddedBySource = Record<string, number>;
type RuntimeBySource = Record<string, StepRuntime>;

interface GitHubWorkflowRun {
  id?: number;
  jobs_url?: string;
}

interface GitHubWorkflowRunsPage {
  workflow_runs?: GitHubWorkflowRun[];
}

interface GitHubJobStep {
  name?: string;
  status?: string;
  conclusion?: string;
  started_at?: string | null;
  completed_at?: string | null;
}

interface GitHubJob {
  steps?: GitHubJobStep[];
}

interface GitHubJobsPage {
  jobs?: GitHubJob[];
}

function sourceFilter(
  table: "feed_items",
  value: string,
): RowCountFilter;
function sourceFilter(
  table: "scam_urls" | "scam_ips" | "scam_crypto_wallets" | "scam_entities",
  value: string,
): RowCountFilter;
function sourceFilter(table: "vulnerabilities", value: string): RowCountFilter;
function sourceFilter(table: string, value: string): RowCountFilter {
  if (table === "feed_items") {
    return { table, column: "source", dateColumn: "created_at", value };
  }
  if (table === "vulnerabilities") {
    return { table, arrayColumn: "source_feeds", dateColumn: "ingested_at", value };
  }
  return {
    table: table as "scam_urls" | "scam_ips" | "scam_crypto_wallets" | "scam_entities",
    arrayColumn: "feed_sources",
    dateColumn: "created_at",
    value,
  };
}

export const SCRAPER_CONFIGS: ScraperConfig[] = [
  {
    source: "scamwatch_alerts",
    workflowId: "scrape-feeds.yml",
    stepName: "Scamwatch alerts (HTML narrative)",
    rowCountFilters: [
      sourceFilter("feed_items", "scamwatch_alert"),
      sourceFilter("scam_urls", "scamwatch_alert"),
    ],
  },
  {
    source: "acsc_alerts",
    workflowId: "scrape-feeds.yml",
    stepName: "ACSC alerts + advisories (RSS)",
    rowCountFilters: [
      sourceFilter("feed_items", "acsc"),
      sourceFilter("scam_urls", "acsc"),
    ],
  },
  {
    source: "urlhaus",
    workflowId: "scrape-feeds.yml",
    stepName: "URLhaus",
    rowCountFilters: [sourceFilter("scam_urls", "urlhaus")],
  },
  {
    source: "openphish",
    workflowId: "scrape-feeds.yml",
    stepName: "OpenPhish",
    rowCountFilters: [sourceFilter("scam_urls", "openphish")],
  },
  {
    source: "phishtank",
    workflowId: "scrape-feeds.yml",
    stepName: "PhishTank",
    rowCountFilters: [sourceFilter("scam_urls", "phishtank")],
  },
  {
    source: "phishstats",
    workflowId: "scrape-feeds.yml",
    stepName: "PhishStats",
    rowCountFilters: [sourceFilter("scam_urls", "phishstats")],
  },
  {
    source: "phishing_database",
    workflowId: "scrape-feeds.yml",
    stepName: "Phishing.Database",
    rowCountFilters: [sourceFilter("scam_urls", "phishing_database")],
  },
  {
    source: "phishing_army",
    workflowId: "scrape-feeds.yml",
    stepName: "Phishing Army",
    rowCountFilters: [sourceFilter("scam_urls", "phishing_army")],
  },
  {
    source: "feodo",
    workflowId: "scrape-feeds.yml",
    stepName: "Feodo Tracker",
    rowCountFilters: [sourceFilter("scam_ips", "feodo")],
  },
  {
    source: "ipsum",
    workflowId: "scrape-feeds.yml",
    stepName: "IPsum",
    rowCountFilters: [sourceFilter("scam_ips", "ipsum")],
  },
  {
    source: "spamhaus",
    workflowId: "scrape-feeds.yml",
    stepName: "Spamhaus DROP/EDROP",
    rowCountFilters: [sourceFilter("scam_ips", "spamhaus")],
  },
  {
    source: "abuseipdb",
    workflowId: "scrape-feeds.yml",
    stepName: "AbuseIPDB seed",
    rowCountFilters: [sourceFilter("scam_ips", "abuseipdb")],
  },
  {
    source: "crtsh",
    workflowId: "scrape-feeds.yml",
    stepName: "crt.sh",
    rowCountFilters: [sourceFilter("scam_urls", "crtsh")],
  },
  {
    source: "asic_investor_alerts",
    workflowId: "scrape-feeds.yml",
    stepName: "ASIC Investor Alert List (JSON snapshot)",
    rowCountFilters: [
      sourceFilter("feed_items", "asic_investor"),
      sourceFilter("scam_urls", "asic_investor"),
    ],
  },
  {
    source: "austrac",
    workflowId: "scrape-feeds.yml",
    stepName: "AUSTRAC media releases (RSS narrative)",
    rowCountFilters: [
      sourceFilter("feed_items", "austrac"),
      sourceFilter("scam_urls", "austrac"),
    ],
  },
  {
    source: "reddit",
    workflowId: "scrape-feeds.yml",
    stepName: "Scrape Reddit r/Scams",
    rowCountFilters: [
      sourceFilter("feed_items", "reddit"),
      sourceFilter("scam_urls", "reddit"),
      sourceFilter("scam_crypto_wallets", "reddit"),
      sourceFilter("scam_entities", "reddit"),
    ],
  },
  {
    source: "acnc_register",
    workflowId: "scrape-feeds.yml",
    stepName: "Scrape ACNC Charity Register",
    rowCountFilters: [{ table: "acnc_charities", dateColumn: "ingested_at" }],
  },
  {
    source: "pfra_members",
    workflowId: "scrape-feeds.yml",
    stepName: "Scrape PFRA member registry",
    rowCountFilters: [{ table: "pfra_members", dateColumn: "ingested_at" }],
  },
  {
    source: "cisa_kev",
    workflowId: "scrape-vulnerabilities.yml",
    stepName: "Scrape CISA KEV",
    rowCountFilters: [sourceFilter("vulnerabilities", "cisa_kev")],
  },
  {
    source: "nvd_recent",
    workflowId: "scrape-vulnerabilities.yml",
    stepName: "Scrape NVD (lastModStartDate last 7 days)",
    rowCountFilters: [sourceFilter("vulnerabilities", "nvd_recent")],
  },
  {
    source: "github_advisory",
    workflowId: "scrape-vulnerabilities.yml",
    stepName: "Scrape GitHub Security Advisories",
    rowCountFilters: [sourceFilter("vulnerabilities", "github_advisory")],
  },
  {
    source: "osv_feed",
    workflowId: "scrape-vulnerabilities.yml",
    stepName: "Scrape OSV.dev (npm + pypi ecosystems)",
    rowCountFilters: [sourceFilter("vulnerabilities", "osv_feed")],
  },
  {
    source: "cert_au_vulns",
    workflowId: "scrape-vulnerabilities.yml",
    stepName: "Scrape CERT AU vulnerability advisories",
    rowCountFilters: [sourceFilter("vulnerabilities", "cert_au_vulns")],
  },
];

function yesterdayIsoDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split("T")[0];
}

function dayBoundsUtc(isoDate: string): { from: string; to: string } {
  const start = new Date(`${isoDate}T00:00:00Z`);
  const end = new Date(start.getTime() + DAY_MS);
  return { from: start.toISOString(), to: end.toISOString() };
}

function stepDurationSeconds(step: GitHubJobStep): number | null {
  if (step.conclusion === "skipped" || step.status === "skipped") return null;
  if (!step.started_at || !step.completed_at) return null;
  const started = new Date(step.started_at).getTime();
  const completed = new Date(step.completed_at).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(completed)) return null;
  if (completed < started) return null;
  return Math.round((completed - started) / 1000);
}

export function aggregateStepRuntime(
  jobs: GitHubJob[],
  configs: Pick<ScraperConfig, "source" | "stepName">[],
): Map<string, StepRuntime> {
  const bySource = new Map<string, StepRuntime>();
  for (const config of configs) {
    bySource.set(config.source, { runtimeSeconds: 0, runs: 0 });
  }

  for (const job of jobs) {
    for (const step of job.steps ?? []) {
      const config = configs.find((c) => c.stepName === step.name);
      if (!config) continue;
      const duration = stepDurationSeconds(step);
      if (duration === null) continue;
      const row = bySource.get(config.source) ?? { runtimeSeconds: 0, runs: 0 };
      row.runtimeSeconds += duration;
      row.runs += 1;
      bySource.set(config.source, row);
    }
  }

  return bySource;
}

async function githubJson<T>(
  url: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<T> {
  const res = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub ${url} ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export async function pullGitHubScraperRuntime(
  date: string,
  configs = SCRAPER_CONFIGS,
  token = process.env.GITHUB_TOKEN,
  repo = process.env.GITHUB_REPOSITORY ?? DEFAULT_REPO,
  fetchImpl: typeof fetch = fetch,
): Promise<RuntimeBySource> {
  if (!token) throw new Error("GITHUB_TOKEN missing — set in Vercel env.");

  const runtime: RuntimeBySource = {};
  for (const config of configs) {
    runtime[config.source] = { runtimeSeconds: 0, runs: 0 };
  }

  const configsByWorkflow = new Map<string, ScraperConfig[]>();
  for (const config of configs) {
    const existing = configsByWorkflow.get(config.workflowId) ?? [];
    existing.push(config);
    configsByWorkflow.set(config.workflowId, existing);
  }

  for (const [workflowId, workflowConfigs] of configsByWorkflow.entries()) {
    const runsUrl = `${GITHUB_API}/repos/${repo}/actions/workflows/${workflowId}/runs?created=${date}&per_page=100`;
    const runsPage = await githubJson<GitHubWorkflowRunsPage>(
      runsUrl,
      token,
      fetchImpl,
    );

    for (const run of runsPage.workflow_runs ?? []) {
      if (!run.jobs_url) continue;
      const jobsPage = await githubJson<GitHubJobsPage>(
        `${run.jobs_url}?per_page=100`,
        token,
        fetchImpl,
      );
      const runRuntime = aggregateStepRuntime(jobsPage.jobs ?? [], workflowConfigs);
      for (const [source, value] of runRuntime.entries()) {
        const target = runtime[source] ?? { runtimeSeconds: 0, runs: 0 };
        target.runtimeSeconds += value.runtimeSeconds;
        target.runs += value.runs;
        runtime[source] = target;
      }
    }
  }

  return runtime;
}

async function countRowsForFilter(
  supabase: NonNullable<ReturnType<typeof createServiceClient>>,
  filter: RowCountFilter,
  from: string,
  to: string,
): Promise<number> {
  let query = supabase
    .from(filter.table)
    .select("*", { count: "exact", head: true })
    .gte(filter.dateColumn, from)
    .lt(filter.dateColumn, to);

  if ("column" in filter) {
    query = query.eq(filter.column, filter.value);
  } else if ("arrayColumn" in filter) {
    query = query.contains(filter.arrayColumn, [filter.value]);
  }

  const { count, error } = await query;
  if (error) {
    throw new Error(`count ${filter.table} failed: ${error.message}`);
  }
  return count ?? 0;
}

async function countRowsAddedBySource(
  supabase: NonNullable<ReturnType<typeof createServiceClient>>,
  date: string,
  configs = SCRAPER_CONFIGS,
): Promise<RowsAddedBySource> {
  const { from, to } = dayBoundsUtc(date);
  const rows: RowsAddedBySource = {};

  for (const config of configs) {
    let total = 0;
    for (const filter of config.rowCountFilters) {
      total += await countRowsForFilter(supabase, filter, from, to);
    }
    rows[config.source] = total;
  }

  return rows;
}

export function buildScraperTelemetryRows(
  date: string,
  configs: Pick<ScraperConfig, "source">[],
  rowsAddedBySource: RowsAddedBySource,
  runtimeBySource: RuntimeBySource,
): ScraperTelemetryRow[] {
  return configs
    .map((config) => {
      const runtime = runtimeBySource[config.source];
      return {
        date,
        source: config.source,
        rows_added: rowsAddedBySource[config.source] ?? 0,
        runtime_seconds: runtime?.runtimeSeconds ?? 0,
        runs: runtime?.runs ?? 0,
      };
    })
    .sort((a, b) => a.source.localeCompare(b.source));
}

async function persistRows(rows: ScraperTelemetryRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const supabase = createServiceClient();
  if (!supabase) throw new Error("supabase service client unavailable");
  const ingestedAt = new Date().toISOString();

  const { error } = await supabase.from("scraper_telemetry").upsert(
    rows.map((row) => ({
      date: row.date,
      source: row.source,
      rows_added: row.rows_added,
      runtime_seconds: row.runtime_seconds,
      runs: row.runs,
      ingested_at: ingestedAt,
    })),
    { onConflict: "date,source" },
  );
  if (error) {
    throw new Error(`scraper_telemetry upsert failed: ${error.message}`);
  }
  return rows.length;
}

export const scraperCostAudit = inngest.createFunction(
  {
    id: "scraper-cost-audit",
    name: "Cost: Per-scraper runtime + row telemetry",
    retries: 2,
  },
  { cron: "10 2 * * *" },
  async ({ step }) => {
    const targetDate = yesterdayIsoDate();

    const runtimeBySource = (await step.run("github-actions-runtime", async () =>
      pullGitHubScraperRuntime(targetDate),
    )) as RuntimeBySource;

    const rowsAddedBySource = (await step.run("row-counts", async () => {
      const supabase = createServiceClient();
      if (!supabase) throw new Error("supabase service client unavailable");
      return countRowsAddedBySource(supabase, targetDate);
    })) as RowsAddedBySource;

    const rows = buildScraperTelemetryRows(
      targetDate,
      SCRAPER_CONFIGS,
      rowsAddedBySource,
      runtimeBySource,
    );
    const persisted = await step.run("persist", async () => persistRows(rows));

    logger.info("scraper-cost-audit: complete", {
      date: targetDate,
      sources: rows.length,
      persistedRows: persisted,
      zeroRowSources: rows.filter((row) => row.rows_added === 0).length,
    });

    return {
      date: targetDate,
      sources: rows.length,
      persistedRows: persisted,
    };
  },
);
