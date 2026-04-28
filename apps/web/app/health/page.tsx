import { Suspense } from "react";
import { ShieldCheck, Puzzle, Plug, Zap, Globe } from "lucide-react";
import { createServiceClient } from "@askarthur/supabase/server";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import UniversalScanner from "@/components/UniversalScanner";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Security Scanner | Ask Arthur",
  description:
    "Free security scanner for websites, Chrome extensions, MCP servers, and AI skills. Get a safety grade in seconds with actionable recommendations.",
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  website: <Globe size={14} className="shrink-0" />,
  extension: <Puzzle size={14} className="shrink-0" />,
  "mcp-server": <Plug size={14} className="shrink-0" />,
  skill: <Zap size={14} className="shrink-0" />,
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
  B: "bg-teal-100 text-teal-800",
  C: "bg-amber-100 text-amber-800",
  D: "bg-orange-100 text-orange-800",
  F: "bg-red-100 text-red-800",
};

interface RecentScan {
  id: string;
  scan_type: string;
  target: string;
  target_display: string | null;
  grade: string;
  overall_score: number;
  share_token: string | null;
  scanned_at: string;
}

async function getRecentScans(): Promise<RecentScan[]> {
  const supabase = createServiceClient();
  if (!supabase) return [];

  const results: RecentScan[] = [];

  // Pull from unified scan_results
  const { data: scanData } = await supabase
    .from("scan_results")
    .select("id, scan_type, target, target_display, grade, overall_score, share_token, scanned_at")
    .eq("visibility", "public")
    .order("scanned_at", { ascending: false })
    .limit(20);

  if (scanData) {
    results.push(...scanData.map((s) => ({ ...s, id: `sr-${s.id}` })));
  }

  // Pull from legacy site_audits (website scans)
  const { data: siteData } = await supabase
    .from("site_audits")
    .select("id, overall_score, grade, scanned_at, share_token, site_id, sites!inner(domain)")
    .order("scanned_at", { ascending: false })
    .limit(20);

  if (siteData) {
    for (const s of siteData) {
      const site = s.sites as unknown as { domain: string };
      results.push({
        id: `sa-${s.id}`,
        scan_type: "website",
        target: site.domain,
        target_display: site.domain,
        grade: s.grade,
        overall_score: s.overall_score,
        share_token: s.share_token,
        scanned_at: s.scanned_at,
      });
    }
  }

  // Sort combined by date, take top 20
  results.sort((a, b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime());
  return results.slice(0, 20);
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export default async function ScannerPage() {
  const recentScans = await getRecentScans();

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />

      <main id="main-content" className="flex-1 w-full max-w-[640px] mx-auto px-5 pt-16">
        <h1 className="text-deep-navy text-4xl md:text-5xl font-extrabold mb-4 leading-tight text-center">
          Security Scanner
        </h1>
        <p className="text-lg text-gov-slate mb-10 leading-relaxed text-center">
          Scan any website, Chrome extension, MCP server, or AI skill.
          Get a safety grade with actionable recommendations.
        </p>

        <Suspense>
          <UniversalScanner />
        </Suspense>

        {/* Feature grid */}
        <section className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="text-center">
            <ShieldCheck className="text-deep-navy mb-3 mx-auto" size={28} />
            <h3 className="text-deep-navy font-bold text-xs uppercase tracking-widest mb-1">
              Websites
            </h3>
            <p className="text-gov-slate text-sm leading-relaxed">
              Headers, TLS, CSP, email security, and more.
            </p>
          </div>
          <div className="text-center">
            <Puzzle className="text-deep-navy mb-3 mx-auto" size={28} />
            <h3 className="text-deep-navy font-bold text-xs uppercase tracking-widest mb-1">
              Extensions
            </h3>
            <p className="text-gov-slate text-sm leading-relaxed">
              Permissions, AI targeting, request interception.
            </p>
          </div>
          <div className="text-center">
            <Plug className="text-deep-navy mb-3 mx-auto" size={28} />
            <h3 className="text-deep-navy font-bold text-xs uppercase tracking-widest mb-1">
              MCP Servers
            </h3>
            <p className="text-gov-slate text-sm leading-relaxed">
              Tool poisoning, supply chain, secret exposure.
            </p>
          </div>
          <div className="text-center">
            <Zap className="text-deep-navy mb-3 mx-auto" size={28} />
            <h3 className="text-deep-navy font-bold text-xs uppercase tracking-widest mb-1">
              AI Skills
            </h3>
            <p className="text-gov-slate text-sm leading-relaxed">
              Prompt injection, malware, data exfiltration.
            </p>
          </div>
        </section>

        {/* Recent scans — persona-style cards, no heading */}
        {recentScans.length > 0 && (
          <section className="mt-12 pb-16 space-y-3">
            {recentScans.map((scan) => {
              const href =
                scan.scan_type === "website" && scan.share_token
                  ? `/scan/${scan.share_token}`
                  : scan.share_token
                    ? `/scan/result/${scan.share_token}`
                    : "#";

              return (
                <a
                  key={scan.id}
                  href={href}
                  className="flex items-center gap-4 p-4 bg-white border border-border-light rounded-xl shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all"
                >
                  <span
                    className={`inline-flex items-center justify-center w-10 h-10 rounded-lg text-sm font-bold shrink-0 ${GRADE_PILL[scan.grade] || "bg-slate-100 text-slate-600"}`}
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {scan.grade}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-deep-navy text-sm truncate">
                      {scan.target_display || scan.target}
                    </p>
                    <div className="flex items-center gap-1.5 text-xs text-gov-slate mt-0.5">
                      {TYPE_ICONS[scan.scan_type]}
                      <span>{TYPE_LABELS[scan.scan_type] || scan.scan_type}</span>
                      <span>&middot;</span>
                      <span>{relativeTime(scan.scanned_at)}</span>
                    </div>
                  </div>
                  <span
                    className="text-xs text-slate-400 shrink-0"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {scan.overall_score}/100
                  </span>
                </a>
              );
            })}
          </section>
        )}
      </main>

      <Footer />
    </div>
  );
}
