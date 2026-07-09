import { requireAdmin } from "@/lib/adminAuth";
import { getNetcraftResults } from "@/lib/clone-watch/netcraft-results-data";

export const dynamic = "force-dynamic";

/**
 * Read-only admin panel for the Netcraft false-negative reporter.
 *
 * "Pending" = branded lookalikes that were submitted to Netcraft but not yet
 * issue-filed — i.e. what the dry-run reporter WOULD escalate. "Filed" = issues
 * already reported. No mutations here; the reporter runs on a cron. Watch this
 * during the dry-run window (NETCRAFT_ISSUE_DRY_RUN unset/true) before flipping
 * it live.
 */
export default async function NetcraftResultsPage() {
  await requireAdmin();
  const { pending, filed } = await getNetcraftResults();

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6">
          <h1 className="text-deep-navy text-3xl font-bold">Netcraft results</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gov-slate">
            Branded lookalikes we submitted to Netcraft whose per-URL verdict came
            back <code className="font-mono text-xs">no threats</code> /{" "}
            <code className="font-mono text-xs">unavailable</code> inside an
            otherwise-<code className="font-mono text-xs">malicious</code> batch —
            the hidden false negatives the reporter escalates via{" "}
            <code className="font-mono text-xs">report_issue</code>. Read-only;
            the reporter runs on a daily cron.
          </p>
          <div className="mt-4 flex gap-3 text-xs">
            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-900">
              {pending.length} pending submission{pending.length === 1 ? "" : "s"}
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-slate-700">
              {filed.length} filed
            </span>
          </div>
        </header>

        <section className="mb-10">
          <h2 className="text-deep-navy mb-3 text-lg font-semibold">
            Pending (would escalate)
          </h2>
          {pending.length === 0 ? (
            <p className="text-sm text-gov-slate">Nothing pending.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-left text-xs uppercase text-slate-600">
                  <tr>
                    <th className="px-4 py-2">Submission uuid</th>
                    <th className="px-4 py-2">Alerts</th>
                    <th className="px-4 py-2">Brands</th>
                    <th className="px-4 py-2">Sample URL</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((p) => (
                    <tr key={p.netcraft_uuid} className="border-t border-slate-100">
                      <td className="px-4 py-2 font-mono text-xs">
                        <a
                          className="text-action-teal underline"
                          href={`https://report.netcraft.com/submission/${p.netcraft_uuid}?tab=urls`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {p.netcraft_uuid.slice(0, 12)}…
                        </a>
                      </td>
                      <td className="px-4 py-2">{p.alertCount}</td>
                      <td className="px-4 py-2">{p.brands.join(", ")}</td>
                      <td className="px-4 py-2 font-mono text-xs">{p.sampleUrl}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <h2 className="text-deep-navy mb-3 text-lg font-semibold">Filed</h2>
          {filed.length === 0 ? (
            <p className="text-sm text-gov-slate">No issues filed yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-left text-xs uppercase text-slate-600">
                  <tr>
                    <th className="px-4 py-2">Domain</th>
                    <th className="px-4 py-2">Brand</th>
                    <th className="px-4 py-2">State</th>
                    <th className="px-4 py-2">Filed at</th>
                  </tr>
                </thead>
                <tbody>
                  {filed.map((f) => (
                    <tr key={f.id} className="border-t border-slate-100">
                      <td className="px-4 py-2 font-mono text-xs">{f.candidate_domain}</td>
                      <td className="px-4 py-2">{f.brand ?? "—"}</td>
                      <td className="px-4 py-2">{f.issue_url_state ?? "—"}</td>
                      <td className="px-4 py-2 text-xs text-slate-500">
                        {f.issue_reported_at
                          ? new Date(f.issue_reported_at).toLocaleString()
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
    </div>
  );
}
