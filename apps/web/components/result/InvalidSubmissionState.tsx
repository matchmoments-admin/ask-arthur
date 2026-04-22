"use client";

import { Info } from "lucide-react";

interface Props {
  referenceId?: string;
  attemptCount?: number;
  onRetry?: () => void;
  onUploadScreenshot?: () => void;
}

/**
 * Info-blue panel for unreadable / blocked / unscrapeable submissions.
 * Uses "we" not "you", provides two alternate paths, and escalates to IDCARE
 * after the third attempt.
 */
export default function InvalidSubmissionState({
  referenceId,
  attemptCount = 1,
  onRetry,
  onUploadScreenshot,
}: Props) {
  const showIdcare = attemptCount >= 3;

  return (
    <section
      role="region"
      aria-labelledby="invalid-submission-heading"
      className="mt-6 rounded-lg border border-slate-200 border-l-4 border-l-action-teal bg-[color:var(--color-action-teal)]/5 p-5"
    >
      <div className="flex gap-3">
        <Info
          size={24}
          aria-hidden="true"
          className="mt-0.5 flex-shrink-0 text-action-teal"
        />
        <div className="flex-1">
          <h2
            id="invalid-submission-heading"
            className="text-lg font-bold text-deep-navy"
          >
            We couldn&apos;t see that site directly
          </h2>
          <p className="mt-2 text-gov-slate leading-relaxed">
            Some sites block automated checks — scam sites often do this on
            purpose, so it can be a warning sign in itself. Try one of these
            instead:
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-gov-slate leading-relaxed">
            <li>Take a screenshot of what you&apos;re worried about and upload it.</li>
            <li>Paste the text of the message into the box above.</li>
          </ul>
          <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row">
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex min-h-[48px] items-center justify-center rounded-full border-2 border-gov-slate bg-white px-5 py-2 text-sm font-bold uppercase tracking-widest text-deep-navy hover:bg-slate-50"
              >
                Try again
              </button>
            )}
            {onUploadScreenshot && (
              <button
                type="button"
                onClick={onUploadScreenshot}
                className="inline-flex min-h-[48px] items-center justify-center rounded-full bg-deep-navy px-5 py-2 text-sm font-bold uppercase tracking-widest text-white hover:bg-navy"
              >
                Upload a screenshot
              </button>
            )}
          </div>
          {showIdcare && (
            <p className="mt-4 text-sm text-gov-slate">
              Still stuck? IDCARE offers free support on{" "}
              <a href="tel:1800595160" className="underline text-action-teal-text font-semibold">
                1800 595 160
              </a>{" "}
              (Mon–Fri 8am–5pm AEST).
            </p>
          )}
          {referenceId && (
            <p className="mt-3 text-xs text-slate-400">Reference: {referenceId}</p>
          )}
        </div>
      </div>
    </section>
  );
}
