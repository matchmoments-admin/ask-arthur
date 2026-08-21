"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Check, CircleCheck, Loader2 } from "lucide-react";

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

/** The V2 labels as a plain list, for surfaces that report the checks AFTER
 *  the run finished (the collapsed summary inside ResultCard). Derived from
 *  V2_STEPS so the labels have exactly one definition. */
export const V2_STEP_LABELS = V2_STEPS.map((s) => s.label);

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
  // On a finished error / throttle the result panel (or rate-limit banner) is
  // the feedback — a stale all-checked step list, especially the legacy
  // "Verifying URLs against databases…" line, wrongly implies a site/URL
  // check ran when the submission was text- or image-only.
  if (status === "error" || status === "rate_limited") return null;
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
  // Once the run finishes, the checks are reported by AnalysisChecksSummary
  // INSIDE the verdict card. Leaving a second, fully-ticked copy of the same
  // four steps stranded above the result is the redundancy this replaces.
  if (currentStep === "done") return null;
  const announced = V2_STEPS[Math.max(0, activeIndex)]?.label ?? "";

  return (
    <section
      aria-busy
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
          const state: StepState =
            i < activeIndex
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
      {showSlow && (
        <p className="mt-4 text-sm text-gov-slate">
          Still working on it — deep checks can take up to 30 seconds.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Post-run summary — the collapsed "we did check things" row that lives inside
// the verdict card. Separate from V2Progress because it is rendered by a
// different component at a different time; it shares only the step labels.
// ---------------------------------------------------------------------------

export function AnalysisChecksSummary({ steps }: { steps: string[] }) {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;

  return (
    <div className="border-t border-slate-200">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-5 py-3 text-left text-sm font-semibold text-gov-slate transition-colors hover:bg-slate-50 sm:px-6"
      >
        <CircleCheck size={18} className="shrink-0 text-safe-green" aria-hidden="true" />
        <span className="flex-1">
          Checked against known scams · {steps.length} of {steps.length} steps
          done
        </span>
        <span className="shrink-0 text-xs font-normal text-slate-500">
          {open ? "Hide" : "Details"}
        </span>
      </button>
      {open && (
        <ul className="space-y-2 px-5 pb-4 sm:px-6">
          {steps.map((s) => (
            <li key={s} className="flex items-center gap-2.5 text-sm text-gov-slate">
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-safe-green"
              />
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
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
      <Loader2
        size={20}
        className="w-5 h-5 flex-shrink-0 animate-spin text-deep-navy"
        aria-hidden="true"
      />
    );
  }

  return (
    <div className="w-5 h-5 rounded-full bg-deep-navy flex items-center justify-center flex-shrink-0">
      <Check size={12} strokeWidth={3} className="text-white" aria-hidden="true" />
    </div>
  );
}
