"use client";

import { Info } from "lucide-react";

interface Props {
  referenceId?: string;
  attemptCount?: number;
  onRetry?: () => void;
  onUploadScreenshot?: () => void;
}

/**
 * Info-blue panel for a failed analysis attempt. This is the generic handler
 * for ANY /api/analyze failure (a transient AI overload, a network blip, a
 * 500) — it must not assume a URL/site was ever involved, since text- and
 * image-only submissions fail through here too. Uses "we" not "you", offers
 * a retry path, and escalates to IDCARE after the third attempt.
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
            We couldn&apos;t finish that check
          </h2>
          <p className="mt-2 text-gov-slate leading-relaxed">
            Something went wrong at our end — our checker is sometimes briefly
            busy. Nothing you sent was stored. Here&apos;s what to try:
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-gov-slate leading-relaxed">
            <li>Try again — most checks go through on a second attempt.</li>
            <li>
              Still stuck? Paste the message as text instead of a screenshot.
            </li>
          </ul>
          <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row">
            {onUploadScreenshot && (
              <button
                type="button"
                onClick={onUploadScreenshot}
                className="inline-flex min-h-[48px] items-center justify-center rounded-full border-2 border-gov-slate bg-white px-5 py-2 text-sm font-bold uppercase tracking-widest text-deep-navy hover:bg-slate-50"
              >
                Upload a screenshot
              </button>
            )}
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex min-h-[48px] items-center justify-center rounded-full bg-deep-navy px-5 py-2 text-sm font-bold uppercase tracking-widest text-white hover:bg-navy"
              >
                Try again
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
