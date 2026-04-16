"use client";

import { useState, useMemo } from "react";
import { Download, FileDown, ArrowUpDown } from "lucide-react";
import type { EvidenceItem } from "@/lib/dashboard/compliance";

const PRINCIPLES = [
  "All",
  "Prevent",
  "Detect",
  "Report",
  "Disrupt",
  "Respond",
  "Govern",
] as const;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function exportCsv(items: EvidenceItem[]) {
  const headers = ["Date", "Type", "Principle", "Description", "Details"];
  const rows = items.map((item) => [
    item.timestamp,
    item.type,
    item.principle,
    `"${item.description.replace(/"/g, '""')}"`,
    `"${item.details.replace(/"/g, '""')}"`,
  ]);

  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `compliance-evidence-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function EvidenceLog({ items }: { items: EvidenceItem[] }) {
  const [filter, setFilter] = useState<string>("All");
  const [sortAsc, setSortAsc] = useState(false);

  const filtered = useMemo(() => {
    let result = items;
    if (filter !== "All") {
      result = result.filter((item) => item.principle === filter);
    }
    return result.sort((a, b) => {
      const diff =
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      return sortAsc ? diff : -diff;
    });
  }, [items, filter, sortAsc]);

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gov-slate">
            Principle:
          </label>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="text-xs border border-border-light rounded-lg px-2 py-1.5 bg-white text-deep-navy focus:outline-none focus:ring-1 focus:ring-trust-teal"
          >
            {PRINCIPLES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => exportCsv(filtered)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-trust-teal hover:text-teal-700 transition-colors px-3 py-1.5 border border-trust-teal/30 rounded-lg hover:bg-teal-50"
          >
            <Download size={13} />
            Export CSV
          </button>
          <button
            onClick={() =>
              alert(
                "PDF export coming soon. Use CSV export for now."
              )
            }
            className="inline-flex items-center gap-1.5 text-xs font-medium text-gov-slate hover:text-deep-navy transition-colors px-3 py-1.5 border border-border-light rounded-lg hover:bg-slate-50"
          >
            <FileDown size={13} />
            Export PDF
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="border border-border-light rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 border-b border-border-light">
                <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-gov-slate">
                  <button
                    onClick={() => setSortAsc(!sortAsc)}
                    className="inline-flex items-center gap-1 hover:text-deep-navy"
                  >
                    Date
                    <ArrowUpDown size={10} />
                  </button>
                </th>
                <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-gov-slate">
                  Type
                </th>
                <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-gov-slate">
                  Principle
                </th>
                <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-gov-slate">
                  Description
                </th>
                <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-gov-slate hidden lg:table-cell">
                  Details
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100/80">
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-xs text-slate-400"
                  >
                    No evidence items match the selected filter.
                  </td>
                </tr>
              )}
              {filtered.map((item, i) => (
                <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                  <td
                    className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap"
                    style={{
                      fontVariantNumeric: "tabular-nums",
                      fontFamily: "ui-monospace, monospace",
                    }}
                  >
                    {formatDate(item.timestamp)}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="inline-block rounded-full bg-[#EFF4F8] px-2 py-0.5 text-[10px] font-medium text-gov-slate">
                      {item.type}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-xs font-medium text-deep-navy">
                      {item.principle}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gov-slate max-w-xs truncate">
                    {item.description}
                  </td>
                  <td className="px-4 py-2.5 text-[11px] text-slate-400 max-w-sm truncate hidden lg:table-cell">
                    {item.details}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[10px] text-slate-400 mt-2 text-right">
        Showing {filtered.length} of {items.length} evidence items
      </p>
    </div>
  );
}
