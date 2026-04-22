import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

type BadgeStyle = "shield" | "pill" | "cert";

const GRADE_COLORS: Record<string, string> = {
  "A+": "#388E3C", "A": "#388E3C", "A-": "#4CAF50",
  "B+": "#006B75", "B": "#006B75", "B-": "#008A98",
  "C+": "#F57C00", "C": "#F57C00", "C-": "#E65100",
  "D": "#D84315", "F": "#D32F2F",
};

function getGradeColor(grade: string): string {
  return GRADE_COLORS[grade] || "#D32F2F";
}

// ── Shield Badge (240x72, for website footers) ──

function shieldBadge(grade: string, _label: string): string {
  const color = getGradeColor(grade);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="72" viewBox="0 0 240 72">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#002B45"/>
      <stop offset="100%" stop-color="#001F3F"/>
    </linearGradient>
    <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}"/>
      <stop offset="100%" stop-color="${color}CC"/>
    </linearGradient>
  </defs>
  <rect width="240" height="72" rx="12" fill="url(#bg)"/>
  <rect x="1" y="1" width="238" height="70" rx="11" fill="none" stroke="#6B8EA4" stroke-opacity="0.3"/>
  <path d="M32 16 L44 22 L44 34 C44 42 38 48 32 52 C26 48 20 42 20 34 L20 22 Z" fill="url(#sg)" opacity="0.95"/>
  <text x="32" y="39" text-anchor="middle" font-size="14" font-weight="700" fill="#FFF" font-family="system-ui,sans-serif">${grade.length > 1 ? "✓" : "✓"}</text>
  <line x1="60" y1="16" x2="60" y2="56" stroke="#6B8EA4" stroke-opacity="0.25"/>
  <text x="72" y="30" font-size="10" font-weight="700" fill="#EFF4F8" letter-spacing="0.08em" font-family="system-ui,sans-serif">ASK ARTHUR</text>
  <text x="72" y="48" font-size="14" font-weight="600" fill="${color}" font-family="system-ui,sans-serif">Grade ${grade}</text>
  <rect x="12" y="68" width="216" height="2" rx="1" fill="#E8B64A" opacity="0.5"/>
</svg>`;
}

// ── Pill Badge (180x28, for README / inline) ──

function pillBadge(grade: string, score: number): string {
  const color = getGradeColor(grade);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="28" viewBox="0 0 180 28">
  <defs>
    <linearGradient id="lbl" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#002B45"/>
      <stop offset="100%" stop-color="#001F3F"/>
    </linearGradient>
  </defs>
  <rect width="110" height="28" rx="6" fill="url(#lbl)"/>
  <rect x="104" width="6" height="28" fill="url(#lbl)"/>
  <rect x="110" width="70" height="28" rx="6" fill="${color}"/>
  <rect x="110" width="6" height="28" fill="${color}"/>
  <text x="55" y="18" text-anchor="middle" font-size="11" font-weight="600" fill="#EFF4F8" font-family="system-ui,sans-serif">Ask Arthur</text>
  <text x="145" y="18" text-anchor="middle" font-size="11" font-weight="700" fill="#FFF" font-family="system-ui,sans-serif">${grade} · ${score}</text>
</svg>`;
}

// ── Certificate Badge (180x180, for trust pages) ──

function certBadge(grade: string, date: string): string {
  const color = getGradeColor(grade);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
  <defs>
    <linearGradient id="cbg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#002B45"/>
      <stop offset="100%" stop-color="#001F3F"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#E8B64A"/>
      <stop offset="50%" stop-color="#F5D78E"/>
      <stop offset="100%" stop-color="#E8B64A"/>
    </linearGradient>
  </defs>
  <circle cx="90" cy="90" r="88" fill="url(#cbg)"/>
  <circle cx="90" cy="90" r="82" fill="none" stroke="url(#gold)" stroke-width="2" opacity="0.7"/>
  <circle cx="90" cy="90" r="74" fill="none" stroke="#6B8EA4" stroke-width="0.5" opacity="0.3"/>
  <path d="M90 36 L116 50 L116 76 C116 94 104 108 90 118 C76 108 64 94 64 76 L64 50 Z" fill="none" stroke="url(#gold)" stroke-width="1.5"/>
  <text x="90" y="86" text-anchor="middle" font-size="26" font-weight="800" fill="${color}" font-family="system-ui,sans-serif">${grade}</text>
  <text x="90" y="138" text-anchor="middle" font-size="8" font-weight="700" fill="#EFF4F8" letter-spacing="0.15em" font-family="system-ui,sans-serif">ASK ARTHUR</text>
  <text x="90" y="152" text-anchor="middle" font-size="7" font-weight="500" fill="#E8B64A" letter-spacing="0.2em" font-family="system-ui,sans-serif">VERIFIED</text>
  <text x="90" y="166" text-anchor="middle" font-size="6.5" fill="#6B8EA4" font-family="system-ui,sans-serif">${date}</text>
</svg>`;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const grade = searchParams.get("grade") || "A+";
  const score = parseInt(searchParams.get("score") || "97", 10);
  const style = (searchParams.get("style") || "shield") as BadgeStyle;
  const label = searchParams.get("label") || "";
  const date = searchParams.get("date") || new Date().toISOString().split("T")[0];

  let svg: string;
  switch (style) {
    case "pill":
      svg = pillBadge(grade, score);
      break;
    case "cert":
      svg = certBadge(grade, date);
      break;
    default:
      svg = shieldBadge(grade, label);
  }

  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
