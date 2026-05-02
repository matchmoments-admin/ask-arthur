import { notFound } from "next/navigation";
import { createServiceClient } from "@askarthur/supabase/server";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import SiteAuditReport, {
  type CategoryScore,
  type CheckResult,
} from "@/components/SiteAuditReport";
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
      "id, overall_score, grade, test_results, category_scores, recommendations, recommendations_v2, partial, fetch_error, raw_headers, duration_ms, scanned_at, site_id, sites!inner(domain, normalized_url)"
    )
    .eq("share_token", token)
    .single();

  if (error || !data) return null;
  return data;
}

interface FetchErrorRow {
  type: "timeout" | "blocked" | "dns_error" | "tls_error" | "network_error";
  message: string;
}

interface RecommendationRow {
  text: string;
  severity: "critical" | "high" | "medium" | "low";
  snippet?: string;
}

function tryParseRecommendation(s: string): RecommendationRow | null {
  if (!s.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === "object" && typeof parsed.text === "string") {
      return parsed as RecommendationRow;
    }
  } catch {
    // fall through — treat as plain text
  }
  return null;
}

function pickRecommendations(
  v2: unknown,
  legacy: string[] | null | undefined
): (string | RecommendationRow)[] {
  if (Array.isArray(v2) && v2.length > 0) return v2 as RecommendationRow[];
  if (!legacy || legacy.length === 0) return [];
  // Legacy TEXT[] may contain JSON-stringified Recommendation objects from
  // the pre-v81 era when supabase-js coerced objects into JSON strings.
  return legacy.map((s) => tryParseRecommendation(s) ?? s);
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
  const description = `Website health check for ${site.domain}. Grade: ${audit.grade}, Score: ${audit.overall_score}/100.`;

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
    categories: audit.category_scores as CategoryScore[],
    checks: audit.test_results as CheckResult[],
    recommendations: pickRecommendations(audit.recommendations_v2, audit.recommendations),
    ssl: null,
    rawHeaders: (audit.raw_headers as Record<string, string> | null) ?? null,
    partial: audit.partial ?? false,
    fetchError: (audit.fetch_error as FetchErrorRow | null) ?? null,
  };

  const shareUrl = `https://askarthur.au/scan/${token}`;

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main
        id="main-content"
        className="flex-1 w-full max-w-[880px] mx-auto px-5 pt-14 pb-24"
      >
        <SiteAuditReport result={result} shareUrl={shareUrl} />
      </main>
      <Footer />
    </div>
  );
}
