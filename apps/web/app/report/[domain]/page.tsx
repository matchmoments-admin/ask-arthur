import { notFound } from "next/navigation";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import SiteAuditReport, {
  type CategoryScore,
  type CheckResult,
} from "@/components/SiteAuditReport";
import type { Metadata } from "next";
import { getLatestAuditByDomain } from "@/lib/report";

interface PageProps {
  params: Promise<{ domain: string }>;
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
    categories: audit.category_scores as CategoryScore[],
    checks: audit.test_results as CheckResult[],
    recommendations: audit.recommendations ?? [],
    ssl: null,
    rawHeaders: null,
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
