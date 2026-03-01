import { notFound } from "next/navigation";
import { createServiceClient } from "@askarthur/supabase/server";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import SiteAuditReport from "@/components/SiteAuditReport";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ domain: string }>;
}

async function getLatestAuditByDomain(domain: string) {
  const supabase = createServiceClient();
  if (!supabase) return null;

  // Look up the site by domain
  const { data: site, error: siteError } = await supabase
    .from("sites")
    .select("id, domain, normalized_url")
    .eq("domain", domain)
    .single();

  if (siteError || !site) return null;

  // Get the latest audit for this site
  const { data: audit, error: auditError } = await supabase
    .from("site_audits")
    .select(
      "id, overall_score, grade, test_results, category_scores, recommendations, duration_ms, scanned_at, share_token"
    )
    .eq("site_id", site.id)
    .order("scanned_at", { ascending: false })
    .limit(1)
    .single();

  if (auditError || !audit) return null;

  return { site, audit };
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { domain } = await params;
  const decodedDomain = decodeURIComponent(domain);
  const data = await getLatestAuditByDomain(decodedDomain);

  if (!data) {
    return { title: `${decodedDomain} — Not Found | Ask Arthur` };
  }

  const title = `${data.site.domain} — Grade ${data.audit.grade} (${data.audit.overall_score}/100) | Ask Arthur`;
  const description = `Website health check for ${data.site.domain}. Grade: ${data.audit.grade}, Score: ${data.audit.overall_score}/100.`;

  return {
    title,
    description,
    alternates: {
      canonical: `https://askarthur.au/report/${data.site.domain}`,
    },
    openGraph: {
      title,
      description,
      images: [
        {
          url: `/api/og/audit?domain=${encodeURIComponent(data.site.domain)}&grade=${data.audit.grade}&score=${data.audit.overall_score}`,
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

export default async function ReportPage({ params }: PageProps) {
  const { domain } = await params;
  const decodedDomain = decodeURIComponent(domain);
  const data = await getLatestAuditByDomain(decodedDomain);
  if (!data) notFound();

  const { site, audit } = data;

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
    rawHeaders: (audit as any).raw_headers ?? null,
  };

  const shareUrl = audit.share_token
    ? `https://askarthur.au/scan/${audit.share_token}`
    : undefined;

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main
        id="main-content"
        className="flex-1 w-full max-w-[640px] mx-auto px-5 pt-16"
      >
        <h1 className="text-deep-navy text-3xl md:text-4xl font-extrabold mb-2 leading-tight text-center">
          Website Health Check
        </h1>
        <p className="text-sm text-gov-slate text-center mb-6">
          Latest scan:{" "}
          {new Date(audit.scanned_at).toLocaleDateString("en-AU")}
        </p>

        <SiteAuditReport result={result} shareUrl={shareUrl} />
      </main>
      <Footer />
    </div>
  );
}
