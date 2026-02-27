"use client";

import AuditGradeRing from "./AuditGradeRing";
import AuditCategoryCard from "./AuditCategoryCard";

interface CheckResult {
  id: string;
  category: string;
  label: string;
  status: string;
  score: number;
  maxScore: number;
  details: string;
}

interface CategoryScore {
  category: string;
  label: string;
  score: number;
  maxScore: number;
  grade: string;
  checks: CheckResult[];
}

interface SSLInfo {
  valid: boolean;
  issuer: string | null;
  daysRemaining: number | null;
  protocol: string | null;
}

export interface SiteAuditResult {
  url: string;
  domain: string;
  scannedAt: string;
  durationMs: number;
  overallScore: number;
  grade: string;
  categories: CategoryScore[];
  checks: CheckResult[];
  recommendations: string[];
  ssl: SSLInfo | null;
}

interface SiteAuditReportProps {
  result: SiteAuditResult;
}

const GRADE_HEADER_COLORS: Record<string, string> = {
  "A+": "bg-green-50 border-green-200",
  A: "bg-green-50 border-green-200",
  B: "bg-teal-50 border-teal-200",
  C: "bg-amber-50 border-amber-200",
  D: "bg-orange-50 border-orange-200",
  F: "bg-red-50 border-red-200",
};

export default function SiteAuditReport({ result }: SiteAuditReportProps) {
  const headerColor = GRADE_HEADER_COLORS[result.grade] || "bg-slate-50 border-slate-200";

  return (
    <div className="mt-8 space-y-6">
      {/* Grade header card */}
      <div className={`rounded-2xl border-2 p-6 ${headerColor}`}>
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <AuditGradeRing grade={result.grade} score={result.overallScore} />
          <div className="flex-1 text-center sm:text-left">
            <h2 className="text-xl font-extrabold text-deep-navy mb-1">
              {result.domain}
            </h2>
            <p className="text-sm text-gov-slate mb-2">{result.url}</p>
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 text-xs text-gov-slate">
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">schedule</span>
                {(result.durationMs / 1000).toFixed(1)}s
              </span>
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">checklist</span>
                {result.checks.length} checks
              </span>
              {result.ssl?.valid && (
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm">lock</span>
                  {result.ssl.protocol || "TLS"}
                  {result.ssl.daysRemaining != null && ` (${result.ssl.daysRemaining}d)`}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Category cards */}
      <div className="space-y-4">
        {result.categories
          .filter((cat) => cat.checks.length > 0)
          .map((cat) => (
            <AuditCategoryCard
              key={cat.category}
              label={cat.label}
              grade={cat.grade}
              score={cat.score}
              maxScore={cat.maxScore}
              checks={cat.checks}
            />
          ))}
      </div>

      {/* Recommendations */}
      {result.recommendations.length > 0 && (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-gray-200">
            <h3 className="text-sm font-bold text-deep-navy uppercase tracking-widest">
              Recommendations
            </h3>
          </div>
          <ol className="p-4 space-y-3">
            {result.recommendations.map((rec, i) => (
              <li key={i} className="flex gap-3 text-sm text-gov-slate leading-relaxed">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-deep-navy text-white text-xs font-bold flex items-center justify-center">
                  {i + 1}
                </span>
                {rec}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Disclaimer */}
      <p className="text-[11px] text-slate-400 text-center leading-relaxed">
        This scan checks publicly observable security configuration. It does not test for
        application-level vulnerabilities, perform penetration testing, or access any private data.
        Results are informational only.
      </p>
    </div>
  );
}
