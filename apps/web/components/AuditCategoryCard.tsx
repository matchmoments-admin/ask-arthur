"use client";

import AuditCheckRow from "./AuditCheckRow";

interface CategoryCheck {
  id: string;
  label: string;
  status: string;
  details: string;
  score: number;
  maxScore: number;
}

interface AuditCategoryCardProps {
  label: string;
  grade: string;
  score: number;
  maxScore: number;
  checks: CategoryCheck[];
}

const GRADE_BAR_COLORS: Record<string, string> = {
  "A+": "bg-green-600",
  A: "bg-green-600",
  B: "bg-teal-600",
  C: "bg-amber-500",
  D: "bg-orange-600",
  F: "bg-red-600",
};

export default function AuditCategoryCard({
  label,
  grade,
  score,
  maxScore,
  checks,
}: AuditCategoryCardProps) {
  const percentage = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
  const barColor = GRADE_BAR_COLORS[grade] || "bg-slate-400";

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      {/* Category header */}
      <div className="px-4 py-3 bg-slate-50 border-b border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold text-deep-navy uppercase tracking-widest">
            {label}
          </h3>
          <span className="text-sm font-bold text-deep-navy">
            {grade} ({percentage}%)
          </span>
        </div>
        {/* Score bar */}
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ease-out ${barColor}`}
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>

      {/* Check list */}
      <div className="p-2 space-y-1">
        {checks.map((check) => (
          <AuditCheckRow
            key={check.id}
            label={check.label}
            status={check.status}
            details={check.details}
            score={check.score}
            maxScore={check.maxScore}
          />
        ))}
      </div>
    </div>
  );
}
