"use client";

import { useState } from "react";

interface Question {
  id: number;
  question: string;
  principle: string;
  options: { label: string; score: number }[];
}

interface AssessmentResultsProps {
  answers: number[];
  questions: Question[];
  onRestart: () => void;
}

const RECOMMENDATIONS: Record<string, string> = {
  Detect:
    "Consider implementing AI-powered real-time threat detection to strengthen your detection capability and meet SPF Principle 1 requirements.",
  Report:
    "Establish automated reporting workflows with audit trails to satisfy regulatory intelligence-sharing obligations under the SPF.",
  Prevent:
    "Deploy proactive prevention measures including AI-powered content screening to protect customers before scam engagement.",
  Disrupt:
    "Join cross-ecosystem intelligence networks like AFCX and implement real-time threat sharing to disrupt scam operations at scale.",
  Respond:
    "Build formal response procedures with SLA tracking to ensure timely customer support when scams are reported.",
  Govern:
    "Develop comprehensive, living documentation with regular review cycles and audit trails to demonstrate governance maturity.",
};

const fmt = new Intl.NumberFormat("en-AU");

function scoreColor(pct: number): string {
  if (pct <= 40) return "text-[#DC2626]";
  if (pct <= 70) return "text-alert-amber";
  return "text-safe-green";
}

function scoreBorderColor(pct: number): string {
  if (pct <= 40) return "border-[#DC2626]";
  if (pct <= 70) return "border-alert-amber";
  return "border-safe-green";
}

function scoreStrokeColor(pct: number): string {
  if (pct <= 40) return "#DC2626";
  if (pct <= 70) return "#D97706";
  return "#059669";
}

function scoreBgColor(pct: number): string {
  if (pct <= 40) return "bg-[#FEF2F2]";
  if (pct <= 70) return "bg-[#FFFBEB]";
  return "bg-[#ECFDF5]";
}

function trafficLabel(score: number, max: number): string {
  const pct = (score / max) * 100;
  if (pct <= 33) return "Needs Attention";
  if (pct <= 66) return "Developing";
  return "Strong";
}

export function AssessmentResults({
  answers,
  questions,
  onRestart,
}: AssessmentResultsProps) {
  const [formState, setFormState] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    company: "",
    sector: "",
  });

  // Calculate overall score
  const totalScore = answers.reduce((sum, a) => sum + a, 0);
  const maxScore = 24;
  const percentage = Math.round((totalScore / maxScore) * 100);

  // Per-principle breakdown
  // Q1->Detect, Q2->Report, Q3->Prevent, Q4->Disrupt, Q5->Respond, Q6+Q7->Govern, Q8->Overall Risk
  const principles = [
    { name: "Detect", score: answers[0], max: 3 },
    { name: "Report", score: answers[1], max: 3 },
    { name: "Prevent", score: answers[2], max: 3 },
    { name: "Disrupt", score: answers[3], max: 3 },
    { name: "Respond", score: answers[4], max: 3 },
    {
      name: "Govern",
      score: answers[5] + answers[6],
      max: 6,
    },
  ];

  const overallRisk = { name: "Overall Risk", score: answers[7], max: 3 };

  // Gaps: principles scoring below threshold
  const gaps = principles.filter((p) => {
    const threshold = p.max === 6 ? 4 : 2;
    return p.score < threshold;
  });

  // SVG circle progress
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormState("submitting");

    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          company_name: formData.company,
          sector: formData.sector || undefined,
          source: "spf_assessment",
          assessment_data: {
            answers,
            totalScore,
            percentage,
            principles: principles.map((p) => ({
              name: p.name,
              score: p.score,
              max: p.max,
            })),
            overallRisk,
            gaps: gaps.map((g) => g.name),
          },
        }),
      });

      if (res.ok) {
        setFormState("success");
      } else {
        setFormState("error");
      }
    } catch {
      setFormState("error");
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="text-center mb-10">
        <h1 className="text-3xl font-extrabold text-deep-navy tracking-tight mb-2">
          Your SPF Readiness Score
        </h1>
        <p className="text-gov-slate text-sm">
          Based on your responses across the 6 SPF principles
        </p>
      </div>

      {/* Score circle */}
      <div className="flex justify-center mb-10">
        <div className="relative w-40 h-40">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
            <circle
              cx="60"
              cy="60"
              r={radius}
              fill="none"
              stroke="#E2E8F0"
              strokeWidth="8"
            />
            <circle
              cx="60"
              cy="60"
              r={radius}
              fill="none"
              stroke={scoreStrokeColor(percentage)}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              className="transition-all duration-700"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span
              className={`text-4xl font-extrabold ${scoreColor(percentage)}`}
            >
              {percentage}%
            </span>
            <span className="text-xs text-gov-slate mt-0.5">
              {fmt.format(totalScore)} / {fmt.format(maxScore)}
            </span>
          </div>
        </div>
      </div>

      {/* Principle breakdown */}
      <h2 className="text-lg font-bold text-deep-navy mb-4">
        Principle Breakdown
      </h2>
      <div className="grid grid-cols-2 gap-3 mb-8">
        {principles.map((p) => {
          const pPct = Math.round((p.score / p.max) * 100);
          return (
            <div
              key={p.name}
              className={`rounded-xl border-2 p-4 ${scoreBorderColor(pPct)} ${scoreBgColor(pPct)}`}
            >
              <div className="text-xs font-bold uppercase tracking-wider text-gov-slate mb-1">
                {p.name}
              </div>
              <div className={`text-2xl font-extrabold ${scoreColor(pPct)}`}>
                {p.score}/{p.max}
              </div>
              <div className={`text-xs font-medium ${scoreColor(pPct)}`}>
                {trafficLabel(p.score, p.max)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Overall Risk card */}
      <div
        className={`rounded-xl border-2 p-4 mb-8 ${scoreBorderColor(Math.round((overallRisk.score / overallRisk.max) * 100))} ${scoreBgColor(Math.round((overallRisk.score / overallRisk.max) * 100))}`}
      >
        <div className="text-xs font-bold uppercase tracking-wider text-gov-slate mb-1">
          {overallRisk.name}
        </div>
        <div
          className={`text-2xl font-extrabold ${scoreColor(Math.round((overallRisk.score / overallRisk.max) * 100))}`}
        >
          {overallRisk.score}/{overallRisk.max}
        </div>
        <div
          className={`text-xs font-medium ${scoreColor(Math.round((overallRisk.score / overallRisk.max) * 100))}`}
        >
          {trafficLabel(overallRisk.score, overallRisk.max)}
        </div>
      </div>

      {/* Gap analysis */}
      {gaps.length > 0 && (
        <div className="mb-10">
          <h2 className="text-lg font-bold text-deep-navy mb-4">
            Gap Analysis
          </h2>
          <div className="flex flex-col gap-3">
            {gaps.map((g) => (
              <div
                key={g.name}
                className="rounded-xl border border-border-light bg-white p-4"
              >
                <div className="text-sm font-bold text-deep-navy mb-1">
                  {g.name}
                </div>
                <p className="text-sm text-gov-slate leading-relaxed">
                  {RECOMMENDATIONS[g.name]}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lead capture */}
      <div className="rounded-2xl bg-deep-navy p-8 text-center">
        <h2 className="text-xl font-bold text-white mb-2">
          Get Your Detailed SPF Compliance Report
        </h2>
        <p className="text-slate-300 text-sm mb-6">
          Receive personalised recommendations and an action plan tailored to
          your organisation&apos;s gaps.
        </p>

        {formState === "success" ? (
          <div className="bg-safe-bg border border-safe-border rounded-xl p-4">
            <p className="text-safe-text font-semibold text-sm">
              Your detailed report will be sent to your email within 24 hours.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="text-left space-y-3">
            <input
              type="text"
              required
              placeholder="Full name"
              value={formData.name}
              onChange={(e) =>
                setFormData((d) => ({ ...d, name: e.target.value }))
              }
              className="w-full px-4 py-2.5 rounded-xl bg-white text-deep-navy text-sm border border-border-light"
            />
            <input
              type="email"
              required
              placeholder="Work email"
              value={formData.email}
              onChange={(e) =>
                setFormData((d) => ({ ...d, email: e.target.value }))
              }
              className="w-full px-4 py-2.5 rounded-xl bg-white text-deep-navy text-sm border border-border-light"
            />
            <input
              type="text"
              required
              placeholder="Company name"
              value={formData.company}
              onChange={(e) =>
                setFormData((d) => ({ ...d, company: e.target.value }))
              }
              className="w-full px-4 py-2.5 rounded-xl bg-white text-deep-navy text-sm border border-border-light"
            />
            <select
              value={formData.sector}
              onChange={(e) =>
                setFormData((d) => ({ ...d, sector: e.target.value }))
              }
              className="w-full px-4 py-2.5 rounded-xl bg-white text-deep-navy text-sm border border-border-light"
            >
              <option value="">Select sector (optional)</option>
              <option value="banking">Banking / ADI</option>
              <option value="telco">Telco</option>
              <option value="digital_platform">Digital Platform</option>
              <option value="insurance">Insurance</option>
              <option value="superannuation">Superannuation</option>
              <option value="other">Other</option>
            </select>

            {formState === "error" && (
              <p className="text-[#DC2626] text-xs font-medium">
                Something went wrong. Please try again.
              </p>
            )}

            <button
              type="submit"
              disabled={formState === "submitting"}
              className="w-full py-3 rounded-xl bg-trust-teal text-white font-semibold text-sm hover:bg-trust-teal/90 transition-colors disabled:opacity-50"
            >
              {formState === "submitting"
                ? "Submitting..."
                : "Get Your Report"}
            </button>
          </form>
        )}
      </div>

      {/* Restart */}
      <div className="text-center mt-8">
        <button
          type="button"
          onClick={onRestart}
          className="text-sm font-semibold text-gov-slate hover:text-deep-navy transition-colors"
        >
          Retake Assessment
        </button>
      </div>
    </div>
  );
}
