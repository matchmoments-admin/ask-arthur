"use client";

import { useEffect, useState } from "react";
import type { OnboardingState } from "@/app/onboarding/page";

interface ABNResult {
  entityName: string;
  status: string;
  entityType: string;
}

interface Props {
  state: OnboardingState;
  update: (partial: Partial<OnboardingState>) => void;
  onNext: () => void;
}

export default function StepABNVerify({ state, update, onNext }: Props) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ABNResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasABN = state.abn.length === 11;

  useEffect(() => {
    if (!hasABN) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/abn-lookup?abn=${state.abn}`)
      .then((res) => {
        if (!res.ok) throw new Error("ABN lookup failed");
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setResult(data);
        update({
          abnVerified: data.status === "Active",
          abnEntityName: data.entityName,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!hasABN) {
    return (
      <div className="space-y-6">
        <div className="rounded-md border border-border-light bg-gray-50 p-5">
          <p className="text-sm text-gov-slate">
            ABN verification is optional but recommended for faster approval.
          </p>
        </div>
        <button
          onClick={onNext}
          className="w-full rounded-md bg-trust-teal px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-trust-teal/90"
        >
          Skip & Continue
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-border-light p-5">
        <p className="text-xs text-gov-slate mb-3">
          ABN: {state.abn.replace(/(\d{2})(\d{3})(\d{3})(\d{3})/, "$1 $2 $3 $4")}
        </p>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-gov-slate">
            <svg
              className="animate-spin h-4 w-4 text-trust-teal"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Looking up ABN...
          </div>
        )}

        {error && (
          <p className="text-sm text-danger-red">
            Could not verify ABN. You can still continue.
          </p>
        )}

        {result && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {result.status === "Active" ? (
                <svg
                  className="h-5 w-5 text-safe-green flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              ) : (
                <svg
                  className="h-5 w-5 text-alert-amber flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.999L13.732 4.001c-.77-1.333-2.694-1.333-3.464 0L3.34 16.001C2.57 17.335 3.536 19 5.076 19z"
                  />
                </svg>
              )}
              <span className="text-sm font-medium text-deep-navy">
                {result.entityName}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-gov-slate">Status</dt>
              <dd
                className={
                  result.status === "Active"
                    ? "text-safe-green font-medium"
                    : "text-alert-amber font-medium"
                }
              >
                {result.status}
              </dd>
              <dt className="text-gov-slate">Entity Type</dt>
              <dd className="text-deep-navy">{result.entityType}</dd>
            </dl>
          </div>
        )}
      </div>

      <button
        onClick={onNext}
        className="w-full rounded-md bg-trust-teal px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-trust-teal/90"
      >
        {result ? "Confirm & Continue" : "Continue"}
      </button>
    </div>
  );
}
