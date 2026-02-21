"use client";

import { useState } from "react";
import type { ScammerContacts } from "@/lib/claude";

interface ScammerUrl {
  url: string;
  isMalicious: boolean;
  sources: string[];
}

interface ScamReportCardProps {
  contacts?: ScammerContacts;
  scammerUrls?: ScammerUrl[];
  scamType?: string;
  brandImpersonated?: string;
  channel?: string;
  analysisId?: number;
  sourceType?: string;
}

interface ReportedContact {
  value: string;
  reportCount: number;
  carrier?: string;
  lineType?: string;
}

interface ReportedUrl {
  normalizedUrl: string;
  domain: string;
  reportCount: number;
  whois?: {
    registrar: string | null;
    registrantCountry: string | null;
    domainAgeDays: number | null;
  };
}

type ReportState = "idle" | "reporting" | "reported" | "error" | "dismissed";

export default function ScamReportCard({
  contacts,
  scammerUrls,
  scamType,
  brandImpersonated,
  channel,
  sourceType,
}: ScamReportCardProps) {
  const [state, setState] = useState<ReportState>("idle");
  const [reportedContacts, setReportedContacts] = useState<ReportedContact[]>([]);
  const [reportedUrls, setReportedUrls] = useState<ReportedUrl[]>([]);
  const [errorMsg, setErrorMsg] = useState("");

  // Flatten contacts into a displayable list
  const allContacts = [
    ...(contacts?.phoneNumbers.map((p) => ({ type: "phone" as const, ...p })) || []),
    ...(contacts?.emailAddresses.map((e) => ({ type: "email" as const, ...e })) || []),
  ];

  const allUrls = scammerUrls || [];

  if (allContacts.length === 0 && allUrls.length === 0) return null;
  if (state === "dismissed") return null;

  async function handleReport() {
    setState("reporting");
    setErrorMsg("");

    try {
      const promises: Promise<Response>[] = [];

      // Report contacts if present
      if (allContacts.length > 0) {
        promises.push(
          fetch("/api/scam-contacts/report", {
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
          })
        );
      }

      // Report URLs if present
      if (allUrls.length > 0) {
        promises.push(
          fetch("/api/scam-urls/report", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              urls: allUrls.map((u) => ({
                url: u.url,
                sourceType: sourceType === "qrcode" ? "qr_code" : sourceType || "text",
              })),
              scamType,
              brandImpersonated,
              channel,
              urlCheckResults: allUrls.map((u) => ({
                url: u.url,
                isMalicious: u.isMalicious,
                sources: u.sources,
              })),
            }),
          })
        );
      }

      const responses = await Promise.all(promises);

      // Check if any response failed
      for (const res of responses) {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || "Report failed");
        }
      }

      // Parse successful responses
      let contactIdx = 0;
      if (allContacts.length > 0) {
        const contactData = await responses[contactIdx].json();
        setReportedContacts(contactData.contacts || []);
        contactIdx++;
      }
      if (allUrls.length > 0) {
        const urlData = await responses[contactIdx].json();
        setReportedUrls(urlData.urls || []);
      }

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
            We detected contact details{allUrls.length > 0 ? " and URLs" : ""} that appear to belong to the scammer.
            Reporting them helps warn other Australians.
          </p>

          {/* Contact list */}
          {allContacts.length > 0 && (
            <div className="space-y-2 mb-3">
              {allContacts.map((c, i) => (
                <div
                  key={`contact-${i}`}
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
          )}

          {/* URL list */}
          {allUrls.length > 0 && (
            <div className="space-y-2 mb-3">
              {allUrls.map((u, i) => (
                <div
                  key={`url-${i}`}
                  className="flex items-center gap-2 text-sm bg-slate-50 rounded-lg px-3 py-2"
                >
                  <span className="material-symbols-outlined text-base text-gov-slate">link</span>
                  <span className="font-mono text-deep-navy truncate flex-1">{u.url}</span>
                  {u.isMalicious && (
                    <span className="shrink-0 px-2 py-0.5 bg-red-100 text-red-700 text-xs font-bold rounded-full">
                      Flagged
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

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

          {reportedContacts.length > 0 && (
            <div className="space-y-2 mb-2">
              {reportedContacts.map((c, i) => (
                <div
                  key={`rc-${i}`}
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
          )}

          {reportedUrls.length > 0 && (
            <div className="space-y-2 mb-2">
              {reportedUrls.map((u, i) => (
                <div
                  key={`ru-${i}`}
                  className="flex flex-col gap-1 text-sm bg-slate-50 rounded-lg px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-base text-gov-slate">link</span>
                    <span className="font-mono text-deep-navy truncate">{u.domain}</span>
                    <span className="text-gov-slate text-xs ml-auto">
                      {u.reportCount === 1
                        ? "First report"
                        : `Reported ${u.reportCount} times`}
                    </span>
                  </div>
                  {u.whois && (u.whois.registrar || u.whois.domainAgeDays !== null) && (
                    <p className="text-xs text-gov-slate pl-7">
                      {u.whois.domainAgeDays !== null && (
                        <span>Domain registered {u.whois.domainAgeDays} days ago</span>
                      )}
                      {u.whois.registrantCountry && (
                        <span> in {u.whois.registrantCountry}</span>
                      )}
                      {u.whois.registrar && (
                        <span> via {u.whois.registrar}</span>
                      )}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-gov-slate mt-3">
            Your report helps protect the community. Thank you for making Australia safer.
          </p>
        </>
      )}
    </div>
  );
}
