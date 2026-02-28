import { notFound } from "next/navigation";
import { createServiceClient } from "@askarthur/supabase/server";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import SiteAuditReport from "@/components/SiteAuditReport";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ token: string }>;
}

async function getAuditByToken(token: string) {
  // Validate UUID format
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(token)) return null;

  const supabase = createServiceClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("site_audits")
    .select(
      "id, overall_score, grade, test_results, category_scores, recommendations, duration_ms, scanned_at, site_id, sites!inner(domain, normalized_url)"
    )
    .eq("share_token", token)
    .single();

  if (error || !data) return null;
  return data;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { token } = await params;
  const audit = await getAuditByToken(token);
  if (!audit) {
    return { title: "Scan Not Found | Ask Arthur" };
  }

  const site = audit.sites as unknown as {
    domain: string;
    normalized_url: string;
  };
  const title = `${site.domain} — Grade ${audit.grade} (${audit.overall_score}/100) | Ask Arthur`;
  const description = `Website safety audit for ${site.domain}. Grade: ${audit.grade}, Score: ${audit.overall_score}/100.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [
        {
          url: `/api/og/audit?domain=${encodeURIComponent(site.domain)}&grade=${audit.grade}&score=${audit.overall_score}`,
          width: 1200,
          height: 630,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function ScanPage({ params }: PageProps) {
  const { token } = await params;
  const audit = await getAuditByToken(token);
  if (!audit) notFound();

  const site = audit.sites as unknown as {
    domain: string;
    normalized_url: string;
  };

  const result = {
    url: site.normalized_url,
    domain: site.domain,
    scannedAt: audit.scanned_at,
    durationMs: audit.duration_ms ?? 0,
    overallScore: audit.overall_score,
    grade: audit.grade,
    categories: audit.category_scores as any[],
    checks: audit.test_results as any[],
    recommendations: audit.recommendations ?? [],
    ssl: null,
  };

  const shareUrl = `https://askarthur.au/scan/${token}`;

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main
        id="main-content"
        className="flex-1 w-full max-w-[640px] mx-auto px-5 pt-16"
      >
        <h1 className="text-deep-navy text-3xl md:text-4xl font-extrabold mb-2 leading-tight text-center">
          Website Safety Audit
        </h1>
        <p className="text-sm text-gov-slate text-center mb-6">
          Scanned {new Date(audit.scanned_at).toLocaleDateString("en-AU")}
        </p>

        <SiteAuditReport result={result} shareUrl={shareUrl} />
      </main>
      <Footer />
    </div>
  );
}
