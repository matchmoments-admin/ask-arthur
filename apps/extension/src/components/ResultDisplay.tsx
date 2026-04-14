import type { AnalysisResult, Verdict, ExtensionURLCheckResponse } from "@askarthur/types";
import { ShieldCheck, TriangleAlert, Gauge, ExternalLink } from "lucide-react";
import { VerdictHeader, VERDICT_CONFIG } from "./VerdictBadge";

const VERDICT_COLORS: Record<Verdict, string> = {
  SAFE: "#16A34A",
  SUSPICIOUS: "#EA580C",
  HIGH_RISK: "#DC2626",
  UNCERTAIN: "#64748B",
};

interface URLResultProps {
  type: "url";
  result: ExtensionURLCheckResponse;
}

interface TextResultProps {
  type: "text";
  result: AnalysisResult;
}

type ResultDisplayProps = URLResultProps | TextResultProps;

export function ResultDisplay(props: ResultDisplayProps) {
  if (props.type === "url") {
    return <URLResult result={props.result} />;
  }
  return <TextResult result={props.result} />;
}

function URLResult({ result }: { result: ExtensionURLCheckResponse }) {
  if (!result.found) {
    // Safe — use the same card structure as web app
    return (
      <div role="alert" className="rounded-[10px] border border-border overflow-hidden">
        <div className="bg-safe px-4 py-3 flex items-center gap-2 rounded-t-[10px]">
          <ShieldCheck size={20} className="text-white" />
          <h2 className="text-[13px] font-semibold text-white">No Threats Found</h2>
        </div>
        <div className="bg-background px-4 py-4">
          <p className="text-text-primary text-[13px] leading-relaxed">
            This URL hasn&apos;t been reported as a scam.
          </p>
          {result.domain && (
            <p className="text-text-secondary text-[13px] mt-1">
              Domain: <strong className="text-text-primary">{result.domain}</strong>
            </p>
          )}
          {result.safeBrowsing && !result.safeBrowsing.isMalicious && (
            <p className="text-text-muted text-[11px] mt-2">
              Verified clean by Google Safe Browsing
            </p>
          )}
        </div>
      </div>
    );
  }

  // Threat found — map threat level to verdict
  const verdict =
    result.threatLevel === "HIGH"
      ? "HIGH_RISK" as const
      : result.threatLevel === "MEDIUM"
        ? "SUSPICIOUS" as const
        : "SAFE" as const;

  const config = VERDICT_CONFIG[verdict];

  return (
    <div role="alert" className="rounded-[10px] border border-border overflow-hidden">
      <div className={`${config.bg} px-4 py-3 flex items-center gap-2 rounded-t-[10px]`}>
        <config.icon size={20} className="text-white" />
        <h2 className="text-[13px] font-semibold text-white">Threat Detected</h2>
      </div>
      <div className="bg-background px-4 py-4">
        {result.domain && (
          <p className="text-text-primary text-[13px] leading-relaxed">
            Domain: <strong>{result.domain}</strong>
          </p>
        )}
        {result.reportCount && result.reportCount > 0 && (
          <p className="text-text-secondary text-[13px] mt-1">
            Reported {result.reportCount} time{result.reportCount > 1 ? "s" : ""}
          </p>
        )}
        {result.safeBrowsing?.isMalicious && (
          <div className="flex items-start gap-2 mt-2">
            <TriangleAlert size={14} className="text-warn mt-0.5" />
            <span className="text-text-secondary text-[13px]">
              Flagged by {result.safeBrowsing.sources.join(" and ")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function TextResult({ result }: { result: AnalysisResult }) {
  const config = VERDICT_CONFIG[result.verdict];

  return (
    <div role="alert" className="rounded-[10px] border border-border overflow-hidden">
      {/* Colored header bar — matches web app ResultCard */}
      <VerdictHeader verdict={result.verdict} />

      {/* Body */}
      <div className="bg-background px-4 py-4">
        {/* Summary */}
        <p className="text-text-primary text-[13px] leading-relaxed mb-3">{result.summary}</p>

        {/* Confidence */}
        <div className={`flex items-center gap-2 mb-4 ${config.textColor}`}>
          <Gauge size={16} />
          <span className="text-[11px] font-semibold">
            {Math.round(result.confidence * 100)}% confidence
          </span>
        </div>

        {/* Red Flags — "What We Found" */}
        {result.redFlags.length > 0 && (
          <div className="mb-4">
            <h3 className="text-[11px] font-semibold text-text-primary mb-2">
              What We Found
            </h3>
            <ul className="space-y-1.5">
              {result.redFlags.map((flag, i) => (
                <li key={i} className="flex items-start gap-2 text-text-secondary text-[13px] leading-relaxed">
                  <span
                    className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: VERDICT_COLORS[result.verdict] }}
                  />
                  {flag}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Next Steps — "What To Do" */}
        {result.nextSteps.length > 0 && (
          <div>
            <h3 className="text-[11px] font-semibold text-text-primary mb-2">
              What To Do
            </h3>
            <ol className="space-y-1.5 list-decimal list-inside">
              {result.nextSteps.map((step, i) => (
                <li key={i} className="text-text-secondary text-[13px] leading-relaxed">
                  {step}
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Recommended security tools */}
        <SecurityToolRecommendations />

        {/* Disclaimer */}
        <div className="mt-4 pt-3 border-t border-border">
          <p className="text-[11px] text-text-muted leading-relaxed">
            This analysis is AI-generated and advisory only. Always exercise
            your own judgment.
          </p>
        </div>
      </div>
    </div>
  );
}

const SECURITY_TOOLS = [
  { name: "1Password", url: "https://1password.com/askarthur", desc: "Unique passwords for every account" },
  { name: "NordVPN", url: "https://nordvpn.com/askarthur", desc: "Encrypt your connection" },
  { name: "Have I Been Pwned", url: "https://haveibeenpwned.com", desc: "Check for data breaches" },
];

function SecurityToolRecommendations() {
  return (
    <div className="mt-4 pt-3 border-t border-border">
      <h3 className="text-[11px] font-semibold text-text-primary mb-2">
        Recommended Security Tools
      </h3>
      <div className="space-y-1.5">
        {SECURITY_TOOLS.map((tool) => (
          <a
            key={tool.name}
            href={tool.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between text-[13px] text-text-secondary hover:text-primary transition-colors duration-150"
          >
            <span>
              <strong className="text-text-primary">{tool.name}</strong>
              <span className="text-[11px] text-text-muted ml-1.5">{tool.desc}</span>
            </span>
            <ExternalLink size={12} className="text-text-muted flex-shrink-0" />
          </a>
        ))}
      </div>
    </div>
  );
}
