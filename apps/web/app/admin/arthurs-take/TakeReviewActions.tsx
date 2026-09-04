"use client";

import { useState, useTransition } from "react";

import { recordReview, restoreTake, type ReviewVerdict } from "./actions";

const BTN: React.CSSProperties = {
  padding: "4px 8px",
  fontSize: 12,
  borderRadius: 6,
  border: "1px solid var(--color-line-soft)",
  background: "white",
  cursor: "pointer",
  marginRight: 4,
  marginBottom: 4,
};

const VERDICTS: { value: ReviewVerdict; label: string; danger?: boolean }[] = [
  { value: "agree", label: "Agree" },
  { value: "wrong_type", label: "Wrong type" },
  { value: "not_a_scam", label: "Not a scam" },
  { value: "unsafe_wording", label: "Unsafe wording", danger: true },
  { value: "pii", label: "PII", danger: true },
];

export default function TakeReviewActions({
  intelId,
  status,
  suppressedReason,
}: {
  intelId: string;
  status: string;
  suppressedReason: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const current = done ?? status;
  const reviewSuppressed = (suppressedReason ?? "").startsWith("review_");

  function submit(verdict: ReviewVerdict) {
    setError(null);
    startTransition(async () => {
      const res = await recordReview(intelId, verdict);
      if (!res.ok) {
        setError(res.error ?? "failed");
        return;
      }
      setDone(res.suppressed ? "suppressed" : `reviewed:${verdict}`);
    });
  }

  function restore() {
    setError(null);
    startTransition(async () => {
      const res = await restoreTake(intelId);
      if (!res.ok) {
        setError(res.error ?? "failed");
        return;
      }
      setDone("failed");
    });
  }

  return (
    <div>
      {VERDICTS.map((v) => (
        <button
          key={v.value}
          type="button"
          disabled={pending}
          onClick={() => submit(v.value)}
          style={{
            ...BTN,
            borderColor: v.danger ? "#dc2626" : BTN.borderColor,
            color: v.danger ? "#dc2626" : undefined,
          }}
        >
          {v.label}
        </button>
      ))}

      {/* Only a review-suppressed take can be restored. A validator refusal is
          an automated content decision and should not be reversible from a
          button — regenerate it instead. */}
      {reviewSuppressed ? (
        <button
          type="button"
          disabled={pending}
          onClick={restore}
          style={BTN}
        >
          Restore (requeue)
        </button>
      ) : null}

      {done ? (
        <div style={{ fontSize: 12, color: "var(--color-muted)", marginTop: 4 }}>
          → {current}
        </div>
      ) : null}
      {error ? (
        <div style={{ fontSize: 12, color: "#dc2626", marginTop: 4 }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
