"use client";

import { useState } from "react";
import { CheckCircle, Clock, ExternalLink, Copy, AlertCircle } from "lucide-react";
import {
  buildEvidenceBlock,
  getDeepLink,
  IDCARE_PHONE,
  type EvidenceContext,
  type OnwardResultRow,
} from "@/lib/onward/destinations";

interface Props {
  results: OnwardResultRow[];
  evidence: EvidenceContext;
}

const STATUS_LABEL: Record<string, string> = {
  sent: "Sent",
  queued: "Queued",
  skipped: "Open in tab",
  manual_review: "Awaiting review",
  failed: "Needs your help",
};

const STATUS_TONE: Record<string, string> = {
  sent: "text-emerald-700 bg-emerald-50 border-emerald-200",
  queued: "text-blue-700 bg-blue-50 border-blue-200",
  skipped: "text-amber-800 bg-amber-50 border-amber-200",
  manual_review: "text-slate-700 bg-slate-50 border-slate-200",
  failed: "text-red-700 bg-red-50 border-red-200",
};

/**
 * "Here's what we did" panel shown after the user submits the picker.
 * For each result, render the destination name + status badge. For the
 * skipped destinations (Scamwatch, ReportCyber, IDCARE) include a deep-link
 * button + Copy-evidence button so the user can paste into the destination's
 * form.
 */
export default function OnwardReportSummary({ results, evidence }: Props) {
  const evidenceBlock = buildEvidenceBlock(evidence);
  const [copied, setCopied] = useState<string | null>(null);

  async function copyEvidence(key: string) {
    try {
      await navigator.clipboard.writeText(evidenceBlock);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* clipboard API may be blocked; fail silently */
    }
  }

  return (
    <section
      className="mt-6 rounded-2xl border border-border-light bg-white p-5"
      role="region"
      aria-labelledby="onward-summary-heading"
    >
      <div className="flex items-center gap-2 mb-1">
        <CheckCircle className="text-action-teal" size={20} aria-hidden="true" />
        <h3
          id="onward-summary-heading"
          className="font-bold text-deep-navy text-base"
        >
          Here&apos;s what we did
        </h3>
      </div>
      <p className="text-sm text-gov-slate mb-3">
        We forwarded your report to the destinations you picked. Some places
        don&apos;t accept automated submissions yet — for those, we&apos;ve copied
        an evidence block so you can paste straight into their form.
      </p>

      <ul className="space-y-2">
        {results.map((r, i) => {
          const statusKey = r.status in STATUS_LABEL ? r.status : "queued";
          const deepLink = getDeepLink(r.destination, false);
          const isSkipped = r.status === "skipped";
          const idcareTouch = r.destination === "idcare";
          return (
            <li
              key={`${r.destination}-${r.destination_key}-${i}`}
              className={`rounded-lg border p-3 ${STATUS_TONE[statusKey]}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="font-semibold text-sm text-deep-navy">
                  {r.display_name}
                </div>
                <span
                  className={`shrink-0 px-2 py-0.5 text-xs font-bold uppercase tracking-widest rounded-full ${STATUS_TONE[statusKey]}`}
                >
                  {STATUS_LABEL[statusKey]}
                </span>
              </div>

              {r.status === "manual_review" && (
                <p className="mt-2 text-xs text-slate-700">
                  We hold the first few reports to each brand for human review
                  before sending. We&apos;ll process this within 24 hours.
                </p>
              )}

              {r.status === "failed" && (
                <div className="mt-2 flex items-start gap-2 text-xs text-red-800">
                  <AlertCircle size={14} className="mt-0.5" aria-hidden="true" />
                  Something went wrong. Try again later or contact us at
                  brendan@askarthur.au.
                </div>
              )}

              {isSkipped && (deepLink || idcareTouch) && (
                <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
                  {idcareTouch ? (
                    <a
                      href={`tel:${IDCARE_PHONE.replace(/\s/g, "")}`}
                      className="inline-flex min-h-[40px] items-center justify-center rounded-full border border-amber-700 bg-white px-4 py-2 text-xs font-bold uppercase tracking-widest text-amber-900 hover:bg-amber-50"
                    >
                      Call IDCARE on {IDCARE_PHONE}
                    </a>
                  ) : (
                    deepLink && (
                      <a
                        href={deepLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-full border border-amber-700 bg-white px-4 py-2 text-xs font-bold uppercase tracking-widest text-amber-900 hover:bg-amber-50"
                      >
                        <ExternalLink size={14} aria-hidden="true" />
                        Open form
                      </a>
                    )
                  )}
                  {!idcareTouch && (
                    <button
                      type="button"
                      onClick={() => copyEvidence(`${r.destination}-${i}`)}
                      className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-full bg-deep-navy px-4 py-2 text-xs font-bold uppercase tracking-widest text-white hover:bg-navy"
                    >
                      {copied === `${r.destination}-${i}` ? (
                        <>
                          <Clock size={14} aria-hidden="true" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy size={14} aria-hidden="true" />
                          Copy evidence
                        </>
                      )}
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p className="mt-4 text-xs text-gov-slate">
        Reports to Scamwatch help build a national picture. They&apos;re{" "}
        <strong>not a police report</strong> — if you&apos;ve lost money, also
        report it to ReportCyber.
      </p>
    </section>
  );
}
