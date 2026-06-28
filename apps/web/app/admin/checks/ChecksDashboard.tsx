"use client";

import type { ChecksRow, ChecksTotals, ReconRow, Rollups } from "./page";
import ChecksTable from "./ChecksTable";

interface Props {
  rows: ChecksRow[];
  rollups: Rollups;
  recon: ReconRow[];
  totals: ChecksTotals;
  days: number;
}

export default function ChecksDashboard({ rows, rollups, recon, totals, days }: Props) {
  return (
    <div className="space-y-6">
      {/* Headline reconciliation: the homepage counter vs stored evidence. */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Homepage counter" value={totals.counterAllTime} hint="check_stats sum" />
          <Stat label="Stored (hot)" value={totals.storedHot} hint="scam_reports" />
          <Stat label="Stored (archive)" value={totals.storedArchive} hint="scam_reports_archive" />
          <Stat
            label="Residual"
            value={totals.residual}
            hint="counter − hot − archive"
            tone={totals.residual !== 0 ? "warn" : undefined}
          />
        </div>
        <p className="mt-3 text-xs text-gov-slate">
          The residual is <strong>expected</strong>, not data loss. The counter is bumped by{" "}
          <code className="font-mono">increment_check_stats()</code> on every analyze call,
          while <code className="font-mono">create_scam_report</code> is a separate{" "}
          <code className="font-mono">ON CONFLICT(idempotency_key)</code> insert that can
          early-return (replays, and some image-only SAFE uploads that never persist a row).
        </p>
      </div>

      {/* Rollups. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <RollupCard title="By source" counts={rollups.bySource} />
        <RollupCard title="By verdict" counts={rollups.byVerdict} />
      </div>

      {/* Per-day reconciliation. */}
      <div>
        <h2 className="text-deep-navy text-sm font-bold mb-2">
          Per-day reconciliation · last {days}d
        </h2>
        {recon.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-gov-slate text-sm">
            No activity in this window.
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-gov-slate">
                <tr>
                  <th className="px-3 py-2 text-left">Date (UTC)</th>
                  <th className="px-3 py-2 text-right">Counter</th>
                  <th className="px-3 py-2 text-right">Stored</th>
                  <th className="px-3 py-2 text-right">Delta</th>
                </tr>
              </thead>
              <tbody>
                {recon.map((r) => (
                  <tr key={r.date} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-mono text-xs text-deep-navy">{r.date}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{r.counterTotal}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{r.storedRows}</td>
                    <td
                      className={`px-3 py-2 text-right font-mono text-xs ${
                        r.delta !== 0 ? "text-amber-700 font-semibold" : "text-gov-slate"
                      }`}
                    >
                      {r.delta > 0 ? `+${r.delta}` : r.delta}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* The reports table. */}
      <div>
        <h2 className="text-deep-navy text-sm font-bold mb-2">
          Recent reports · last {days}d{rows.length === 100 ? " (capped at 100)" : ""}
        </h2>
        <ChecksTable rows={rows} />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint: string;
  tone?: "warn";
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-gov-slate">{label}</div>
      <div
        className={`text-2xl font-extrabold ${tone === "warn" ? "text-amber-700" : "text-deep-navy"}`}
      >
        {value.toLocaleString()}
      </div>
      <div className="text-[11px] text-gov-slate font-mono">{hint}</div>
    </div>
  );
}

function RollupCard({ title, counts }: { title: string; counts: Record<string, number> }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-gov-slate mb-2">{title}</div>
      {entries.length === 0 ? (
        <div className="text-sm text-gov-slate italic">no rows</div>
      ) : (
        <ul className="space-y-1">
          {entries.map(([k, v]) => (
            <li key={k} className="flex items-center justify-between text-sm">
              <span className="text-deep-navy">{k}</span>
              <span className="font-mono text-xs text-gov-slate">{v}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
