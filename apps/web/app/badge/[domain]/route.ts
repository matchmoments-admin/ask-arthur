import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";

const GRADE_COLORS: Record<string, string> = {
  "A+": "#388E3C",
  A: "#388E3C",
  B: "#006B75",
  C: "#F57C00",
  D: "#E65100",
  F: "#D32F2F",
};

function buildSvgBadge(
  domain: string,
  grade: string,
  score: number
): string {
  const rightText = `${grade} (${score})`;
  const leftText = "Ask Arthur";
  const leftWidth = 80;
  const rightWidth = 70;
  const totalWidth = leftWidth + rightWidth;
  const color = GRADE_COLORS[grade] || GRADE_COLORS["F"];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${leftText}: ${rightText}">
  <title>${leftText}: ${rightText}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${leftWidth}" height="20" fill="#555"/>
    <rect x="${leftWidth}" width="${rightWidth}" height="20" fill="${color}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
    <text x="${leftWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${leftText}</text>
    <text x="${leftWidth / 2}" y="14">${leftText}</text>
    <text x="${leftWidth + rightWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${rightText}</text>
    <text x="${leftWidth + rightWidth / 2}" y="14">${rightText}</text>
  </g>
</svg>`;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ domain: string }> }
) {
  const { domain } = await params;
  const decodedDomain = decodeURIComponent(domain);

  const supabase = createServiceClient();
  if (!supabase) {
    return new NextResponse("Service unavailable", { status: 503 });
  }

  const { data: site, error } = await supabase
    .from("sites")
    .select("latest_grade, latest_score")
    .eq("domain", decodedDomain)
    .single();

  if (error || !site || !site.latest_grade || site.latest_score == null) {
    return new NextResponse("Domain not found", { status: 404 });
  }

  const svg = buildSvgBadge(
    decodedDomain,
    site.latest_grade,
    site.latest_score
  );

  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control":
        "public, max-age=3600, s-maxage=86400, stale-while-revalidate",
    },
  });
}
