"use client";

import { useState } from "react";
import { ArrowRight, Flag } from "lucide-react";

interface Props {
  onCheckAnother: () => void;
  onReport?: () => void;
  /** If true, show the "Report this scam" secondary button. Hidden for SAFE
   *  verdicts or when there's no report surface to route to. */
  showReport?: boolean;
}

export default function ResultActionButtons({
  onCheckAnother,
  onReport,
  showReport = true,
}: Props) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="mt-8">
      {confirming && (
        <div
          role="region"
          aria-label="Confirm report"
          className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-4"
        >
          <p className="text-sm text-gov-slate leading-relaxed">
            We&apos;ll add this to Ask Arthur&apos;s threat feed so we can warn
            others. This is <strong>not a police report</strong> — if you&apos;ve
            lost money or had your identity stolen, also report it to{" "}
            <a
              href="https://www.cyber.gov.au/report-and-recover/report"
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-action-teal-text"
            >
              ReportCyber
            </a>
            . Continue?
          </p>
          <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="min-h-[44px] rounded-full px-4 py-2 text-sm font-semibold text-gov-slate hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                onReport?.();
              }}
              className="min-h-[48px] rounded-full bg-deep-navy px-5 py-2 text-sm font-bold uppercase tracking-widest text-white hover:bg-navy"
            >
              Send report
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        {showReport && onReport && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full border-2 border-gov-slate bg-white px-5 py-2 text-sm font-bold uppercase tracking-widest text-deep-navy hover:bg-slate-50"
          >
            <Flag size={18} aria-hidden="true" />
            Report this scam
          </button>
        )}
        <button
          type="button"
          onClick={onCheckAnother}
          className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-deep-navy px-5 py-2 text-sm font-bold uppercase tracking-widest text-white hover:bg-navy"
        >
          Check something else
          <ArrowRight size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
