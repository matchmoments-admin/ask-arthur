"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { OnboardingState } from "@/app/onboarding/page";

interface CreateResult {
  orgId: string;
  orgSlug: string;
  apiKey: string;
}

interface Props {
  state: OnboardingState;
}

export default function StepComplete({ state }: Props) {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<CreateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const res = await fetch("/api/org/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: state.companyName,
            abn: state.abn || undefined,
            sector: state.sector || undefined,
            roleTitle: state.roleTitle || undefined,
            abnVerified: state.abnVerified,
            abnEntityName: state.abnEntityName || undefined,
            invites: state.invites.length > 0 ? state.invites : undefined,
          }),
        });

        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error || "Failed to create organization");
        }

        const data: CreateResult = await res.json();
        if (cancelled) return;
        setResult(data);

        // Dispatch invites via the existing invite endpoint so the hashed
        // token + Resend email path runs. Per-invite failures are logged
        // to console but do not block onboarding — the user can retry
        // from /app/team.
        await Promise.all(
          state.invites.map((inv) =>
            fetch("/api/org/invite", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email: inv.email, role: inv.role }),
            }).catch((err) => {
              console.error("Invite dispatch failed", inv.email, err);
            })
          )
        );
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : "Failed to create organization";
          setError(message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center py-12">
        <svg
          className="animate-spin h-8 w-8 text-trust-teal mb-4"
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
        <p className="text-sm text-gov-slate">
          Creating your organization...
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4 text-center py-8">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-50">
          <svg
            className="h-6 w-6 text-danger-red"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </div>
        <p className="text-sm text-danger-red">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-md border border-border-light px-4 py-2 text-sm font-semibold text-gov-slate hover:bg-gray-50 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-center py-8">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-50">
        <svg
          className="h-6 w-6 text-safe-green"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5 13l4 4L19 7"
          />
        </svg>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-deep-navy">
          Your organization has been created!
        </h2>
        <p className="text-sm text-gov-slate mt-1">{state.companyName}</p>
      </div>

      {result?.apiKey && (
        <div className="rounded-md border border-border-light bg-gray-50 p-4 text-left">
          <p className="text-xs font-medium text-deep-navy mb-1">
            Your first API key
          </p>
          <code className="block text-xs text-gov-slate bg-white border border-border-light rounded px-3 py-2 break-all select-all">
            {result.apiKey}
          </code>
          <p className="text-xs text-alert-amber mt-2">
            Store this key securely. It will not be shown again.
          </p>
        </div>
      )}

      <Link
        href="/app"
        className="inline-block w-full rounded-md bg-trust-teal px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-trust-teal/90"
      >
        Go to Dashboard
      </Link>
    </div>
  );
}
