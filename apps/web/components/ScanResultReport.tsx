"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  MinusCircle,
  Globe,
  Puzzle,
  Plug,
  Zap,
  Copy,
  Check,
  ShieldAlert,
} from "lucide-react";
import type { UnifiedScanResult, ScanCategory, ScanCheck, SecurityGrade } from "@askarthur/types/scanner";
import { GRADE_COLORS } from "@askarthur/types/scanner";

const STATUS_ICONS: Record<string, React.ReactNode> = {
  pass: <CheckCircle2 size={16} className="text-green-600 shrink-0" />,
  warn: <AlertTriangle size={16} className="text-amber-500 shrink-0" />,
  fail: <XCircle size={16} className="text-red-500 shrink-0" />,
  error: <MinusCircle size={16} className="text-slate-400 shrink-0" />,
  skipped: <MinusCircle size={16} className="text-slate-300 shrink-0" />,
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  website: <Globe size={16} />,
  extension: <Puzzle size={16} />,
  "mcp-server": <Plug size={16} />,
  skill: <Zap size={16} />,
};

const TYPE_LABELS: Record<string, string> = {
  website: "Website",
  extension: "Chrome Extension",
  "mcp-server": "MCP Server",
  skill: "AI Skill",
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: "border-l-red-500 bg-red-50/50",
  high: "border-l-orange-400 bg-orange-50/30",
  medium: "border-l-amber-400",
  low: "border-l-slate-300",
  info: "border-l-blue-300",
};

function GradeRing({ grade, score }: { grade: SecurityGrade; score: number }) {
  const colors = GRADE_COLORS[grade] || GRADE_COLORS["F"];
  return (
    <div
      className="w-28 h-28 rounded-full flex flex-col items-center justify-center border-4 shrink-0"
      style={{ borderColor: colors.border, backgroundColor: colors.bg }}
    >
      <span
        className="text-3xl font-extrabold leading-none"
        style={{ color: colors.text, fontVariantNumeric: "tabular-nums" }}
      >
        {grade}
      </span>
      <span className="text-xs text-slate-500 mt-1" style={{ fontVariantNumeric: "tabular-nums" }}>
        {score}/100
      </span>
    </div>
  );
}

function CategoryRow({ category, defaultOpen = false }: { category: ScanCategory; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const pct = category.maxScore > 0 ? Math.round((category.score / category.maxScore) * 100) : 100;
  const colors = GRADE_COLORS[category.grade] || GRADE_COLORS["F"];

  return (
    <div className="border-b border-slate-100 last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-4 px-1 text-left hover:bg-slate-50/50 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          {open ? <ChevronDown size={16} className="text-slate-400 shrink-0" /> : <ChevronRight size={16} className="text-slate-400 shrink-0" />}
          <span className="text-sm font-medium text-deep-navy truncate">{category.label}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-slate-500" style={{ fontVariantNumeric: "tabular-nums" }}>
            {category.score}/{category.maxScore}
          </span>
          <span
            className="text-xs font-bold px-2 py-0.5 rounded"
            style={{ color: colors.text, backgroundColor: colors.bg }}
          >
            {category.grade}
          </span>
        </div>
      </button>

      {open && (
        <div className="pb-3 pl-8 pr-1 space-y-1">
          {category.checks.map((check, i) => (
            <div
              key={check.id}
              className="flex items-start gap-2.5 py-2 text-sm"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              {STATUS_ICONS[check.status]}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className={`font-medium ${check.status === "pass" ? "text-slate-600" : "text-deep-navy"}`}>
                    {check.label}
                  </span>
                  {check.reference && (
                    <span className="text-[10px] text-slate-400 font-mono shrink-0">{check.reference}</span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{check.details}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ScanResultReport({
  result,
  shareUrl,
}: {
  result: UnifiedScanResult;
  shareUrl?: string;
}) {
  const [copied, setCopied] = useState(false);

  const passCount = result.checks.filter((c) => c.status === "pass").length;
  const warnCount = result.checks.filter((c) => c.status === "warn").length;
  const failCount = result.checks.filter((c) => c.status === "fail").length;

  const handleCopy = () => {
    const url = shareUrl || window.location.href;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Auto-fail banner */}
      {result.autoFailTriggered && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-sm">
          <ShieldAlert size={20} className="text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-red-800">Critical security issue detected</p>
            <p className="text-red-600 mt-0.5">{result.autoFailReason}</p>
          </div>
        </div>
      )}

      {/* Grade hero */}
      <div className="flex items-center gap-6">
        <GradeRing grade={result.grade} score={result.overallScore} />
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
            {TYPE_ICONS[result.type]}
            <span>{TYPE_LABELS[result.type] || result.type}</span>
            <span>&middot;</span>
            <span>{result.durationMs}ms</span>
          </div>
          <h2 className="text-xl font-bold text-deep-navy truncate">{result.targetDisplay}</h2>
          <div className="flex items-center gap-3 mt-2 text-xs" style={{ fontVariantNumeric: "tabular-nums" }}>
            <span className="flex items-center gap-1 text-green-600">
              <CheckCircle2 size={12} /> {passCount} passed
            </span>
            {warnCount > 0 && (
              <span className="flex items-center gap-1 text-amber-500">
                <AlertTriangle size={12} /> {warnCount} warnings
              </span>
            )}
            {failCount > 0 && (
              <span className="flex items-center gap-1 text-red-500">
                <XCircle size={12} /> {failCount} failed
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Category breakdown */}
      <div className="border border-slate-100 rounded-xl overflow-hidden bg-white">
        {result.categories
          .filter((c) => c.checks.length > 0)
          .map((cat, i) => (
            <CategoryRow key={cat.category} category={cat} defaultOpen={i === 0 || cat.grade === "F"} />
          ))}
      </div>

      {/* Recommendations */}
      {result.recommendations.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-deep-navy uppercase tracking-wider">Recommendations</h3>
          <div className="space-y-1.5">
            {result.recommendations.map((rec, i) => (
              <div
                key={i}
                className={`border-l-2 pl-3 py-2 text-sm text-gov-slate ${SEVERITY_COLORS[rec.severity] || ""}`}
              >
                {rec.text}
                {rec.snippet && (
                  <pre className="mt-2 text-xs bg-slate-50 p-2 rounded overflow-x-auto">{rec.snippet}</pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Share */}
      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={handleCopy}
          className="flex items-center gap-2 px-4 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy link"}
        </button>
        {result.grade.startsWith("A") && (
          <span className="text-xs text-slate-400">
            Embed badge: <code className="bg-slate-50 px-1 py-0.5 rounded text-[10px]">
              /api/badge?grade={result.grade}&style=pill
            </code>
          </span>
        )}
      </div>
    </div>
  );
}
