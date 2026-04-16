"use client";

import { useState } from "react";
import { AssessmentResults } from "./AssessmentResults";

const QUESTIONS = [
  {
    id: 1,
    question: "How does your organisation currently detect scam-related activity?",
    principle: "Detect",
    options: [
      { label: "No systematic detection", score: 0 },
      { label: "Manual review processes", score: 1 },
      { label: "Basic automated tools", score: 2 },
      { label: "AI-powered real-time detection", score: 3 },
    ],
  },
  {
    id: 2,
    question: "How do you report scam intelligence to regulators?",
    principle: "Report",
    options: [
      { label: "No formal reporting process", score: 0 },
      { label: "Ad-hoc reporting when required", score: 1 },
      { label: "Regular scheduled reporting", score: 2 },
      { label: "Automated reporting with audit trails", score: 3 },
    ],
  },
  {
    id: 3,
    question: "What scam prevention measures are in place for customers?",
    principle: "Prevent",
    options: [
      { label: "No proactive measures", score: 0 },
      { label: "Warning messages and notifications", score: 1 },
      { label: "Transaction monitoring and alerts", score: 2 },
      { label: "Comprehensive prevention with AI screening", score: 3 },
    ],
  },
  {
    id: 4,
    question: "How do you share scam intelligence across the industry?",
    principle: "Disrupt",
    options: [
      { label: "No intelligence sharing", score: 0 },
      { label: "Participate in some industry forums", score: 1 },
      { label: "Active member of AFCX or similar network", score: 2 },
      { label: "Real-time cross-ecosystem intelligence sharing", score: 3 },
    ],
  },
  {
    id: 5,
    question: "How do you respond when a customer reports a scam?",
    principle: "Respond",
    options: [
      { label: "No formal response process", score: 0 },
      { label: "Manual case-by-case handling", score: 1 },
      { label: "Documented response procedures", score: 2 },
      { label: "Automated response with SLA tracking", score: 3 },
    ],
  },
  {
    id: 6,
    question: "How are your scam prevention policies documented?",
    principle: "Govern",
    options: [
      { label: "No formal documentation", score: 0 },
      { label: "Basic policy documents", score: 1 },
      { label: "Comprehensive documented procedures", score: 2 },
      { label: "Living documentation with regular reviews and audit trails", score: 3 },
    ],
  },
  {
    id: 7,
    question: "How frequently are your scam prevention measures reviewed?",
    principle: "Govern",
    options: [
      { label: "Never or rarely", score: 0 },
      { label: "Annually", score: 1 },
      { label: "Quarterly", score: 2 },
      { label: "Monthly or continuous", score: 3 },
    ],
  },
  {
    id: 8,
    question: "What is your estimated annual scam-related loss?",
    principle: "Overall Risk",
    options: [
      { label: "Over $10M", score: 0 },
      { label: "$1M - $10M", score: 1 },
      { label: "$100K - $1M", score: 2 },
      { label: "Under $100K", score: 3 },
    ],
  },
] as const;

export function AssessmentWizard() {
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<(number | null)[]>(
    Array(QUESTIONS.length).fill(null)
  );

  const isComplete = currentStep >= QUESTIONS.length;
  const progress = isComplete
    ? 100
    : Math.round((currentStep / QUESTIONS.length) * 100);

  function selectOption(score: number) {
    const updated = [...answers];
    updated[currentStep] = score;
    setAnswers(updated);
  }

  function goNext() {
    if (answers[currentStep] !== null && currentStep < QUESTIONS.length) {
      setCurrentStep(currentStep + 1);
    }
  }

  function goBack() {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  }

  if (isComplete) {
    return (
      <AssessmentResults
        answers={answers as number[]}
        questions={QUESTIONS as unknown as { id: number; question: string; principle: string; options: { label: string; score: number }[] }[]}
        onRestart={() => {
          setCurrentStep(0);
          setAnswers(Array(QUESTIONS.length).fill(null));
        }}
      />
    );
  }

  const q = QUESTIONS[currentStep];

  return (
    <div>
      {/* Header */}
      <div className="text-center mb-10">
        <h1 className="text-3xl font-extrabold text-deep-navy tracking-tight mb-2">
          SPF Compliance Readiness Assessment
        </h1>
        <p className="text-gov-slate text-sm">
          Assess your organisation&apos;s preparedness for the Scams Prevention
          Framework Act 2025 across all 6 SPF principles.
        </p>
      </div>

      {/* Progress bar */}
      <div className="mb-8">
        <div className="flex items-center justify-between text-xs text-gov-slate mb-1.5">
          <span>
            Question {currentStep + 1} of {QUESTIONS.length}
          </span>
          <span>{progress}% complete</span>
        </div>
        <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-trust-teal rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Question */}
      <div className="mb-8">
        <h2 className="text-xl font-bold text-deep-navy mb-1">
          {q.principle}
        </h2>
        <p className="text-base text-deep-navy font-medium mb-6">
          {q.question}
        </p>

        <div className="flex flex-col gap-3">
          {q.options.map((opt) => {
            const selected = answers[currentStep] === opt.score;
            return (
              <button
                key={opt.score}
                type="button"
                onClick={() => selectOption(opt.score)}
                className={`w-full text-left px-4 py-3.5 rounded-xl border-2 transition-all text-sm font-medium ${
                  selected
                    ? "border-trust-teal bg-trust-teal/5 text-deep-navy"
                    : "border-border-light bg-white text-gov-slate hover:border-gray-300"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={goBack}
          disabled={currentStep === 0}
          className="text-sm font-semibold text-gov-slate hover:text-deep-navy transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Back
        </button>
        <button
          type="button"
          onClick={goNext}
          disabled={answers[currentStep] === null}
          className="px-6 py-2.5 rounded-xl bg-trust-teal text-white text-sm font-semibold hover:bg-trust-teal/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {currentStep === QUESTIONS.length - 1 ? "See Results" : "Next"}
        </button>
      </div>
    </div>
  );
}
