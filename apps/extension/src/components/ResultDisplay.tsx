import type { AnalysisResult, ExtensionURLCheckResponse } from "@askarthur/types";
import { VerdictBadge } from "./VerdictBadge";

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
    return (
      <div className="rounded-lg border border-safe-border bg-safe-bg p-4">
        <div className="flex items-center gap-2">
          <span className="text-safe-heading font-semibold text-sm">
            No threats found
          </span>
        </div>
        <p className="mt-1 text-xs text-gov-slate">
          This URL hasn&apos;t been reported as a scam.
          {result.domain && (
            <> Domain: <strong>{result.domain}</strong></>
          )}
        </p>
        {result.safeBrowsing && !result.safeBrowsing.isMalicious && (
          <p className="mt-1 text-xs text-slate-400">
            Verified clean by Safe Browsing
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-danger-border bg-danger-bg p-4">
      <div className="flex items-center justify-between">
        <span className="text-danger-heading font-semibold text-sm">
          Threat detected
        </span>
        {result.threatLevel && (
          <VerdictBadge
            verdict={
              result.threatLevel === "HIGH"
                ? "HIGH_RISK"
                : result.threatLevel === "MEDIUM"
                  ? "SUSPICIOUS"
                  : "SAFE"
            }
          />
        )}
      </div>
      {result.domain && (
        <p className="mt-1 text-xs text-danger-text">
          Domain: <strong>{result.domain}</strong>
        </p>
      )}
      {result.reportCount && result.reportCount > 0 && (
        <p className="mt-1 text-xs text-danger-text">
          Reported {result.reportCount} time{result.reportCount > 1 ? "s" : ""}
        </p>
      )}
      {result.safeBrowsing?.isMalicious && (
        <p className="mt-1 text-xs text-danger-text">
          Flagged by: {result.safeBrowsing.sources.join(", ")}
        </p>
      )}
    </div>
  );
}

function TextResult({ result }: { result: AnalysisResult }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <VerdictBadge verdict={result.verdict} />
        <span className="text-xs text-slate-400">
          {Math.round(result.confidence * 100)}% confidence
        </span>
      </div>

      <p className="text-sm text-foreground">{result.summary}</p>

      {result.redFlags.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gov-slate uppercase tracking-wide mb-1">
            Red Flags
          </h4>
          <ul className="space-y-1">
            {result.redFlags.map((flag, i) => (
              <li
                key={i}
                className="flex items-start gap-1.5 text-xs text-danger-text"
              >
                <span className="mt-0.5 shrink-0">&#x26A0;</span>
                <span>{flag}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.nextSteps.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gov-slate uppercase tracking-wide mb-1">
            What to do
          </h4>
          <ul className="space-y-1">
            {result.nextSteps.map((step, i) => (
              <li
                key={i}
                className="flex items-start gap-1.5 text-xs text-gov-slate"
              >
                <span className="mt-0.5 shrink-0">&rarr;</span>
                <span>{step}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
