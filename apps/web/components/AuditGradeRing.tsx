"use client";

interface AuditGradeRingProps {
  grade: string;
  score: number;
  size?: number;
}

const GRADE_COLORS: Record<string, { stroke: string; bg: string; text: string }> = {
  "A+": { stroke: "#388E3C", bg: "#ECFDF5", text: "#388E3C" },
  A: { stroke: "#388E3C", bg: "#ECFDF5", text: "#388E3C" },
  B: { stroke: "#006B75", bg: "#E0F7FA", text: "#006B75" },
  C: { stroke: "#F57C00", bg: "#FFF8E1", text: "#F57C00" },
  D: { stroke: "#E65100", bg: "#FFF3E0", text: "#E65100" },
  F: { stroke: "#D32F2F", bg: "#FEF2F2", text: "#D32F2F" },
};

export default function AuditGradeRing({
  grade,
  score,
  size = 120,
}: AuditGradeRingProps) {
  const colors = GRADE_COLORS[grade] || GRADE_COLORS["F"];
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const center = size / 2;

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        className="-rotate-90"
        aria-hidden="true"
      >
        {/* Background circle */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill={colors.bg}
          stroke="#E5E7EB"
          strokeWidth={strokeWidth}
        />
        {/* Score arc */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={colors.stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="font-extrabold leading-none"
          style={{ color: colors.text, fontSize: size * 0.3 }}
        >
          {grade}
        </span>
        <span
          className="text-gov-slate font-medium"
          style={{ fontSize: size * 0.12 }}
        >
          {score}/100
        </span>
      </div>
    </div>
  );
}
