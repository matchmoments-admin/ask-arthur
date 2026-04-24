"use client";

import type { OnboardingState } from "@/app/onboarding/page";

const SECTORS: Array<{ value: string; label: string }> = [
  { value: "banking", label: "Banking" },
  { value: "telco", label: "Telecommunications" },
  { value: "digital_platform", label: "Digital Platform" },
  { value: "insurance", label: "Insurance" },
  { value: "superannuation", label: "Superannuation" },
  { value: "other", label: "Other" },
];

interface Props {
  state: OnboardingState;
  update: (partial: Partial<OnboardingState>) => void;
  onNext: () => void;
}

function isValidABN(abn: string): boolean {
  return /^\d{11}$/.test(abn.replace(/\s/g, ""));
}

export default function StepCompanyDetails({ state, update, onNext }: Props) {
  const abnRaw = state.abn.replace(/\s/g, "");
  const abnTouched = state.abn.length > 0;
  const abnValid = abnRaw.length === 0 || isValidABN(abnRaw);
  const canContinue = state.companyName.trim().length > 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canContinue) return;
    if (abnTouched && !abnValid) return;
    update({ abn: abnRaw });
    onNext();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label
          htmlFor="companyName"
          className="block text-sm font-medium text-deep-navy mb-1"
        >
          Company Name <span className="text-danger-red">*</span>
        </label>
        <input
          id="companyName"
          type="text"
          required
          value={state.companyName}
          onChange={(e) => update({ companyName: e.target.value })}
          className="w-full rounded-md border border-border-light px-3 py-2 text-sm text-deep-navy focus:outline-none focus:ring-2 focus:ring-trust-teal focus:border-transparent"
          placeholder="Acme Pty Ltd"
        />
      </div>

      <div>
        <label
          htmlFor="abn"
          className="block text-sm font-medium text-deep-navy mb-1"
        >
          ABN <span className="text-gov-slate text-xs">(optional)</span>
        </label>
        <input
          id="abn"
          type="text"
          inputMode="numeric"
          maxLength={14}
          value={state.abn}
          onChange={(e) => update({ abn: e.target.value })}
          className={`w-full rounded-md border px-3 py-2 text-sm text-deep-navy focus:outline-none focus:ring-2 focus:ring-trust-teal focus:border-transparent ${
            abnTouched && !abnValid
              ? "border-danger-red"
              : "border-border-light"
          }`}
          placeholder="51 824 753 556"
        />
        {abnTouched && !abnValid && (
          <p className="text-xs text-danger-red mt-1">
            ABN must be exactly 11 digits
          </p>
        )}
      </div>

      <div>
        <label
          htmlFor="sector"
          className="block text-sm font-medium text-deep-navy mb-1"
        >
          Sector
        </label>
        <select
          id="sector"
          value={state.sector}
          onChange={(e) => update({ sector: e.target.value })}
          className="w-full rounded-md border border-border-light px-3 py-2 text-sm text-deep-navy bg-white focus:outline-none focus:ring-2 focus:ring-trust-teal focus:border-transparent"
        >
          <option value="">Select a sector</option>
          {SECTORS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor="roleTitle"
          className="block text-sm font-medium text-deep-navy mb-1"
        >
          Your Role
        </label>
        <input
          id="roleTitle"
          type="text"
          value={state.roleTitle}
          onChange={(e) => update({ roleTitle: e.target.value })}
          className="w-full rounded-md border border-border-light px-3 py-2 text-sm text-deep-navy focus:outline-none focus:ring-2 focus:ring-trust-teal focus:border-transparent"
          placeholder="Head of Compliance"
        />
      </div>

      <button
        type="submit"
        disabled={!canContinue}
        className="w-full rounded-md bg-trust-teal px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-trust-teal/90 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Continue
      </button>
    </form>
  );
}
