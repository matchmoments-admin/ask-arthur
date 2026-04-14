"use client";

import type { LucideIcon } from "lucide-react";
import { CheckCircle, TriangleAlert, XCircle, CircleAlert, MinusCircle } from "lucide-react";

interface AuditCheckRowProps {
  label: string;
  status: string;
  details: string;
  score: number;
  maxScore: number;
  learnMoreUrl?: string;
  evidence?: string;
}

const STATUS_CONFIG: Record<string, { icon: LucideIcon; color: string; bg: string }> = {
  pass: { icon: CheckCircle, color: "text-green-700", bg: "bg-green-50" },
  warn: { icon: TriangleAlert, color: "text-amber-600", bg: "bg-amber-50" },
  fail: { icon: XCircle, color: "text-red-600", bg: "bg-red-50" },
  error: { icon: CircleAlert, color: "text-slate-400", bg: "bg-slate-50" },
  skipped: { icon: MinusCircle, color: "text-slate-400", bg: "bg-slate-50" },
};

export default function AuditCheckRow({
  label,
  status,
  details,
  score,
  maxScore,
  learnMoreUrl,
  evidence,
}: AuditCheckRowProps) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.error;

  return (
    <div className={`flex items-start gap-3 px-3 py-2.5 rounded-lg ${config.bg}`}>
      <config.icon className={`mt-0.5 flex-shrink-0 ${config.color}`} size={18} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-deep-navy">{label}</span>
          <span className="text-xs text-gov-slate whitespace-nowrap">
            {score}/{maxScore}
          </span>
        </div>
        <p className="text-xs text-gov-slate mt-0.5 leading-relaxed">
          {details}
          {learnMoreUrl && (
            <>
              {" "}
              <a
                href={learnMoreUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-teal-600 hover:text-teal-800 font-medium"
              >
                Learn more ↗
              </a>
            </>
          )}
        </p>
        {evidence && (
          <details className="mt-1.5 text-xs text-gov-slate">
            <summary className="cursor-pointer hover:text-deep-navy font-medium">
              View evidence
            </summary>
            <pre className="mt-1 p-2 bg-white/60 rounded font-mono whitespace-pre-wrap break-all text-[11px] max-h-32 overflow-y-auto">
              {evidence}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
