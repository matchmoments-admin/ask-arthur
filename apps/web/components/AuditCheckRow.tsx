"use client";

interface AuditCheckRowProps {
  label: string;
  status: string;
  details: string;
  score: number;
  maxScore: number;
}

const STATUS_CONFIG: Record<string, { icon: string; color: string; bg: string }> = {
  pass: { icon: "check_circle", color: "text-green-700", bg: "bg-green-50" },
  warn: { icon: "warning", color: "text-amber-600", bg: "bg-amber-50" },
  fail: { icon: "cancel", color: "text-red-600", bg: "bg-red-50" },
  error: { icon: "error", color: "text-slate-400", bg: "bg-slate-50" },
  skipped: { icon: "remove_circle_outline", color: "text-slate-400", bg: "bg-slate-50" },
};

export default function AuditCheckRow({
  label,
  status,
  details,
  score,
  maxScore,
}: AuditCheckRowProps) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.error;

  return (
    <div className={`flex items-start gap-3 px-3 py-2.5 rounded-lg ${config.bg}`}>
      <span className={`material-symbols-outlined text-lg mt-0.5 flex-shrink-0 ${config.color}`}>
        {config.icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-deep-navy">{label}</span>
          <span className="text-xs text-gov-slate whitespace-nowrap">
            {score}/{maxScore}
          </span>
        </div>
        <p className="text-xs text-gov-slate mt-0.5 leading-relaxed">{details}</p>
      </div>
    </div>
  );
}
