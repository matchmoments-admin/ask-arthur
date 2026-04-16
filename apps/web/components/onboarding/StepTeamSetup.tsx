"use client";

import { useState } from "react";
import type { OnboardingState } from "@/app/onboarding/page";

const ROLES = [
  "Admin",
  "Compliance Officer",
  "Fraud Analyst",
  "Developer",
  "Viewer",
];

const MAX_INVITES = 10;

interface Props {
  state: OnboardingState;
  update: (partial: Partial<OnboardingState>) => void;
  onNext: () => void;
}

export default function StepTeamSetup({ state, update, onNext }: Props) {
  const [invites, setInvites] = useState<Array<{ email: string; role: string }>>(
    state.invites.length > 0
      ? state.invites
      : [{ email: "", role: "Viewer" }]
  );

  function updateInvite(
    index: number,
    field: "email" | "role",
    value: string
  ) {
    setInvites((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  function addRow() {
    if (invites.length >= MAX_INVITES) return;
    setInvites((prev) => [...prev, { email: "", role: "Viewer" }]);
  }

  function removeRow(index: number) {
    setInvites((prev) => prev.filter((_, i) => i !== index));
  }

  function handleContinue() {
    const valid = invites.filter((inv) => inv.email.trim().length > 0);
    update({ invites: valid });
    onNext();
  }

  function handleSkip() {
    update({ invites: [] });
    onNext();
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-gov-slate">
        Invite team members to your organization. You can also do this later.
      </p>

      <div className="space-y-3">
        {invites.map((invite, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="flex-1">
              <input
                type="email"
                value={invite.email}
                onChange={(e) => updateInvite(i, "email", e.target.value)}
                placeholder="colleague@company.com"
                className="w-full rounded-md border border-border-light px-3 py-2 text-sm text-deep-navy focus:outline-none focus:ring-2 focus:ring-trust-teal focus:border-transparent"
              />
            </div>
            <select
              value={invite.role}
              onChange={(e) => updateInvite(i, "role", e.target.value)}
              className="rounded-md border border-border-light px-3 py-2 text-sm text-deep-navy bg-white focus:outline-none focus:ring-2 focus:ring-trust-teal focus:border-transparent"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            {invites.length > 1 && (
              <button
                type="button"
                onClick={() => removeRow(i)}
                className="rounded-md px-2 py-2 text-gov-slate hover:text-danger-red transition-colors"
                aria-label="Remove invite"
              >
                <svg
                  className="h-4 w-4"
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
              </button>
            )}
          </div>
        ))}
      </div>

      {invites.length < MAX_INVITES && (
        <button
          type="button"
          onClick={addRow}
          className="text-sm font-medium text-trust-teal hover:text-trust-teal/80 transition-colors"
        >
          + Add another
        </button>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={handleSkip}
          className="flex-1 rounded-md border border-border-light px-4 py-2.5 text-sm font-semibold text-gov-slate transition-colors hover:bg-gray-50"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={handleContinue}
          className="flex-1 rounded-md bg-trust-teal px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-trust-teal/90"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
