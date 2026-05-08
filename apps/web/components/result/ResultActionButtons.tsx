"use client";

import { ArrowRight, Flag } from "lucide-react";

interface Props {
  onCheckAnother: () => void;
  /** Click handler for "Report this scam". The parent (ResultCard) opens
   *  the OnwardReportPicker, which provides granular per-destination
   *  consent — so this component no longer wraps an inline confirmation. */
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
  return (
    <div className="mt-8">
      <div className="flex flex-col-reverse gap-3">
        {showReport && onReport && (
          <button
            type="button"
            onClick={onReport}
            className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full border-2 border-danger-text bg-white px-5 py-3 text-base font-bold text-danger-text hover:bg-danger-bg"
          >
            <Flag size={18} aria-hidden="true" />
            Report this scam
          </button>
        )}
        <button
          type="button"
          onClick={onCheckAnother}
          className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-deep-navy px-5 py-3 text-base font-bold text-white hover:bg-navy"
        >
          Check something else
          <ArrowRight size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
