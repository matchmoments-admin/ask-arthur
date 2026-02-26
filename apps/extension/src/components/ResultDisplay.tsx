import type { AnalysisResult, Verdict, ExtensionURLCheckResponse } from "@askarthur/types";
import { VerdictHeader, VERDICT_CONFIG } from "./VerdictBadge";

const VERDICT_COLORS: Record<Verdict, string> = {
  SAFE: "#388E3C",
  SUSPICIOUS: "#F57C00",
  HIGH_RISK: "#D32F2F",
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
      <div role="alert" className="rounded-xl card-shadow overflow-hidden">
        <div className="bg-[#388E3C] px-4 py-3 flex items-center gap-2 rounded-t-xl">
          <span className="material-symbols-outlined text-white text-xl">verified_user</span>
          <h2 className="text-sm font-semibold text-white">No Threats Found</h2>
        </div>
        <div className="bg-white px-4 py-4">
          <p className="text-deep-navy text-sm leading-relaxed">
            This URL hasn&apos;t been reported as a scam.
          </p>
          {result.domain && (
            <p className="text-gov-slate text-sm mt-1">
              Domain: <strong className="text-deep-navy">{result.domain}</strong>
            </p>
          )}
          {result.safeBrowsing && !result.safeBrowsing.isMalicious && (
            <p className="text-slate-400 text-xs mt-2">
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
    <div role="alert" className="rounded-xl card-shadow overflow-hidden">
      <div className={`${config.bg} px-4 py-3 flex items-center gap-2 rounded-t-xl`}>
        <span className="material-symbols-outlined text-white text-xl">{config.icon}</span>
        <h2 className="text-sm font-semibold text-white">Threat Detected</h2>
      </div>
      <div className="bg-white px-4 py-4">
        {result.domain && (
          <p className="text-deep-navy text-sm leading-relaxed">
            Domain: <strong>{result.domain}</strong>
          </p>
        )}
        {result.reportCount && result.reportCount > 0 && (
          <p className="text-gov-slate text-sm mt-1">
            Reported {result.reportCount} time{result.reportCount > 1 ? "s" : ""}
          </p>
        )}
        {result.safeBrowsing?.isMalicious && (
          <div className="flex items-start gap-2 mt-2">
            <span className="material-symbols-outlined text-sm text-[#F57C00] mt-0.5">warning</span>
            <span className="text-gov-slate text-sm">
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
    <div role="alert" className="rounded-xl card-shadow overflow-hidden">
      {/* Colored header bar — matches web app ResultCard */}
      <VerdictHeader verdict={result.verdict} />

      {/* Body */}
      <div className="bg-white px-4 py-4">
        {/* Summary */}
        <p className="text-deep-navy text-sm leading-relaxed mb-3">{result.summary}</p>

        {/* Confidence */}
        <div className={`flex items-center gap-2 mb-4 ${config.textColor}`}>
          <span className="material-symbols-outlined text-base">speed</span>
          <span className="text-xs font-semibold">
            {Math.round(result.confidence * 100)}% confidence
          </span>
        </div>

        {/* Red Flags — "What We Found" */}
        {result.redFlags.length > 0 && (
          <div className="mb-4">
            <h3 className="text-xs font-semibold text-deep-navy mb-2">
              What We Found
            </h3>
            <ul className="space-y-1.5">
              {result.redFlags.map((flag, i) => (
                <li key={i} className="flex items-start gap-2 text-gov-slate text-sm leading-relaxed">
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
            <h3 className="text-xs font-semibold text-deep-navy mb-2">
              What To Do
            </h3>
            <ol className="space-y-1.5 list-decimal list-inside">
              {result.nextSteps.map((step, i) => (
                <li key={i} className="text-gov-slate text-sm leading-relaxed">
                  {step}
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Disclaimer */}
        <div className="mt-4 pt-3 border-t border-border-default">
          <p className="text-xs text-slate-400 leading-relaxed">
            This analysis is AI-generated and advisory only. Always exercise
            your own judgment.
          </p>
        </div>
      </div>
    </div>
  );
}
