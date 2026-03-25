import { notFound } from "next/navigation";
import { createServiceClient } from "@askarthur/supabase/server";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import ScanResultReport from "@/components/ScanResultReport";
import type { UnifiedScanResult } from "@askarthur/types/scanner";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ token: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TYPE_LABELS: Record<string, string> = {
  extension: "Extension",
  "mcp-server": "MCP Server",
  skill: "AI Skill",
  website: "Website",
};

async function getScanByToken(token: string) {
  if (!UUID_RE.test(token)) return null;
  const supabase = createServiceClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("scan_results")
    .select("*")
    .eq("share_token", token)
    .single();

  if (error || !data) return null;
  return data;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const scan = await getScanByToken(token);
  if (!scan) return { title: "Scan Not Found | Ask Arthur" };

  const typeLabel = TYPE_LABELS[scan.scan_type] || scan.scan_type;
  const title = `${scan.target_display || scan.target} — Grade ${scan.grade} | Ask Arthur`;
  const description = `${typeLabel} security scan: Grade ${scan.grade}, Score ${scan.overall_score}/100.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{
        url: `/api/og/scan?type=${scan.scan_type}&target=${encodeURIComponent(scan.target_display || scan.target)}&grade=${scan.grade}&score=${scan.overall_score}`,
        width: 1200,
        height: 630,
      }],
    },
  };
}

export default async function ScanResultPage({ params }: PageProps) {
  const { token } = await params;
  const scan = await getScanByToken(token);
  if (!scan) notFound();

  const result = scan.result as unknown as UnifiedScanResult;
  const shareUrl = `https://askarthur.au/scan/result/${token}`;

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main id="main-content" className="flex-1 w-full max-w-[640px] mx-auto px-5 pt-12 pb-16">
        <ScanResultReport result={result} shareUrl={shareUrl} />
      </main>
      <Footer />
    </div>
  );
}
