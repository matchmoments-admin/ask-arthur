"use client";

import type { PhoneLookupResult, PhoneRiskLevel } from "@askarthur/types";

interface PhoneIntelCardProps {
  lookup: PhoneLookupResult;
}

const RISK_COLORS: Record<PhoneRiskLevel, string> = {
  LOW: "#388E3C",
  MEDIUM: "#F57C00",
  HIGH: "#E65100",
  CRITICAL: "#D32F2F",
};

const RISK_BG: Record<PhoneRiskLevel, string> = {
  LOW: "#ECFDF5",
  MEDIUM: "#FFF8E1",
  HIGH: "#FFF3E0",
  CRITICAL: "#FEF2F2",
};

function formatRiskFlag(flag: string): string {
  const labels: Record<string, string> = {
    voip: "VoIP number — internet-based, not tied to a physical line",
    invalid_number: "Invalid phone number format",
    non_au_origin: "Number originates outside Australia",
    unknown_carrier: "Carrier information unavailable",
    no_registered_name: "No registered caller name",
    lookup_failed: "Phone number lookup could not be completed",
  };
  return labels[flag] || flag;
}

function formatLineType(lineType: string | null): string {
  if (!lineType) return "Unknown";
  const labels: Record<string, string> = {
    mobile: "Mobile",
    landline: "Landline",
    nonFixedVoip: "VoIP",
    fixedVoip: "Fixed VoIP",
    tollFree: "Toll Free",
    personal: "Personal",
    pager: "Pager",
    voicemail: "Voicemail",
  };
  return labels[lineType] || lineType;
}

export default function PhoneIntelCard({ lookup }: PhoneIntelCardProps) {
  const color = RISK_COLORS[lookup.riskLevel];
  const bg = RISK_BG[lookup.riskLevel];
  const warningFlags = lookup.riskFlags.filter((f) => f !== "lookup_failed");

  return (
    <div className="rounded-sm border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-lg text-deep-navy">phone_in_talk</span>
          <h4 className="text-xs font-bold uppercase tracking-widest text-deep-navy">
            Phone Risk Report Card
          </h4>
        </div>
      </div>

      <div className="px-4 py-4 bg-white">
        {/* Risk Score */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-sm font-semibold text-deep-navy">Risk Score</span>
            <span className="text-sm font-bold" style={{ color }}>
              {lookup.riskScore}/100
            </span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-3">
            <div
              className="h-3 rounded-full transition-all duration-500"
              style={{ width: `${lookup.riskScore}%`, backgroundColor: color }}
            />
          </div>
          <div className="mt-1.5">
            <span
              className="inline-block px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider"
              style={{ backgroundColor: bg, color }}
            >
              {lookup.riskLevel}
            </span>
          </div>
        </div>

        {/* Signal Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="bg-slate-50 rounded-sm p-3 text-center">
            <span className="material-symbols-outlined text-lg text-gov-slate mb-1 block">phone_android</span>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Line Type</div>
            <div className="text-sm font-semibold text-deep-navy">{formatLineType(lookup.lineType)}</div>
          </div>
          <div className="bg-slate-50 rounded-sm p-3 text-center">
            <span className="material-symbols-outlined text-lg text-gov-slate mb-1 block">router</span>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Carrier</div>
            <div className="text-sm font-semibold text-deep-navy">{lookup.carrier || "Unknown"}</div>
          </div>
          <div className="bg-slate-50 rounded-sm p-3 text-center">
            <span className="material-symbols-outlined text-lg text-gov-slate mb-1 block">globe</span>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Country</div>
            <div className="text-sm font-semibold text-deep-navy">{lookup.countryCode || "Unknown"}</div>
          </div>
          <div className="bg-slate-50 rounded-sm p-3 text-center">
            <span className="material-symbols-outlined text-lg text-gov-slate mb-1 block">person</span>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Caller</div>
            <div className="text-sm font-semibold text-deep-navy">{lookup.callerName || "Not Reg."}</div>
          </div>
        </div>

        {/* Warning Flags */}
        {warningFlags.length > 0 && (
          <div className="space-y-2 mb-3">
            {warningFlags.map((flag, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="material-symbols-outlined text-sm text-[#F57C00] mt-0.5">warning</span>
                <span className="text-sm text-gov-slate">{formatRiskFlag(flag)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Attribution */}
        <p className="text-xs text-slate-300">
          Powered by Twilio Lookup
        </p>
      </div>
    </div>
  );
}
