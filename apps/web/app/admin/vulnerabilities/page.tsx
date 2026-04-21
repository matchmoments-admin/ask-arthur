import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";

export const dynamic = "force-dynamic";

interface CriticalRow {
  identifier: string;
  title: string;
  cvss_score: number | null;
  epss_score: number | null;
  epss_percentile: number | null;
  severity: string;
  category: string;
  affected_products: string[] | null;
  patched_in_versions: Array<{ product?: string; version?: string }> | null;
  published_at: string | null;
  cisa_kev: boolean;
  exploited_in_wild: boolean;
  lifecycle_status: string;
  banks_affected: string[] | null;
  gov_affected: string[] | null;
}

function epssLabel(score: number | null): string {
  if (score === null || score === undefined) return "—";
  // EPSS is a probability 0-1. Convert to "X% chance in 30d".
  return `${(score * 100).toFixed(1)}%`;
}

function epssColor(percentile: number | null): string {
  if (percentile === null || percentile === undefined) return "text-gov-slate";
  if (percentile >= 0.95) return "text-danger-text font-semibold";
  if (percentile >= 0.8) return "text-warn-text font-semibold";
  return "text-gov-slate";
}

interface IngestionRow {
  feed_name: string;
  status: string;
  records_fetched: number;
  records_new: number;
  records_updated: number;
  records_skipped: number;
  duration_ms: number | null;
  error_message: string | null;
  run_at: string;
}

const count = new Intl.NumberFormat("en-US");

function statusBadge(status: string): string {
  if (status === "success") return "bg-safe-green-bg text-safe-green";
  if (status === "partial") return "bg-warn-bg text-warn-text";
  return "bg-danger-bg text-danger-text";
}

function categoryLabel(c: string): string {
  const map: Record<string, string> = {
    web: "Web",
    app: "App",
    network: "Network",
    supply_chain: "Supply chain",
    mcp: "MCP",
    llm: "LLM",
    mobile: "Mobile",
    browser: "Browser",
    os: "OS",
    firmware: "Firmware",
    infra: "Infra",
    cloud: "Cloud",
    auth: "Auth",
    crypto: "Crypto",
  };
  return map[c] ?? c;
}

export default async function VulnerabilitiesPage() {
  await requireAdmin();

  const supabase = createServiceClient();
  let totalCount = 0;
  let kevCount = 0;
  let inWildCount = 0;
  let criticalRows: CriticalRow[] = [];
  let ingestionRows: IngestionRow[] = [];

  if (supabase) {
    const [totalRes, kevRes, wildRes, criticalRes, logRes] = await Promise.all([
      supabase.from("vulnerabilities").select("*", { count: "exact", head: true }),
      supabase.from("vulnerabilities").select("*", { count: "exact", head: true }).eq("cisa_kev", true),
      supabase.from("vulnerabilities").select("*", { count: "exact", head: true }).eq("exploited_in_wild", true),
      supabase
        .from("critical_vulnerabilities_au")
        .select("identifier, title, cvss_score, epss_score, epss_percentile, severity, category, affected_products, patched_in_versions, published_at, cisa_kev, exploited_in_wild, lifecycle_status, banks_affected, gov_affected")
        .limit(50),
      supabase
        .from("vulnerability_ingestion_log")
        .select("feed_name, status, records_fetched, records_new, records_updated, records_skipped, duration_ms, error_message, run_at")
        .order("run_at", { ascending: false })
        .limit(10),
    ]);

    totalCount = totalRes.count ?? 0;
    kevCount = kevRes.count ?? 0;
    inWildCount = wildRes.count ?? 0;
    criticalRows = (criticalRes.data ?? []) as unknown as CriticalRow[];
    ingestionRows = (logRes.data ?? []) as unknown as IngestionRow[];
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <h1 className="mb-1 text-xl font-extrabold text-deep-navy">Vulnerability intelligence</h1>
      <p className="mb-6 text-sm text-gov-slate">
        Phase 14 data asset. Weekly scrapers populate{" "}
        <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">vulnerabilities</code>{" "}
        — this dashboard lists the critical set (KEV or in-the-wild exploitation).
      </p>

      {/* Top-line counters */}
      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border-light bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-gov-slate">
            Total vulnerabilities
          </p>
          <p className="mt-1 text-2xl font-extrabold text-deep-navy">{count.format(totalCount)}</p>
        </div>
        <div className="rounded-xl border border-border-light bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-gov-slate">
            CISA KEV
          </p>
          <p className="mt-1 text-2xl font-extrabold text-deep-navy">{count.format(kevCount)}</p>
          <p className="mt-1 text-xs text-gov-slate">Known-exploited catalog</p>
        </div>
        <div className="rounded-xl border border-border-light bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-gov-slate">
            Exploited in wild
          </p>
          <p className="mt-1 text-2xl font-extrabold text-deep-navy">
            {count.format(inWildCount)}
          </p>
        </div>
      </div>

      {/* Recent ingestion runs */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gov-slate">
          Recent scraper runs
        </h2>
        {ingestionRows.length === 0 ? (
          <div className="rounded-xl border border-border-light bg-white p-5 text-sm text-gov-slate">
            No runs yet. Set{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">ENABLE_VULN_SCRAPER=true</code>{" "}
            in GitHub repo variables, or trigger{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">scrape-vulnerabilities.yml</code>{" "}
            via <em>workflow_dispatch</em>.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border-light bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-gov-slate">
                <tr>
                  <th className="px-4 py-3 font-semibold">Feed</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">New</th>
                  <th className="px-4 py-3 font-semibold">Updated</th>
                  <th className="px-4 py-3 font-semibold">Skipped</th>
                  <th className="px-4 py-3 font-semibold">Duration</th>
                  <th className="px-4 py-3 font-semibold">Run at</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light">
                {ingestionRows.map((r, i) => (
                  <tr key={i}>
                    <td className="px-4 py-3 font-mono text-xs">{r.feed_name}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusBadge(r.status)}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">{count.format(r.records_new)}</td>
                    <td className="px-4 py-3">{count.format(r.records_updated)}</td>
                    <td className="px-4 py-3">{count.format(r.records_skipped)}</td>
                    <td className="px-4 py-3 text-gov-slate">
                      {r.duration_ms ? `${Math.round(r.duration_ms / 1000)}s` : "—"}
                    </td>
                    <td className="px-4 py-3 text-gov-slate">
                      {new Date(r.run_at).toISOString().replace("T", " ").slice(0, 19)}Z
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Critical vulns */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gov-slate">
          Critical vulnerabilities (KEV or in-wild, top 50 by EPSS)
        </h2>
        <p className="mb-3 text-xs text-gov-slate">
          <strong>EPSS</strong> = FIRST.org Exploit Prediction Scoring System — probability this CVE
          will be exploited in the next 30 days. Rows highlighted when EPSS percentile ≥ 95% (top 5%
          riskiest) or ≥ 80%.
        </p>
        {criticalRows.length === 0 ? (
          <div className="rounded-xl border border-border-light bg-white p-5 text-sm text-gov-slate">
            No entries yet. First scraper run will populate this list.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border-light bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-gov-slate">
                <tr>
                  <th className="px-4 py-3 font-semibold">CVE</th>
                  <th className="px-4 py-3 font-semibold">Title</th>
                  <th className="px-4 py-3 font-semibold">CVSS</th>
                  <th className="px-4 py-3 font-semibold">EPSS</th>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 font-semibold">Flags</th>
                  <th className="px-4 py-3 font-semibold">Published</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light">
                {criticalRows.map((r) => (
                  <tr key={r.identifier}>
                    <td className="px-4 py-3 font-mono text-xs">
                      <a
                        href={`https://nvd.nist.gov/vuln/detail/${r.identifier}`}
                        className="text-deep-navy underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {r.identifier}
                      </a>
                    </td>
                    <td className="px-4 py-3">{r.title}</td>
                    <td className="px-4 py-3 font-semibold text-danger-text">
                      {r.cvss_score ?? "—"}
                    </td>
                    <td
                      className={`px-4 py-3 ${epssColor(r.epss_percentile)}`}
                      title={
                        r.epss_percentile !== null
                          ? `Percentile: ${(r.epss_percentile * 100).toFixed(1)}%`
                          : "Not in EPSS dataset"
                      }
                    >
                      {epssLabel(r.epss_score)}
                    </td>
                    <td className="px-4 py-3 text-gov-slate">{categoryLabel(r.category)}</td>
                    <td className="px-4 py-3 text-xs">
                      {r.cisa_kev && (
                        <span className="mr-1 rounded bg-danger-bg px-1.5 py-0.5 font-medium text-danger-text">
                          KEV
                        </span>
                      )}
                      {r.exploited_in_wild && (
                        <span className="mr-1 rounded bg-warn-bg px-1.5 py-0.5 font-medium text-warn-text">
                          in wild
                        </span>
                      )}
                      {r.lifecycle_status === "modified" && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-gov-slate">
                          modified
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gov-slate">
                      {r.published_at
                        ? new Date(r.published_at).toISOString().slice(0, 10)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
