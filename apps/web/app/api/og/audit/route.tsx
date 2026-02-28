import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

export const runtime = "edge";

const GRADE_COLORS: Record<string, { bg: string; ring: string }> = {
  "A+": { bg: "#ECFDF5", ring: "#388E3C" },
  A: { bg: "#ECFDF5", ring: "#388E3C" },
  B: { bg: "#E0F7FA", ring: "#006B75" },
  C: { bg: "#FFF8E1", ring: "#F57C00" },
  D: { bg: "#FFF3E0", ring: "#E65100" },
  F: { bg: "#FEF2F2", ring: "#D32F2F" },
};

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const domain = searchParams.get("domain") || "unknown";
  const grade = searchParams.get("grade") || "F";
  const score = searchParams.get("score") || "0";

  const colors = GRADE_COLORS[grade] || GRADE_COLORS["F"];

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0B1D3A",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* Grade ring */}
        <div
          style={{
            width: "180px",
            height: "180px",
            borderRadius: "50%",
            backgroundColor: colors.bg,
            border: `8px solid ${colors.ring}`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "24px",
          }}
        >
          <span
            style={{
              fontSize: "64px",
              fontWeight: 800,
              color: colors.ring,
              lineHeight: 1,
            }}
          >
            {grade}
          </span>
          <span
            style={{
              fontSize: "20px",
              color: "#64748B",
              fontWeight: 500,
            }}
          >
            {score}/100
          </span>
        </div>

        {/* Domain */}
        <span
          style={{
            fontSize: "42px",
            fontWeight: 800,
            color: "#FFFFFF",
            marginBottom: "8px",
          }}
        >
          {domain}
        </span>

        {/* Tagline */}
        <span
          style={{
            fontSize: "22px",
            color: "#94A3B8",
            marginBottom: "32px",
          }}
        >
          Website Safety Audit
        </span>

        {/* Branding */}
        <span
          style={{
            fontSize: "18px",
            color: "#64748B",
            letterSpacing: "0.1em",
            textTransform: "uppercase" as const,
          }}
        >
          Scanned by Ask Arthur
        </span>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        "Cache-Control":
          "public, max-age=3600, s-maxage=86400, stale-while-revalidate",
      },
    }
  );
}
