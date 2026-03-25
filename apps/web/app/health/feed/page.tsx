import { createServiceClient } from "@askarthur/supabase/server";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { Globe, Puzzle, Plug, Zap } from "lucide-react";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Public Scan Feed | Ask Arthur",
  description: "Recent security scans across websites, Chrome extensions, MCP servers, and AI skills. See how they scored.",
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  website: <Globe size={14} />,
  extension: <Puzzle size={14} />,
  "mcp-server": <Plug size={14} />,
  skill: <Zap size={14} />,
};

const TYPE_LABELS: Record<string, string> = {
  website: "Website",
  extension: "Extension",
  "mcp-server": "MCP Server",
  skill: "AI Skill",
};

const GRADE_PILL: Record<string, string> = {
  "A+": "bg-green-100 text-green-800",
  A: "bg-green-100 text-green-800",
  "A-": "bg-green-50 text-green-700",
  "B+": "bg-teal-100 text-teal-800",
  B: "bg-teal-100 text-teal-800",
  "B-": "bg-amber-50 text-amber-700",
  "C+": "bg-amber-100 text-amber-800",
  C: "bg-amber-100 text-amber-800",
  "C-": "bg-orange-100 text-orange-800",
  D: "bg-orange-100 text-orange-800",
  F: "bg-red-100 text-red-800",
};

async function getRecentScans() {
  const supabase = createServiceClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("scan_results")
    .select("id, scan_type, target, target_display, overall_score, grade, share_token, scanned_at")
    .eq("visibility", "public")
    .order("scanned_at", { ascending: false })
    .limit(50);

  return data || [];
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default async function ScanFeedPage() {
  const scans = await getRecentScans();

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main id="main-content" className="flex-1 w-full max-w-[800px] mx-auto px-5 pt-16 pb-16">
        <h1 className="text-deep-navy text-3xl md:text-4xl font-extrabold mb-2 text-center">
          Public Scan Feed
        </h1>
        <p className="text-gov-slate text-center mb-10">
          Recent security scans across all platforms.
        </p>

        {scans.length === 0 ? (
          <p className="text-center text-slate-400 py-16">No public scans yet.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {scans.map((scan) => (
              <a
                key={scan.id}
                href={`/scan/result/${scan.share_token}`}
                className="flex items-center justify-between py-4 px-2 hover:bg-slate-50/50 transition-colors rounded-lg -mx-2"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`inline-flex items-center justify-center w-10 h-10 rounded-lg text-lg font-bold ${GRADE_PILL[scan.grade] || "bg-slate-100 text-slate-600"}`}
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {scan.grade}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-deep-navy truncate">
                      {scan.target_display || scan.target}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                      {TYPE_ICONS[scan.scan_type]}
                      <span>{TYPE_LABELS[scan.scan_type] || scan.scan_type}</span>
                      <span>&middot;</span>
                      <span>{relativeTime(scan.scanned_at)}</span>
                    </div>
                  </div>
                </div>
                <span className="text-xs text-slate-400 shrink-0" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {scan.overall_score}/100
                </span>
              </a>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
