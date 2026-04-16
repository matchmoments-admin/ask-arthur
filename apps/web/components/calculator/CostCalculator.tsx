"use client";

import { useState } from "react";

const AUD = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});

const NUM = new Intl.NumberFormat("en-AU");

const TIER1_MINIMUM = 52_715_850;
const ARTHUR_MONTHLY = 249;
const ARTHUR_ANNUAL = ARTHUR_MONTHLY * 12;
const AFCA_INCIDENT_RATE = 0.001;
const AFCA_AVG_LOSS = 4200;

type OrgType = "bank" | "telco" | "digital_platform";

const ORG_LABELS: Record<OrgType, string> = {
  bank: "Bank / ADI",
  telco: "Telco",
  digital_platform: "Digital Platform",
};

export function CostCalculator() {
  const [orgType, setOrgType] = useState<OrgType>("bank");
  const [revenue, setRevenue] = useState<string>("");
  const [customers, setCustomers] = useState<string>("");
  const [transactions, setTransactions] = useState<string>("");
  const [detectionRate, setDetectionRate] = useState(30);
  const [scamLosses, setScamLosses] = useState<string>("");

  const [formState, setFormState] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    company: "",
  });

  // Parse numeric values
  const revenueNum = parseNumber(revenue);
  const customersNum = parseNumber(customers);
  const scamLossesNum = parseNumber(scamLosses);

  // 1. Maximum Tier 1 Penalty
  const thirtyPctTurnover = revenueNum * 0.3;
  const maxPenalty = Math.max(TIER1_MINIMUM, thirtyPctTurnover);

  // 2. Projected annual scam losses
  const projectedLosses =
    detectionRate < 50
      ? scamLossesNum * (1 + (50 - detectionRate) / 100)
      : scamLossesNum;

  // 3. AFCA dispute exposure
  const afcaExposure = customersNum * AFCA_INCIDENT_RATE * AFCA_AVG_LOSS;

  // 4. ROI
  const lossesPreventedByArthur = projectedLosses * 0.6; // conservative 60% prevention
  const roi =
    ARTHUR_ANNUAL > 0
      ? Math.round(
          ((lossesPreventedByArthur - ARTHUR_ANNUAL) / ARTHUR_ANNUAL) * 100
        )
      : 0;

  const hasInputs = revenueNum > 0 || customersNum > 0 || scamLossesNum > 0;

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
          source: "calculator",
          assessment_data: {
            orgType,
            revenue: revenueNum,
            customers: customersNum,
            transactions: parseNumber(transactions),
            detectionRate,
            scamLosses: scamLossesNum,
            maxPenalty,
            projectedLosses,
            afcaExposure,
            arthurAnnualCost: ARTHUR_ANNUAL,
            roi,
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
          Cost of Non-Compliance Calculator
        </h1>
        <p className="text-gov-slate text-sm max-w-lg mx-auto">
          Estimate your organisation&apos;s penalty exposure under the Scams
          Prevention Framework Act 2025. All calculations are indicative only.
        </p>
      </div>

      {/* Inputs */}
      <div className="space-y-5 mb-10">
        <div>
          <label className="block text-sm font-semibold text-deep-navy mb-1.5">
            Organisation Type
          </label>
          <div className="flex gap-2">
            {(Object.keys(ORG_LABELS) as OrgType[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setOrgType(key)}
                className={`flex-1 py-2.5 px-3 rounded-xl border-2 text-sm font-medium transition-all ${
                  orgType === key
                    ? "border-trust-teal bg-trust-teal/5 text-deep-navy"
                    : "border-border-light bg-white text-gov-slate hover:border-gray-300"
                }`}
              >
                {ORG_LABELS[key]}
              </button>
            ))}
          </div>
        </div>

        <NumberInput
          label="Annual Revenue (AUD)"
          value={revenue}
          onChange={setRevenue}
          placeholder="e.g. 500,000,000"
        />

        <NumberInput
          label="Number of Customers"
          value={customers}
          onChange={setCustomers}
          placeholder="e.g. 2,000,000"
        />

        <NumberInput
          label="Monthly Transaction Volume"
          value={transactions}
          onChange={setTransactions}
          placeholder="e.g. 10,000,000"
        />

        <div>
          <label className="block text-sm font-semibold text-deep-navy mb-1.5">
            Current Scam Detection Rate: {detectionRate}%
          </label>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={detectionRate}
            onChange={(e) => setDetectionRate(Number(e.target.value))}
            className="w-full accent-trust-teal"
          />
          <div className="flex justify-between text-xs text-gov-slate mt-1">
            <span>0%</span>
            <span>100%</span>
          </div>
        </div>

        <NumberInput
          label="Annual Scam Losses (AUD)"
          value={scamLosses}
          onChange={setScamLosses}
          placeholder="e.g. 5,000,000"
        />
      </div>

      {/* Results */}
      {hasInputs && (
        <div className="space-y-4 mb-10">
          <h2 className="text-lg font-bold text-deep-navy">
            Your Exposure Summary
          </h2>

          {/* Max penalty */}
          <div className="rounded-xl border-2 border-[#DC2626] bg-[#FEF2F2] p-5">
            <div className="text-xs font-bold uppercase tracking-wider text-gov-slate mb-1">
              Maximum Tier 1 Penalty
            </div>
            <div className="text-3xl font-extrabold text-[#DC2626]">
              {AUD.format(maxPenalty)}
            </div>
            <p className="text-xs text-gov-slate mt-1.5">
              Greater of {AUD.format(TIER1_MINIMUM)}, 3x benefit obtained, or
              30% of adjusted turnover ({AUD.format(thirtyPctTurnover)})
            </p>
          </div>

          {/* Projected losses */}
          <div className="rounded-xl border-2 border-alert-amber bg-[#FFFBEB] p-5">
            <div className="text-xs font-bold uppercase tracking-wider text-gov-slate mb-1">
              Projected Annual Scam Losses
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-alert-amber">
                {AUD.format(projectedLosses)}
              </span>
              {detectionRate < 50 && scamLossesNum > 0 && (
                <span className="text-sm font-semibold text-alert-amber">
                  {"\u2191"}{" "}
                  {Math.round(((projectedLosses - scamLossesNum) / scamLossesNum) * 100)}
                  % risk
                </span>
              )}
            </div>
            <p className="text-xs text-gov-slate mt-1.5">
              {detectionRate < 50
                ? "Low detection rate increases projected losses above current levels."
                : "Based on your current reported scam losses."}
            </p>
          </div>

          {/* AFCA exposure */}
          <div className="rounded-xl border-2 border-alert-amber bg-[#FFFBEB] p-5">
            <div className="text-xs font-bold uppercase tracking-wider text-gov-slate mb-1">
              AFCA Dispute Exposure
            </div>
            <div className="text-3xl font-extrabold text-alert-amber">
              {AUD.format(afcaExposure)}
            </div>
            <p className="text-xs text-gov-slate mt-1.5">
              Based on {NUM.format(customersNum)} customers x 0.1% scam incident
              rate x {AUD.format(AFCA_AVG_LOSS)} average loss
            </p>
          </div>

          {/* Ask Arthur comparison */}
          <div className="rounded-xl border-2 border-safe-green bg-[#ECFDF5] p-5">
            <div className="text-xs font-bold uppercase tracking-wider text-gov-slate mb-1">
              Ask Arthur Implementation
            </div>
            <div className="text-3xl font-extrabold text-safe-green">
              {AUD.format(ARTHUR_ANNUAL)}/yr
            </div>
            <p className="text-xs text-gov-slate mt-1.5">
              Enterprise plan at {AUD.format(ARTHUR_MONTHLY)}/mo
            </p>
            {scamLossesNum > 0 && (
              <div className="mt-3 pt-3 border-t border-safe-border">
                <span className="text-sm font-bold text-safe-green">
                  Estimated ROI: {NUM.format(roi)}%
                </span>
                <p className="text-xs text-gov-slate mt-0.5">
                  Based on conservative 60% loss prevention
                </p>
              </div>
            )}
          </div>

          {/* Comparison bar */}
          <div className="rounded-xl bg-deep-navy p-5">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
              Cost Comparison
            </div>
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-white font-medium">Ask Arthur</span>
                  <span className="text-safe-green font-bold">
                    {AUD.format(ARTHUR_ANNUAL)}/yr
                  </span>
                </div>
                <div className="w-full h-3 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-safe-green rounded-full"
                    style={{
                      width: `${Math.max(1, (ARTHUR_ANNUAL / maxPenalty) * 100)}%`,
                    }}
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-white font-medium">
                    Penalty Exposure
                  </span>
                  <span className="text-[#DC2626] font-bold">
                    {AUD.format(maxPenalty)}
                  </span>
                </div>
                <div className="w-full h-3 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-[#DC2626] rounded-full w-full" />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Lead capture CTA */}
      <div className="rounded-2xl bg-deep-navy p-8 text-center">
        <h2 className="text-xl font-bold text-white mb-2">
          Get a Personalised Compliance Cost Analysis
        </h2>
        <p className="text-slate-300 text-sm mb-6">
          Our team will prepare a detailed report with tailored recommendations
          for your organisation.
        </p>

        {formState === "success" ? (
          <div className="bg-safe-bg border border-safe-border rounded-xl p-4">
            <p className="text-safe-text font-semibold text-sm">
              Thank you. We&apos;ll send your personalised analysis within 24
              hours.
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
                : "Get Your Analysis"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseNumber(value: string): number {
  const cleaned = value.replace(/[^0-9.]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function formatInputNumber(value: string): string {
  const num = parseNumber(value);
  if (num === 0 && value === "") return "";
  return NUM.format(num);
}

function NumberInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      <label className="block text-sm font-semibold text-deep-navy mb-1.5">
        {label}
      </label>
      <input
        type="text"
        inputMode="numeric"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          // Allow typing, then format on blur
          onChange(e.target.value);
        }}
        onBlur={() => {
          const formatted = formatInputNumber(value);
          if (formatted) onChange(formatted);
        }}
        className="w-full px-4 py-2.5 rounded-xl border border-border-light bg-white text-deep-navy text-sm"
      />
    </div>
  );
}
