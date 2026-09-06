import { NextRequest, NextResponse } from "next/server";
import {
  BADGE_MESSAGES,
  badgeGradeColor,
  resolveBadgeSubject,
} from "@/lib/badge/eligibility";

function buildSvgBadge(
  _domain: string,
  grade: string,
  score: number
): string {
  const rightText = `${grade} (${score})`;
  const leftText = "Ask Arthur";
  const leftWidth = 80;
  const rightWidth = 70;
  const totalWidth = leftWidth + rightWidth;
  const color = badgeGradeColor(grade);

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

function buildNeutralBadge(label: string): string {
  const leftText = "Ask Arthur";
  const leftWidth = 80;
  const rightWidth = 110;
  const totalWidth = leftWidth + rightWidth;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${leftText}: ${label}">
  <title>${leftText}: ${label}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${leftWidth}" height="20" fill="#555"/>
    <rect x="${leftWidth}" width="${rightWidth}" height="20" fill="#9E9E9E"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
    <text x="${leftWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${leftText}</text>
    <text x="${leftWidth / 2}" y="14">${leftText}</text>
    <text x="${leftWidth + rightWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${label}</text>
    <text x="${leftWidth + rightWidth / 2}" y="14">${label}</text>
  </g>
</svg>`;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ domain: string }> }
) {
  const { domain } = await params;
  const decodedDomain = decodeURIComponent(domain);

  // The lookup, the eligibility rule and the wording live in
  // lib/badge/eligibility.ts. This route and /api/badge had separate copies,
  // and they disagreed on which grades earn a badge — see that module.
  const subject = await resolveBadgeSubject(decodedDomain);
  if (subject.kind !== "ok") {
    return new NextResponse(buildNeutralBadge(BADGE_MESSAGES[subject.kind]), {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate",
      },
    });
  }

  // B or better — show full grade badge
  const svg = buildSvgBadge(decodedDomain, subject.grade, subject.score);

  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control":
        "public, max-age=3600, s-maxage=86400, stale-while-revalidate",
    },
  });
}
