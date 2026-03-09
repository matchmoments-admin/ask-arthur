"use client";

import { useState } from "react";
import { Clock, ClipboardCheck, Lock, Link2, Share2, Code2, ChevronDown, AlertTriangle } from "lucide-react";
import AuditGradeRing from "./AuditGradeRing";
import AuditCategoryCard from "./AuditCategoryCard";
import AuditRawHeaders from "./AuditRawHeaders";

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

interface FetchError {
  type: "timeout" | "blocked" | "dns_error" | "tls_error" | "network_error";
  message: string;
}

interface Recommendation {
  text: string;
  severity: "critical" | "high" | "medium" | "low";
  snippet?: string;
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
  recommendations: (string | Recommendation)[];
  ssl: SSLInfo | null;
  rawHeaders: Record<string, string> | null;
  partial?: boolean;
  fetchError?: FetchError | null;
}

interface SiteAuditReportProps {
  result: SiteAuditResult;
  shareUrl?: string;
  previousScan?: { grade: string; score: number } | null;
}

const GRADE_HEADER_COLORS: Record<string, string> = {
  "A+": "bg-green-50 border-green-200",
  A: "bg-green-50 border-green-200",
  B: "bg-teal-50 border-teal-200",
  C: "bg-amber-50 border-amber-200",
  D: "bg-orange-50 border-orange-200",
  F: "bg-red-50 border-red-200",
};

const FETCH_ERROR_MESSAGES: Record<string, string> = {
  blocked: "This site's firewall blocked our scanner, but we still checked what we could.",
  dns_error: "This domain doesn't appear to exist. We checked DNS records anyway.",
  timeout: "The site took too long to respond. Here's what we found via network checks.",
  tls_error: "SSL/TLS connection failed — this site may have a certificate problem. We still ran DNS checks.",
  network_error: "We couldn't connect to this site, but we checked what we could via DNS.",
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border-red-200",
  high: "bg-orange-100 text-orange-800 border-orange-200",
  medium: "bg-amber-100 text-amber-800 border-amber-200",
  low: "bg-blue-100 text-blue-800 border-blue-200",
};

function normalizeRecommendation(rec: string | Recommendation): Recommendation {
  if (typeof rec === "string") {
    return { text: rec, severity: "medium" };
  }
  return rec;
}

function PartialScanBanner({ fetchError }: { fetchError: FetchError }) {
  const message = FETCH_ERROR_MESSAGES[fetchError.type] || FETCH_ERROR_MESSAGES.network_error;

  return (
    <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-4 flex gap-3 items-start">
      <AlertTriangle className="text-amber-600 flex-shrink-0 mt-0.5" size={20} />
      <div>
        <p className="text-sm font-semibold text-amber-900">Partial Scan</p>
        <p className="text-sm text-amber-800 mt-0.5">{message}</p>
      </div>
    </div>
  );
}

function SeverityPill({ severity }: { severity: string }) {
  const colors = SEVERITY_COLORS[severity] || SEVERITY_COLORS.medium;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full border ${colors}`}>
      {severity}
    </span>
  );
}

function SnippetBlock({ snippet }: { snippet: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-action-teal font-semibold hover:underline flex items-center gap-1"
      >
        <Code2 size={12} />
        {expanded ? "Hide" : "Show"} fix
        <ChevronDown size={10} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <div className="mt-1.5 relative">
          <pre className="text-xs bg-slate-100 p-3 rounded-lg font-mono overflow-x-auto text-deep-navy whitespace-pre-wrap">
            {snippet}
          </pre>
          <button
            onClick={handleCopy}
            className="absolute top-2 right-2 text-[10px] font-bold uppercase tracking-widest px-2 py-1 bg-white border border-gray-200 rounded hover:bg-gray-50 transition-colors"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
}

function PreviousScanComparison({
  previous,
  current,
}: {
  previous: { grade: string; score: number };
  current: { grade: string; score: number };
}) {
  const diff = current.score - previous.score;
  const arrow = diff > 0 ? "\u2191" : diff < 0 ? "\u2193" : "\u2014";
  const color = diff > 0 ? "text-green-700" : diff < 0 ? "text-red-700" : "text-slate-500";

  return (
    <p className={`text-xs font-semibold ${color} mt-1`}>
      Previous scan: {previous.grade} ({previous.score}) → Today: {current.grade} ({current.score}) {arrow}
    </p>
  );
}

export default function SiteAuditReport({ result, shareUrl, previousScan }: SiteAuditReportProps) {
  const [copied, setCopied] = useState(false);
  const [showBadge, setShowBadge] = useState(false);
  const headerColor = GRADE_HEADER_COLORS[result.grade] || "bg-slate-50 border-slate-200";

  const badgeUrl = `https://askarthur.au/badge/${encodeURIComponent(result.domain)}`;
  const reportUrl = `https://askarthur.au/report/${encodeURIComponent(result.domain)}`;
  const badgeSnippet = `<a href="${reportUrl}"><img src="${badgeUrl}" alt="${result.domain} safety grade" /></a>`;

  function handleCopyLink() {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const twitterText = encodeURIComponent(
    `${result.domain} scored ${result.grade} (${result.overallScore}/100) on the Ask Arthur Website Health Check`
  );
  const twitterUrl = shareUrl
    ? `https://twitter.com/intent/tweet?text=${twitterText}&url=${encodeURIComponent(shareUrl)}`
    : null;
  const linkedInUrl = shareUrl
    ? `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`
    : null;

  const recommendations = result.recommendations.map(normalizeRecommendation);

  return (
    <div className="mt-8 space-y-6">
      {/* Partial scan banner */}
      {result.partial && result.fetchError && (
        <PartialScanBanner fetchError={result.fetchError} />
      )}

      {/* Grade header card */}
      <div className={`rounded-2xl border-2 p-6 ${headerColor}`}>
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <AuditGradeRing grade={result.grade} score={result.overallScore} />
          <div className="flex-1 text-center sm:text-left">
            <h2 className="text-xl font-extrabold text-deep-navy mb-1">
              {result.domain}
            </h2>
            <p className="text-sm text-gov-slate mb-2">{result.url}</p>
            {previousScan && (
              <PreviousScanComparison
                previous={previousScan}
                current={{ grade: result.grade, score: result.overallScore }}
              />
            )}
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 text-xs text-gov-slate">
              <span className="flex items-center gap-1">
                <Clock size={14} />
                {(result.durationMs / 1000).toFixed(1)}s
              </span>
              <span className="flex items-center gap-1">
                <ClipboardCheck size={14} />
                {result.checks.length} checks
              </span>
              {result.ssl?.valid && (
                <span className="flex items-center gap-1">
                  <Lock size={14} />
                  {result.ssl.protocol || "TLS"}
                  {result.ssl.daysRemaining != null && ` (${result.ssl.daysRemaining}d)`}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Share section */}
        {shareUrl && (
          <div className="mt-4 pt-4 border-t border-black/10 flex flex-wrap items-center justify-center sm:justify-start gap-2">
            <button
              onClick={handleCopyLink}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-widest bg-deep-navy text-white rounded-full hover:bg-navy transition-colors"
            >
              <Link2 size={12} />
              {copied ? "Copied!" : "Copy Link"}
            </button>
            {twitterUrl && (
              <a
                href={twitterUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-widest bg-white text-deep-navy border border-gray-200 rounded-full hover:bg-gray-50 transition-colors"
              >
                <Share2 size={12} />
                Twitter
              </a>
            )}
            {linkedInUrl && (
              <a
                href={linkedInUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-widest bg-white text-deep-navy border border-gray-200 rounded-full hover:bg-gray-50 transition-colors"
              >
                <Share2 size={12} />
                LinkedIn
              </a>
            )}
            <button
              onClick={() => setShowBadge(!showBadge)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-widest bg-white text-deep-navy border border-gray-200 rounded-full hover:bg-gray-50 transition-colors"
            >
              <Code2 size={12} />
              Badge
              <ChevronDown size={10} className={`transition-transform ${showBadge ? "rotate-180" : ""}`} />
            </button>
          </div>
        )}

        {/* Badge embed snippet */}
        {showBadge && (
          <div className="mt-3 p-3 bg-white/60 rounded-lg border border-black/10">
            <p className="text-xs text-gov-slate mb-2">
              Embed this badge on your site:
            </p>
            <code className="block text-xs bg-slate-100 p-2 rounded font-mono break-all text-deep-navy select-all">
              {badgeSnippet}
            </code>
          </div>
        )}
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

      {/* Raw Headers */}
      <AuditRawHeaders rawHeaders={result.rawHeaders} />

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-gray-200">
            <h3 className="text-sm font-bold text-deep-navy uppercase tracking-widest">
              Recommendations
            </h3>
          </div>
          <ol className="p-4 space-y-4">
            {recommendations.map((rec, i) => (
              <li key={i} className="flex gap-3 text-sm text-gov-slate">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-deep-navy text-white text-xs font-bold flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <div className="flex-1">
                  <div className="flex items-start gap-2">
                    <SeverityPill severity={rec.severity} />
                    <span className="leading-relaxed">{rec.text}</span>
                  </div>
                  {rec.snippet && <SnippetBlock snippet={rec.snippet} />}
                </div>
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
