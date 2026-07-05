"use client";

interface DayScan {
  day: string;
  scans: number;
}
interface TypeScan {
  day: string;
  input_type: string | null;
  scans: number;
}
interface NoScanRow {
  day: string;
  no_scan_visitors: number;
  total_visitors: number;
  no_scan_pct: number | null;
}
interface AttributedRow {
  event_type: string;
  source: string;
  medium: string | null;
  campaign: string | null;
  week: string;
  conversions: number;
}

interface Props {
  scans7: number;
  activationPct7: number | null;
  noScanPct7: number | null;
  b2bLeads7: number;
  contentReaders: number;
  readersWhoScanned: number;
  dailyScans: DayScan[];
  scansByType: TypeScan[];
  noScanRate: NoScanRow[];
  attributed: AttributedRow[];
}

const count = new Intl.NumberFormat("en-AU");
const pct = (n: number | null) => (n === null ? "—" : `${n.toFixed(1)}%`);

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-gov-slate text-xs font-semibold uppercase tracking-wide">{label}</div>
      <div className="text-deep-navy mt-1 text-2xl font-extrabold">{value}</div>
      {hint ? <div className="text-slate-400 mt-0.5 text-xs">{hint}</div> : null}
    </div>
  );
}

export default function AnalyticsDashboard({
  scans7,
  activationPct7,
  noScanPct7,
  b2bLeads7,
  contentReaders,
  readersWhoScanned,
  dailyScans,
  scansByType,
  noScanRate,
  attributed,
}: Props) {
  // Aggregate scans-by-type across the loaded window.
  const typeAgg = new Map<string, number>();
  for (const r of scansByType) {
    const k = r.input_type ?? "unknown";
    typeAgg.set(k, (typeAgg.get(k) ?? 0) + r.scans);
  }
  const typeRows = Array.from(typeAgg.entries()).sort((a, b) => b[1] - a[1]);

  const contentConvPct =
    contentReaders === 0 ? null : (100 * readersWhoScanned) / contentReaders;

  return (
    <div className="space-y-8">
      {/* Headline tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Scans (7d)" value={count.format(scans7)} hint="completed scans" />
        <StatTile
          label="Activation (7d)"
          value={pct(activationPct7)}
          hint="visitors who started a scan"
        />
        <StatTile
          label="No-scan rate (7d)"
          value={pct(noScanPct7)}
          hint="arrivers who never scanned — drive down"
        />
        <StatTile label="B2B leads (7d)" value={count.format(b2bLeads7)} hint="contact_submit — revenue KPI" />
      </div>

      {/* Content → scan funnel */}
      <section>
        <h2 className="text-deep-navy mb-2 text-sm font-bold">Content → scan bridge</h2>
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="Content readers" value={count.format(contentReaders)} hint="landed on /blog or /clone-watch" />
          <StatTile label="…who scanned" value={count.format(readersWhoScanned)} />
          <StatTile label="Conversion" value={pct(contentConvPct)} />
        </div>
      </section>

      {/* Scans by input type */}
      <section>
        <h2 className="text-deep-navy mb-2 text-sm font-bold">Scans by input type (window)</h2>
        {typeRows.length === 0 ? (
          <p className="text-slate-400 text-sm">No scan events yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-gov-slate">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Input type</th>
                  <th className="px-3 py-2 text-right font-semibold">Scans</th>
                </tr>
              </thead>
              <tbody>
                {typeRows.map(([type, n]) => (
                  <tr key={type} className="border-t border-slate-100">
                    <td className="px-3 py-2">{type}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{count.format(n)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* First-touch attributed conversions */}
      <section>
        <h2 className="text-deep-navy mb-2 text-sm font-bold">
          First-touch attributed conversions (by week)
        </h2>
        {attributed.length === 0 ? (
          <p className="text-slate-400 text-sm">No attributed conversions yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-gov-slate">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Week</th>
                  <th className="px-3 py-2 text-left font-semibold">Event</th>
                  <th className="px-3 py-2 text-left font-semibold">Source</th>
                  <th className="px-3 py-2 text-left font-semibold">Campaign</th>
                  <th className="px-3 py-2 text-right font-semibold">Conversions</th>
                </tr>
              </thead>
              <tbody>
                {attributed.slice(0, 60).map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-3 py-2 tabular-nums">{r.week}</td>
                    <td className="px-3 py-2">{r.event_type}</td>
                    <td className="px-3 py-2">{r.source}</td>
                    <td className="px-3 py-2">{r.campaign ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{count.format(r.conversions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* No-scan rate trend + daily scans, side by side on wide screens */}
      <section className="grid gap-6 md:grid-cols-2">
        <div>
          <h2 className="text-deep-navy mb-2 text-sm font-bold">No-scan visitor rate (daily)</h2>
          {noScanRate.length === 0 ? (
            <p className="text-slate-400 text-sm">No visitor data yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-gov-slate">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Day</th>
                    <th className="px-3 py-2 text-right font-semibold">Visitors</th>
                    <th className="px-3 py-2 text-right font-semibold">No-scan %</th>
                  </tr>
                </thead>
                <tbody>
                  {noScanRate.slice(0, 14).map((r) => (
                    <tr key={r.day} className="border-t border-slate-100">
                      <td className="px-3 py-2 tabular-nums">{r.day}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{count.format(r.total_visitors)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{pct(r.no_scan_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div>
          <h2 className="text-deep-navy mb-2 text-sm font-bold">Daily completed scans</h2>
          {dailyScans.length === 0 ? (
            <p className="text-slate-400 text-sm">No scan events yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-gov-slate">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Day</th>
                    <th className="px-3 py-2 text-right font-semibold">Scans</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyScans.slice(0, 14).map((r) => (
                    <tr key={r.day} className="border-t border-slate-100">
                      <td className="px-3 py-2 tabular-nums">{r.day}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{count.format(r.scans)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
