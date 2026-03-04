import { useState, useEffect, useCallback } from "react";
import type {
  ExtensionSecurityReport,
  ExtensionScanResult,
  CRXAnalysisResult,
} from "@askarthur/types";
import type { MessageResponse } from "@/lib/types";
import { ExtensionRiskBadge } from "./ExtensionRiskBadge";
import { PermissionRequest } from "./PermissionRequest";
import { LoadingSpinner } from "./LoadingSpinner";
import {
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Search,
  AlertTriangle,
} from "lucide-react";

export function ExtensionSecurityTab() {
  const [managementGranted, setManagementGranted] = useState<boolean | null>(
    null
  );
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [permissionLoading, setPermissionLoading] = useState(false);
  const [report, setReport] = useState<ExtensionSecurityReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check permission on mount
  useEffect(() => {
    chrome.permissions
      .contains({ permissions: ["management"] })
      .then((granted) => {
        setManagementGranted(granted);
        if (granted) {
          runScan();
        }
      });
  }, []);

  const runScan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response: MessageResponse = await chrome.runtime.sendMessage({
        type: "SCAN_EXTENSIONS",
      });
      if (response.success && response.data) {
        setReport(response.data as ExtensionSecurityReport);
      } else {
        setError(response.error || "Scan failed");
      }
    } catch {
      setError("Could not scan extensions. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleGrantPermission = useCallback(async () => {
    setPermissionLoading(true);
    setPermissionDenied(false);
    try {
      const granted = await chrome.permissions.request({
        permissions: ["management"],
      });
      setManagementGranted(granted);
      if (granted) {
        runScan();
      } else {
        setPermissionDenied(true);
      }
    } catch {
      setPermissionDenied(true);
    } finally {
      setPermissionLoading(false);
    }
  }, [runScan]);

  // Waiting for permission check
  if (managementGranted === null) {
    return <LoadingSpinner message="Checking permissions..." />;
  }

  // Permission gate
  if (!managementGranted) {
    return (
      <PermissionRequest
        onGrant={handleGrantPermission}
        denied={permissionDenied}
        loading={permissionLoading}
      />
    );
  }

  if (loading) {
    return <LoadingSpinner message="Scanning extensions..." />;
  }

  if (error) {
    return (
      <div className="p-4 bg-warn-bg border border-warn-border rounded-xl">
        <p className="text-warn-heading text-sm">{error}</p>
        <button
          onClick={runScan}
          className="mt-3 h-9 px-5 bg-deep-navy text-white font-semibold rounded-xl cta-glow hover:bg-navy transition-colors text-xs"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (!report) return null;

  // All safe
  if (report.overallRiskLevel === "LOW" && report.riskBreakdown.MEDIUM === 0) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl bg-green-50 border border-green-200 p-4 text-center space-y-2">
          <ShieldCheck size={32} className="mx-auto text-green-600" />
          <p className="text-sm font-semibold text-green-800">
            All extensions look safe
          </p>
          <p className="text-xs text-green-700">
            {report.totalExtensions} extension
            {report.totalExtensions !== 1 ? "s" : ""} scanned
            {report.enabledExtensions < report.totalExtensions &&
              ` (${report.enabledExtensions} enabled)`}
          </p>
        </div>
        <button
          onClick={runScan}
          className="w-full h-9 px-5 bg-white border border-border-default text-deep-navy font-semibold rounded-xl hover:bg-surface transition-colors text-xs"
        >
          Scan Again
        </button>
      </div>
    );
  }

  // Results with issues
  return (
    <div className="space-y-3">
      {/* Summary card */}
      <div className="rounded-xl card-shadow overflow-hidden">
        <div
          className={`px-4 py-3 flex items-center justify-between ${
            report.overallRiskLevel === "CRITICAL"
              ? "bg-red-600"
              : report.overallRiskLevel === "HIGH"
                ? "bg-red-500"
                : "bg-amber-500"
          }`}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-white" />
            <span className="text-sm font-semibold text-white">
              {report.riskBreakdown.CRITICAL + report.riskBreakdown.HIGH > 0
                ? `${report.riskBreakdown.CRITICAL + report.riskBreakdown.HIGH} risky extension${
                    report.riskBreakdown.CRITICAL + report.riskBreakdown.HIGH !== 1 ? "s" : ""
                  } found`
                : "Some extensions need attention"}
            </span>
          </div>
          <ExtensionRiskBadge level={report.overallRiskLevel} />
        </div>
        <div className="bg-white px-4 py-3">
          <div className="flex gap-4 text-xs text-gov-slate">
            <span>
              <strong className="text-deep-navy">{report.totalExtensions}</strong>{" "}
              total
            </span>
            <span>
              <strong className="text-deep-navy">{report.enabledExtensions}</strong>{" "}
              enabled
            </span>
            {report.riskBreakdown.CRITICAL > 0 && (
              <span className="text-red-600 font-semibold">
                {report.riskBreakdown.CRITICAL} critical
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Extension list */}
      <div className="space-y-2">
        {report.extensions.map((ext) => (
          <ExtensionItem key={ext.id} extension={ext} />
        ))}
      </div>

      <button
        onClick={runScan}
        className="w-full h-9 px-5 bg-white border border-border-default text-deep-navy font-semibold rounded-xl hover:bg-surface transition-colors text-xs"
      >
        Scan Again
      </button>
    </div>
  );
}

function ExtensionItem({ extension }: { extension: ExtensionScanResult }) {
  const [expanded, setExpanded] = useState(false);
  const [deepScanLoading, setDeepScanLoading] = useState(false);
  const [deepScanResult, setDeepScanResult] = useState<CRXAnalysisResult | null>(null);

  const handleDeepScan = async () => {
    setDeepScanLoading(true);
    try {
      const response: MessageResponse = await chrome.runtime.sendMessage({
        type: "DEEP_SCAN_EXTENSIONS",
        extensions: [
          {
            id: extension.id,
            name: extension.name,
            version: extension.version,
          },
        ],
      });
      if (response.success && response.data) {
        const results = response.data as CRXAnalysisResult[];
        setDeepScanResult(results[0] ?? null);
      }
    } catch {
      // Silently fail
    } finally {
      setDeepScanLoading(false);
    }
  };

  const isRisky =
    extension.riskLevel === "HIGH" || extension.riskLevel === "CRITICAL";

  return (
    <div
      className={`rounded-xl border overflow-hidden ${
        extension.isKnownMalicious
          ? "border-red-300 bg-red-50"
          : isRisky
            ? "border-amber-200 bg-amber-50"
            : "border-border-default bg-white"
      }`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2.5 flex items-center gap-2.5 text-left"
      >
        {extension.iconUrl?.startsWith("chrome-extension://") ? (
          <img
            src={extension.iconUrl}
            alt=""
            className="w-6 h-6 rounded flex-shrink-0"
          />
        ) : (
          <div className="w-6 h-6 rounded bg-slate-200 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-deep-navy truncate">
              {extension.name}
            </span>
            {!extension.enabled && (
              <span className="text-[10px] text-slate-400">(disabled)</span>
            )}
          </div>
          <span className="text-[10px] text-slate-400">
            v{extension.version}
          </span>
        </div>
        <ExtensionRiskBadge level={extension.riskLevel} />
        {expanded ? (
          <ChevronUp size={14} className="text-slate-400 flex-shrink-0" />
        ) : (
          <ChevronDown size={14} className="text-slate-400 flex-shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-border-default pt-2">
          {extension.isKnownMalicious && (
            <div className="flex items-start gap-2 text-red-700 bg-red-100 rounded-lg p-2">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <span className="text-xs font-semibold">
                This extension has been identified as malicious. Remove it
                immediately.
              </span>
            </div>
          )}

          {extension.riskFactors.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-deep-navy uppercase tracking-wide">
                Risk Factors
              </p>
              {extension.riskFactors.map((factor) => (
                <div key={factor.id} className="flex items-start gap-2">
                  <span
                    className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      factor.severity === "CRITICAL"
                        ? "bg-red-600"
                        : factor.severity === "HIGH"
                          ? "bg-red-400"
                          : factor.severity === "MEDIUM"
                            ? "bg-amber-500"
                            : "bg-green-500"
                    }`}
                  />
                  <div>
                    <p className="text-xs font-medium text-deep-navy">
                      {factor.label}
                    </p>
                    <p className="text-[10px] text-gov-slate">
                      {factor.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Deep scan results */}
          {deepScanResult && deepScanResult.additionalRiskFactors.length > 0 && (
            <div className="space-y-1.5 pt-1 border-t border-border-default">
              <p className="text-[10px] font-semibold text-deep-navy uppercase tracking-wide">
                Deep Scan Results
              </p>
              {deepScanResult.additionalRiskFactors.map((factor) => (
                <div key={factor.id} className="flex items-start gap-2">
                  <span
                    className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      factor.severity === "CRITICAL"
                        ? "bg-red-600"
                        : factor.severity === "HIGH"
                          ? "bg-red-400"
                          : factor.severity === "MEDIUM"
                            ? "bg-amber-500"
                            : "bg-green-500"
                    }`}
                  />
                  <div>
                    <p className="text-xs font-medium text-deep-navy">
                      {factor.label}
                    </p>
                    <p className="text-[10px] text-gov-slate">
                      {factor.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Deep scan button for risky extensions */}
          {isRisky && !deepScanResult && (
            <button
              onClick={handleDeepScan}
              disabled={deepScanLoading}
              className="w-full h-8 px-4 bg-deep-navy text-white font-semibold rounded-lg text-xs hover:bg-navy transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              <Search size={12} />
              {deepScanLoading ? "Analyzing..." : "Deep Scan"}
            </button>
          )}

          {/* Score */}
          <p className="text-[10px] text-slate-400">
            Risk score: {extension.riskScore}/100
          </p>
        </div>
      )}
    </div>
  );
}
