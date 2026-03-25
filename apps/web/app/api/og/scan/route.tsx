import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

export const runtime = "edge";

const GRADE_COLORS: Record<string, { bg: string; ring: string }> = {
  "A+": { bg: "#ECFDF5", ring: "#388E3C" },
  A: { bg: "#ECFDF5", ring: "#388E3C" },
  "A-": { bg: "#ECFDF5", ring: "#4CAF50" },
  "B+": { bg: "#E0F7FA", ring: "#006B75" },
  B: { bg: "#E0F7FA", ring: "#006B75" },
  "B-": { bg: "#FFF8E1", ring: "#F57C00" },
  "C+": { bg: "#FFF8E1", ring: "#F57C00" },
  C: { bg: "#FFF8E1", ring: "#F57C00" },
  "C-": { bg: "#FFF3E0", ring: "#E65100" },
  D: { bg: "#FFF3E0", ring: "#E65100" },
  F: { bg: "#FEF2F2", ring: "#D32F2F" },
};

const TYPE_LABELS: Record<string, string> = {
  website: "Website Security Scan",
  extension: "Extension Security Scan",
  "mcp-server": "MCP Server Security Scan",
  skill: "AI Skill Security Scan",
};

const TYPE_EMOJI: Record<string, string> = {
  website: "🌐",
  extension: "🧩",
  "mcp-server": "🔌",
  skill: "⚡",
};

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const type = searchParams.get("type") || "website";
  const target = searchParams.get("target") || "unknown";
  const grade = searchParams.get("grade") || "F";
  const score = searchParams.get("score") || "0";

  const colors = GRADE_COLORS[grade] || GRADE_COLORS["F"];
  const typeLabel = TYPE_LABELS[type] || "Security Scan";
  const typeEmoji = TYPE_EMOJI[type] || "🔍";

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
          backgroundColor: "#001F3F",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* Grade ring */}
        <div
          style={{
            width: "160px",
            height: "160px",
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
          <span style={{ fontSize: "64px", fontWeight: 800, color: colors.ring, lineHeight: 1 }}>
            {grade}
          </span>
          <span style={{ fontSize: "16px", color: "#64748B", marginTop: "4px" }}>
            {score}/100
          </span>
        </div>

        {/* Type label */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
          <span style={{ fontSize: "20px" }}>{typeEmoji}</span>
          <span style={{ fontSize: "18px", color: "#6B8EA4", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em" }}>
            {typeLabel}
          </span>
        </div>

        {/* Target */}
        <span style={{ fontSize: "32px", fontWeight: 700, color: "#EFF4F8", maxWidth: "900px", textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {target}
        </span>

        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "40px" }}>
          <span style={{ fontSize: "14px", fontWeight: 700, color: "#E8B64A", letterSpacing: "0.15em", textTransform: "uppercase" }}>
            Ask Arthur
          </span>
          <span style={{ fontSize: "14px", color: "#6B8EA4" }}>
            — askarthur.au
          </span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
