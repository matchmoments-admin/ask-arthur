"use client";

import { useState } from "react";
import StepCompanyDetails from "@/components/onboarding/StepCompanyDetails";
import StepABNVerify from "@/components/onboarding/StepABNVerify";
import StepTeamSetup from "@/components/onboarding/StepTeamSetup";
import StepComplete from "@/components/onboarding/StepComplete";

export interface OnboardingState {
  companyName: string;
  abn: string;
  sector: string;
  roleTitle: string;
  abnVerified: boolean;
  abnEntityName: string;
  invites: Array<{ email: string; role: string }>;
}

const STEPS = ["Company Details", "Verify ABN", "Invite Team", "Complete"];

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [state, setState] = useState<OnboardingState>({
    companyName: "",
    abn: "",
    sector: "",
    roleTitle: "",
    abnVerified: false,
    abnEntityName: "",
    invites: [],
  });

  function update(partial: Partial<OnboardingState>) {
    setState((prev) => ({ ...prev, ...partial }));
  }

  function next() {
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  return (
    <div>
      <div className="mb-8">
        <p className="text-sm text-gov-slate mb-3">
          Step {step + 1} of {STEPS.length}
        </p>
        <div className="flex items-center gap-2">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div
                className={`w-3 h-3 rounded-full transition-colors ${
                  i < step
                    ? "bg-safe-green"
                    : i === step
                      ? "bg-trust-teal"
                      : "bg-border-light"
                }`}
              />
              {i < STEPS.length - 1 && (
                <div
                  className={`w-8 h-0.5 ${
                    i < step ? "bg-safe-green" : "bg-border-light"
                  }`}
                />
              )}
            </div>
          ))}
        </div>
        <p className="text-sm font-medium text-deep-navy mt-2">
          {STEPS[step]}
        </p>
      </div>

      {step === 0 && (
        <StepCompanyDetails state={state} update={update} onNext={next} />
      )}
      {step === 1 && (
        <StepABNVerify state={state} update={update} onNext={next} />
      )}
      {step === 2 && <StepTeamSetup state={state} update={update} onNext={next} />}
      {step === 3 && <StepComplete state={state} />}
    </div>
  );
}
