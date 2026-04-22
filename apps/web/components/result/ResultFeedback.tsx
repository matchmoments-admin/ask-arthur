"use client";

import { useState, useTransition } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";

type Vote = "up" | "down" | null;
type Verdict = "SAFE" | "SUSPICIOUS" | "HIGH_RISK" | "UNCERTAIN";

const DOWN_REASONS: Array<{ code: string; label: string }> = [
  { code: "not_a_scam", label: "This isn't actually a scam" },
  { code: "missed_something", label: "You missed something important" },
  { code: "too_confusing", label: "The answer was confusing" },
  { code: "wrong_details", label: "Details were wrong" },
  { code: "other", label: "Something else" },
];

interface Props {
  verdictGiven: Verdict;
  analysisId?: string;
  scamReportId?: number;
  contentHash?: string;
}

export default function ResultFeedback({
  verdictGiven,
  analysisId,
  scamReportId,
  contentHash,
}: Props) {
  const [vote, setVote] = useState<Vote>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [isPending, startTransition] = useTransition();

  function post(userSays: "correct" | "false_positive" | "false_negative") {
    startTransition(async () => {
      try {
        await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            verdictGiven,
            userSays,
            analysisId,
            scamReportId,
            contentHash,
            reasonCodes: reasons,
            comment: comment.trim() || undefined,
            trainingConsent: consent,
            locale: typeof navigator !== "undefined" ? navigator.language || "en-AU" : "en-AU",
          }),
        });
      } catch {
        // Swallow — feedback is best-effort. Do not pollute the UI with a
        // transient network blip on a non-critical signal.
      }
      setSubmitted(true);
    });
  }

  function handleDownSubmit() {
    const userSays =
      verdictGiven === "SAFE" ? "false_negative" : "false_positive";
    post(userSays);
  }

  if (submitted) {
    return (
      <p
        role="status"
        aria-live="polite"
        className="mt-6 text-sm text-gov-slate"
      >
        Thanks — that helps us recognise scams better.
      </p>
    );
  }

  return (
    <section className="mt-6" aria-labelledby="result-feedback-label">
      <div className="flex items-center gap-3 flex-wrap">
        <span
          id="result-feedback-label"
          className="text-sm font-semibold text-deep-navy"
        >
          Was this check helpful?
        </span>

        <button
          type="button"
          aria-pressed={vote === "up"}
          aria-label="Yes, this check was helpful"
          disabled={isPending}
          onClick={() => {
            setVote("up");
            post("correct");
          }}
          className={`inline-flex h-12 w-12 items-center justify-center rounded-full border transition-colors disabled:opacity-50 ${
            vote === "up"
              ? "border-deep-navy bg-deep-navy text-white"
              : "border-slate-300 bg-white text-gov-slate hover:border-slate-500"
          }`}
        >
          <ThumbsUp size={20} aria-hidden="true" />
        </button>

        <button
          type="button"
          aria-pressed={vote === "down"}
          aria-label="No, this check wasn't helpful"
          disabled={isPending}
          onClick={() => setVote("down")}
          className={`inline-flex h-12 w-12 items-center justify-center rounded-full border transition-colors disabled:opacity-50 ${
            vote === "down"
              ? "border-alert-amber bg-amber-50 text-alert-amber"
              : "border-slate-300 bg-white text-gov-slate hover:border-slate-500"
          }`}
        >
          <ThumbsDown size={20} aria-hidden="true" />
        </button>
      </div>

      {vote === "down" && (
        <div
          role="region"
          aria-label="Tell us what went wrong"
          className="mt-4 space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4"
        >
          <p className="text-sm font-semibold text-deep-navy">
            What went wrong?
          </p>
          <div className="flex flex-wrap gap-2">
            {DOWN_REASONS.map((r) => {
              const on = reasons.includes(r.code);
              return (
                <button
                  key={r.code}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setReasons((rs) =>
                      on ? rs.filter((x) => x !== r.code) : [...rs, r.code]
                    )
                  }
                  className={`min-h-[40px] rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    on
                      ? "border-alert-amber bg-amber-50 text-alert-amber"
                      : "border-slate-300 bg-white text-gov-slate hover:border-slate-500"
                  }`}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
          <label className="block">
            <span className="sr-only">Optional details</span>
            <textarea
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={2000}
              placeholder="Anything else we should know? (optional)"
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base text-deep-navy placeholder:text-slate-400"
            />
          </label>
          <label className="flex items-start gap-2 text-sm text-gov-slate">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-1"
            />
            <span>
              Help Arthur get better — use my de-identified check to train our
              models. You can delete it any time in Settings.
            </span>
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setVote(null);
                setReasons([]);
                setComment("");
                setConsent(false);
              }}
              className="min-h-[44px] rounded-full px-4 py-2 text-sm font-semibold text-gov-slate hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={handleDownSubmit}
              className="min-h-[44px] rounded-full bg-deep-navy px-4 py-2 text-sm font-bold uppercase tracking-widest text-white hover:bg-navy disabled:opacity-50"
            >
              {isPending ? "Sending..." : "Send feedback"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
