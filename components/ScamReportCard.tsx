"use client";

import { useState } from "react";
import type { ScammerContacts } from "@/lib/claude";

interface ScamReportCardProps {
  contacts: ScammerContacts;
  scamType?: string;
  brandImpersonated?: string;
  channel?: string;
  analysisId?: number;
}

interface ReportedContact {
  value: string;
  reportCount: number;
  carrier?: string;
  lineType?: string;
}

type ReportState = "idle" | "reporting" | "reported" | "error" | "dismissed";

export default function ScamReportCard({
  contacts,
  scamType,
  brandImpersonated,
  channel,
}: ScamReportCardProps) {
  const [state, setState] = useState<ReportState>("idle");
  const [reportedContacts, setReportedContacts] = useState<ReportedContact[]>([]);
  const [errorMsg, setErrorMsg] = useState("");

  // Flatten contacts into a displayable list
  const allContacts = [
    ...contacts.phoneNumbers.map((p) => ({ type: "phone" as const, ...p })),
    ...contacts.emailAddresses.map((e) => ({ type: "email" as const, ...e })),
  ];

  if (allContacts.length === 0 || state === "dismissed") return null;

  async function handleReport() {
    setState("reporting");
    setErrorMsg("");

    try {
      const res = await fetch("/api/scam-contacts/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contacts: allContacts.map((c) => ({
            type: c.type,
            value: c.value,
            context: c.context,
          })),
          scamType,
          brandImpersonated,
          channel,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Report failed");
      }

      const data = await res.json();
      setReportedContacts(data.contacts || []);
      setState("reported");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong");
      setState("error");
    }
  }

  return (
    <div className="mt-4 rounded-2xl border-2 border-action-teal/30 bg-white p-5">
      {/* Idle state — ask for consent */}
      {(state === "idle" || state === "error") && (
        <>
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-action-teal text-xl">shield</span>
            <h3 className="font-bold text-deep-navy text-base">
              Help protect others from this scammer
            </h3>
          </div>

          <p className="text-gov-slate text-sm mb-3">
            We detected contact details that appear to belong to the scammer.
            Reporting them helps warn other Australians.
          </p>

          {/* Contact list */}
          <div className="space-y-2 mb-4">
            {allContacts.map((c, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-sm bg-slate-50 rounded-lg px-3 py-2"
              >
                <span className="material-symbols-outlined text-base text-gov-slate">
                  {c.type === "phone" ? "phone" : "mail"}
                </span>
                <span className="font-mono text-deep-navy">{c.value}</span>
                {c.context && (
                  <span className="text-gov-slate ml-auto text-xs">{c.context}</span>
                )}
              </div>
            ))}
          </div>

          <p className="text-xs text-gov-slate mb-4">
            Only the scammer&apos;s details are stored — never yours.
          </p>

          {state === "error" && (
            <p className="text-red-600 text-sm mb-3">{errorMsg}</p>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleReport}
              className="h-10 px-5 bg-action-teal text-white font-bold uppercase tracking-widest rounded-full hover:bg-teal-700 transition-colors text-xs"
            >
              Yes, report it
            </button>
            <button
              onClick={() => setState("dismissed")}
              className="h-10 px-5 bg-slate-100 text-gov-slate font-bold uppercase tracking-widest rounded-full hover:bg-slate-200 transition-colors text-xs"
            >
              No thanks
            </button>
          </div>
        </>
      )}

      {/* Reporting state — spinner */}
      {state === "reporting" && (
        <div className="flex items-center gap-3 justify-center py-4">
          <div className="w-5 h-5 border-2 border-action-teal border-t-transparent rounded-full animate-spin" />
          <p className="text-gov-slate text-sm">Submitting report...</p>
        </div>
      )}

      {/* Reported state — confirmation */}
      {state === "reported" && (
        <>
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-action-teal text-xl">
              check_circle
            </span>
            <h3 className="font-bold text-deep-navy text-base">
              Report submitted — thank you!
            </h3>
          </div>

          <div className="space-y-2">
            {reportedContacts.map((c, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-sm bg-slate-50 rounded-lg px-3 py-2"
              >
                <span className="font-mono text-deep-navy">{c.value}</span>
                <span className="text-gov-slate text-xs ml-auto">
                  {c.reportCount === 1
                    ? "First report"
                    : `Reported ${c.reportCount} times`}
                </span>
                {c.carrier && (
                  <span className="text-xs text-gov-slate">
                    {c.carrier}
                    {c.lineType ? ` (${c.lineType})` : ""}
                  </span>
                )}
              </div>
            ))}
          </div>

          <p className="text-xs text-gov-slate mt-3">
            Your report helps protect the community. Thank you for making Australia safer.
          </p>
        </>
      )}
    </div>
  );
}
