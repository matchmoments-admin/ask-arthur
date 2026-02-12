"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";

const STEPS = [
  "Analyzing message content...",
  "Checking for scam patterns...",
  "Verifying URLs against databases...",
  "Generating safety report...",
];

const STEP_DELAYS = [0, 1200, 2800, 4500];

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
      return { phase: "done", activeStepIndex: STEPS.length - 1 };
    default:
      return state;
  }
}

interface Props {
  status: "idle" | "analyzing" | "complete" | "error" | "rate_limited";
}

export default function AnalysisProgress({ status }: Props) {
  const [state, dispatch] = useReducer(reducer, {
    phase: "idle",
    activeStepIndex: 0,
  });
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  // Start timers when analyzing begins
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
        delay
      );
      timersRef.current.push(timer);
    });

    return clearTimers;
  }, [status, clearTimers]);

  // Mark done when analysis completes (transition from analyzing to complete/error)
  useEffect(() => {
    if (status === "complete" || status === "error" || status === "rate_limited") {
      const timer = setTimeout(() => dispatch({ type: "DONE" }), 0);
      return () => clearTimeout(timer);
    }
  }, [status]);

  // Derive visual step states from reducer state
  const stepStates: StepState[] = STEPS.map((_, i) => {
    if (state.phase === "idle") return "pending";
    if (state.phase === "done") return "done";
    if (i < state.activeStepIndex) return "done";
    if (i === state.activeStepIndex) return "active";
    return "pending";
  });

  if (state.phase === "idle") return null;

  return (
    <div className="py-4 space-y-3">
      {STEPS.map((step, i) => (
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
