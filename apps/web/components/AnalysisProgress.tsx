"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";

// Legacy labels (used when no currentStep prop is passed — keeps pre-V2
// behaviour identical for the flag-off path).
const LEGACY_STEPS = [
  "Analysing message content...",
  "Checking for scam patterns...",
  "Verifying URLs against databases...",
  "Generating safety report...",
];

// V2 honest labels — tied to real fetch boundaries by the caller.
const V2_STEPS: Array<{ key: Step; label: string }> = [
  { key: "upload", label: "Uploading what you sent" },
  { key: "lookup", label: "Checking it against known scams" },
  { key: "analyse", label: "Looking for tell-tale signs" },
  { key: "write", label: "Writing your answer" },
];

const STEP_DELAYS = [0, 1200, 2800, 4500];

export type Step = "upload" | "lookup" | "analyse" | "write" | "done";

type StepState = "pending" | "active" | "done";

type State = {
  phase: "idle" | "running" | "done";
  activeStepIndex: number;
};

type Action =
  | { type: "START" }
  | { type: "ADVANCE"; index: number }
  | { type: "DONE" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "START":
      return { phase: "running", activeStepIndex: 0 };
    case "ADVANCE":
      return { ...state, activeStepIndex: action.index };
    case "DONE":
      return { phase: "done", activeStepIndex: LEGACY_STEPS.length - 1 };
    default:
      return state;
  }
}

interface Props {
  status: "idle" | "analyzing" | "complete" | "error" | "rate_limited";
  /** When provided, drives the UI from honest caller-emitted transitions and
   *  the legacy timer-based reducer is bypassed. Use V2 step labels. */
  currentStep?: Step;
}

export default function AnalysisProgress({ status, currentStep }: Props) {
  if (currentStep) {
    return <V2Progress currentStep={currentStep} />;
  }
  return <LegacyProgress status={status} />;
}

// ---------------------------------------------------------------------------
// V2 — honest, prop-driven progress. No fake timers.
// ---------------------------------------------------------------------------

function V2Progress({ currentStep }: { currentStep: Step }) {
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showSlow, setShowSlow] = useReducer(
    (_: boolean, next: boolean) => next,
    false,
  );

  useEffect(() => {
    if (currentStep === "done") {
      if (slowTimerRef.current) clearTimeout(slowTimerRef.current);
      return;
    }
    slowTimerRef.current = setTimeout(() => setShowSlow(true), 15000);
    return () => {
      if (slowTimerRef.current) clearTimeout(slowTimerRef.current);
    };
  }, [currentStep]);

  const activeIndex = V2_STEPS.findIndex((s) => s.key === currentStep);
  const isDone = currentStep === "done";
  const announced = isDone
    ? "Done."
    : V2_STEPS[Math.max(0, activeIndex)]?.label ?? "";

  return (
    <section
      aria-busy={!isDone}
      aria-labelledby="analysis-progress-heading"
      className="mt-6 rounded-lg border border-slate-200 bg-white p-5"
    >
      <h2
        id="analysis-progress-heading"
        className="text-sm font-bold uppercase tracking-widest text-deep-navy"
      >
        Checking what you sent…
      </h2>
      <ol aria-hidden="true" className="mt-3 space-y-2">
        {V2_STEPS.map((s, i) => {
          const state: StepState = isDone
            ? "done"
            : i < activeIndex
              ? "done"
              : i === activeIndex
                ? "active"
                : "pending";
          return (
            <li key={s.key} className="flex items-center gap-3">
              <StepIndicator state={state} />
              <span
                className={`text-sm ${
                  state === "pending"
                    ? "text-slate-400"
                    : state === "active"
                      ? "text-deep-navy"
                      : "text-slate-500"
                }`}
              >
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announced}
      </p>
      {showSlow && !isDone && (
        <p className="mt-4 text-sm text-gov-slate">
          Still working on it — deep checks can take up to 30 seconds.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Legacy — fake-timer based. Unchanged behaviour for pre-V2 callers.
// ---------------------------------------------------------------------------

function LegacyProgress({ status }: { status: Props["status"] }) {
  const [state, dispatch] = useReducer(reducer, {
    phase: "idle",
    activeStepIndex: 0,
  });
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  useEffect(() => {
    if (status !== "analyzing") {
      clearTimers();
      return;
    }

    const startTimer = setTimeout(() => dispatch({ type: "START" }), 0);
    timersRef.current.push(startTimer);

    STEP_DELAYS.slice(1).forEach((delay, i) => {
      const timer = setTimeout(
        () => dispatch({ type: "ADVANCE", index: i + 1 }),
        delay,
      );
      timersRef.current.push(timer);
    });

    return clearTimers;
  }, [status, clearTimers]);

  useEffect(() => {
    if (status === "complete" || status === "error" || status === "rate_limited") {
      const timer = setTimeout(() => dispatch({ type: "DONE" }), 0);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const stepStates: StepState[] = LEGACY_STEPS.map((_, i) => {
    if (state.phase === "idle") return "pending";
    if (state.phase === "done") return "done";
    if (i < state.activeStepIndex) return "done";
    if (i === state.activeStepIndex) return "active";
    return "pending";
  });

  if (state.phase === "idle") return null;

  return (
    <div className="py-4 space-y-3">
      {LEGACY_STEPS.map((step, i) => (
        <div key={i} className="flex items-center gap-3">
          <StepIndicator state={stepStates[i]} />
          <span
            className={`text-sm transition-colors ${
              stepStates[i] === "pending"
                ? "text-slate-400"
                : stepStates[i] === "active"
                  ? "text-deep-navy"
                  : "text-slate-500"
            }`}
          >
            {step}
          </span>
        </div>
      ))}
    </div>
  );
}

function StepIndicator({ state }: { state: StepState }) {
  if (state === "pending") {
    return (
      <div className="w-5 h-5 rounded-full border-2 border-slate-200 flex-shrink-0" />
    );
  }

  if (state === "active") {
    return (
      <div className="w-5 h-5 flex-shrink-0">
        <svg className="animate-spin w-5 h-5 text-action-teal" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  return (
    <div className="w-5 h-5 rounded-full bg-deep-navy flex items-center justify-center flex-shrink-0">
      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    </div>
  );
}
