"use client";

import type { LucideIcon } from "lucide-react";
import { CircleX, Eye, TriangleAlert } from "lucide-react";
import ResultFeedback from "./result/ResultFeedback";
import ResultActionButtons from "./result/ResultActionButtons";
import type { ScammerContacts } from "@askarthur/types";

type Verdict = "SAFE" | "SUSPICIOUS" | "HIGH_RISK";

interface ResultCardProps {
  verdict: Verdict;
  confidence: number;
  summary: string;
  redFlags: string[];
  nextSteps: string[];
  countryCode?: string | null;
  deepfakeScore?: number;
  deepfakeProvider?: string;
  phoneRiskFlags?: string[];
  isVoipCaller?: boolean;
  scamType?: string;
  impersonatedBrand?: string;
  scammerContacts?: ScammerContacts;
  scammerUrls?: Array<{ url: string; isMalicious: boolean; sources: string[] }>;
  channel?: string;
  inputMode?: string;
  onCheckAnother?: () => void;
  contentHash?: string;
  analysisId?: string;
  scamReportId?: number;
}

interface VerdictStyle {
  baseTitle: string;
  icon: LucideIcon;
  chipBg: string;
  chipBorder: string;
  iconColor: string;
  flagBar: string;
}

// Token-driven verdict styling. Two amber levels (low-risk + suspicious) +
// red for high-risk. Never say "safe" — the lightest tier still nudges the
// user to verify. Tokens are defined in apps/web/app/globals.css:35–44.
const VERDICT_CONFIG: Record<Verdict, VerdictStyle> = {
  SAFE: {
    baseTitle: "No clear red flags — still proceed with caution",
    icon: Eye,
    chipBg: "bg-warn-bg/40",
    chipBorder: "border-warn-border/70",
    iconColor: "text-warn-text",
    flagBar: "bg-warn-text",
  },
  SUSPICIOUS: {
    baseTitle: "This looks suspicious",
    icon: TriangleAlert,
    chipBg: "bg-warn-bg",
    chipBorder: "border-warn-border",
    iconColor: "text-warn-heading",
    flagBar: "bg-warn-heading",
  },
  HIGH_RISK: {
    baseTitle: "This looks like a scam",
    icon: CircleX,
    chipBg: "bg-danger-bg",
    chipBorder: "border-danger-border",
    iconColor: "text-danger-text",
    flagBar: "bg-danger-text",
  },
};

function resolveTitle(verdict: Verdict, scamType: string | undefined): string {
  const base = VERDICT_CONFIG[verdict].baseTitle;
  if (verdict !== "HIGH_RISK") return base;
  const t = (scamType ?? "").trim().toLowerCase();
  if (!t || t === "none" || t === "unknown") return base;
  const withScam = /scam$/.test(t) ? t : `${t} scam`;
  return `This looks like a ${withScam}`;
}

// Claude currently returns redFlags as flat strings. Split on the first
// sentence boundary so we can render a bold heading + muted body like the
// competitor layout. Heuristic only — the upstream prompt can later return
// {heading, body} shapes and this helper retires.
function splitFlag(flag: string): { heading: string; body: string } {
  const trimmed = flag.trim();
  const match = trimmed.match(/^([^.:!?]+)[.:!?]\s+([\s\S]+)$/);
  if (match) {
    return { heading: match[1].trim(), body: match[2].trim() };
  }
  return { heading: trimmed, body: "" };
}

export default function ResultCard({
  verdict,
  redFlags,
  scamType,
  onCheckAnother,
  contentHash,
  analysisId,
  scamReportId,
}: ResultCardProps) {
  const config = VERDICT_CONFIG[verdict];
  const title = resolveTitle(verdict, scamType);
  const Icon = config.icon;
  const showReport = verdict !== "SAFE";

  async function handleReport() {
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verdictGiven: verdict,
          userSays: "user_reported",
          analysisId,
          scamReportId,
          contentHash,
          locale:
            typeof navigator !== "undefined"
              ? navigator.language || "en-AU"
              : "en-AU",
        }),
      });
    } catch {
      // Best-effort — matches ResultFeedback's fire-and-forget pattern.
    }
    if (typeof window !== "undefined") {
      window.open(
        "https://portal.scamwatch.gov.au/report-a-scam/",
        "_blank",
        "noopener,noreferrer",
      );
    }
  }

  const flagItems =
    redFlags.length > 0
      ? redFlags.map((f) => splitFlag(f))
      : [
          {
            heading: "Nothing obvious flagged",
            body: "No tool catches everything — verify through official channels before you act.",
          },
        ];

  return (
    <div
      role="alert"
      className="mt-6 rounded-lg border border-slate-200 bg-white px-5 py-5 sm:px-6 sm:py-6"
    >
      {/* Verdict chip */}
      <div
        className={`flex items-center gap-3 rounded-lg border-2 px-4 py-3 ${config.chipBg} ${config.chipBorder}`}
      >
        <Icon className={`${config.iconColor} shrink-0`} size={28} aria-hidden="true" />
        <h2 className="text-lg font-bold text-deep-navy leading-tight">
          {title}
        </h2>
      </div>

      {/* Red flag cards */}
      <ul className="mt-6 space-y-5">
        {flagItems.map((flag, i) => (
          <li key={i} className="flex gap-3">
            <span
              aria-hidden="true"
              className={`block w-1 rounded-full shrink-0 self-stretch ${config.flagBar}`}
            />
            <div>
              <p className="text-base font-bold text-deep-navy leading-snug mb-1">
                {flag.heading}
              </p>
              {flag.body && (
                <p className="text-base text-gov-slate leading-relaxed">
                  {flag.body}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>

      {/* Remember disclaimer */}
      <div className="mt-6 border-y border-slate-200 py-4">
        <p className="text-sm text-gov-slate leading-relaxed">
          <span className="font-bold text-deep-navy">Remember:</span>{" "}
          Arthur is a free resource to be used alongside your own research and
          best judgment. Always verify information through official channels
          and use caution when clicking links.
        </p>
      </div>

      {/* Thumbs feedback */}
      <ResultFeedback
        verdictGiven={verdict}
        analysisId={analysisId}
        scamReportId={scamReportId}
        contentHash={contentHash}
      />

      {/* Two-button footer */}
      {onCheckAnother && (
        <ResultActionButtons
          onCheckAnother={onCheckAnother}
          onReport={showReport ? handleReport : undefined}
          showReport={showReport}
        />
      )}
    </div>
  );
}
