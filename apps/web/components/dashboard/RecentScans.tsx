import { Globe, Puzzle, Plug, Zap } from "lucide-react";
import type { RecentScan } from "@/lib/dashboard";

const TYPE_ICONS: Record<string, React.ReactNode> = {
  website: <Globe size={12} className="shrink-0" />,
  extension: <Puzzle size={12} className="shrink-0" />,
  "mcp-server": <Plug size={12} className="shrink-0" />,
  skill: <Zap size={12} className="shrink-0" />,
};

const GRADE_PILL: Record<string, string> = {
  "A+": "bg-emerald-100 text-emerald-800",
  A: "bg-emerald-100 text-emerald-800",
  B: "bg-teal-100 text-teal-800",
  C: "bg-amber-100 text-amber-800",
  D: "bg-orange-100 text-orange-800",
  F: "bg-red-100 text-red-800",
};

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function RecentScans({ scans }: { scans: RecentScan[] }) {
  if (scans.length === 0) return null;

  return (
    <div className="rounded-lg border border-slate-200/60 bg-white">
      <div className="border-b border-slate-100 px-5 py-3">
        <h3 className="text-sm font-semibold text-deep-navy">Recent Security Scans</h3>
      </div>

      <ul className="divide-y divide-slate-100/80">
        {scans.map((scan) => {
          const href = scan.scan_type === "website"
            ? `/scan/${scan.share_token}`
            : `/scan/result/${scan.share_token}`;

          return (
            <li key={`${scan.scan_type}-${scan.id}`}>
              <a
                href={href}
                className="flex items-center gap-3 px-5 py-2.5 hover:bg-slate-50/50 transition-colors"
              >
                <span
                  className={`inline-flex items-center justify-center w-8 h-8 rounded-lg text-xs font-bold shrink-0 ${GRADE_PILL[scan.grade] || "bg-slate-100 text-slate-600"}`}
                  style={{ fontVariantNumeric: "tabular-nums", fontFamily: "ui-monospace, monospace" }}
                >
                  {scan.grade}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-deep-navy truncate">
                    {scan.target_display || scan.target}
                  </p>
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mt-0.5">
                    {TYPE_ICONS[scan.scan_type]}
                    <span>{scan.scan_type}</span>
                    <span>&middot;</span>
                    <span>{relativeTime(scan.scanned_at)}</span>
                  </div>
                </div>
                <span
                  className="text-xs text-slate-400 shrink-0"
                  style={{ fontVariantNumeric: "tabular-nums", fontFamily: "ui-monospace, monospace" }}
                >
                  {scan.overall_score}/100
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
