"use client";

import { CheckCircle2, Search, XCircle, X } from "lucide-react";

interface BulkActionBarProps {
  count: number;
  disabled?: boolean;
  onConfirmAll: () => void;
  onInvestigateAll: () => void;
  onDismissAll: () => void;
  onClear: () => void;
}

/**
 * Floating bulk-action bar shown when ≥1 row is selected. Mirrors the
 * per-row VerdictButton mapping (tp/inv/fp) but applies to N alerts at
 * once. Wired to /api/admin/clone-watch/triage via N parallel POSTs in
 * the parent CloneWatchTriage component.
 *
 * Sticky bottom positioning on mobile + desktop; sits above the iOS
 * home-indicator zone via `bottom: max(env(safe-area-inset-bottom), 12px)`.
 */
export default function BulkActionBar({
  count,
  disabled,
  onConfirmAll,
  onInvestigateAll,
  onDismissAll,
  onClear,
}: BulkActionBarProps) {
  if (count === 0) return null;
  return (
    <div
      className="fixed left-0 right-0 z-40 px-3 lg:px-6"
      style={{ bottom: "max(env(safe-area-inset-bottom), 12px)" }}
    >
      <div
        className="mx-auto flex max-w-3xl items-center gap-2"
        style={{
          background: "#fff",
          border: "1px solid var(--color-line)",
          borderRadius: 14,
          padding: 10,
          boxShadow:
            "0 10px 30px rgba(11,31,58,0.18), 0 2px 6px rgba(11,31,58,0.08)",
        }}
      >
        <div
          className="flex items-center gap-2 shrink-0"
          style={{ paddingLeft: 6, paddingRight: 4 }}
        >
          <span
            className="serif"
            style={{ fontSize: 17, color: "var(--color-ink)" }}
          >
            {count}
          </span>
          <span
            className="uppercase"
            style={{
              fontSize: 10.5,
              letterSpacing: "0.08em",
              color: "var(--color-muted)",
              fontWeight: 600,
            }}
          >
            selected
          </span>
        </div>
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          <BulkButton
            tone="tp"
            icon={CheckCircle2}
            label="Confirm"
            onClick={onConfirmAll}
            disabled={disabled}
          />
          <BulkButton
            tone="inv"
            icon={Search}
            label="Investigate"
            onClick={onInvestigateAll}
            disabled={disabled}
          />
          <BulkButton
            tone="fp"
            icon={XCircle}
            label="Dismiss"
            onClick={onDismissAll}
            disabled={disabled}
          />
        </div>
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear selection"
          className="grid place-items-center shrink-0"
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            border: "1px solid var(--color-line)",
            background: "#fff",
            color: "var(--color-ink-2)",
            padding: 0,
          }}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

interface BulkButtonProps {
  tone: "tp" | "inv" | "fp";
  icon: typeof CheckCircle2;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

const TONE_STYLE: Record<
  BulkButtonProps["tone"],
  { bg: string; fg: string; ring: string }
> = {
  tp: {
    bg: "var(--color-tp-bg)",
    fg: "var(--color-tp-fg)",
    ring: "var(--color-tp-ring)",
  },
  inv: {
    bg: "var(--color-inv-bg)",
    fg: "var(--color-inv-fg)",
    ring: "var(--color-inv-ring)",
  },
  fp: {
    bg: "var(--color-fp-bg)",
    fg: "var(--color-fp-fg)",
    ring: "var(--color-fp-ring)",
  },
};

function BulkButton({
  tone,
  icon: Icon,
  label,
  onClick,
  disabled,
}: BulkButtonProps) {
  const s = TONE_STYLE[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center gap-1.5 truncate"
      style={{
        flex: 1,
        minWidth: 0,
        height: 36,
        padding: "0 8px",
        border: `1px solid ${s.ring}`,
        background: disabled ? "transparent" : s.bg,
        color: s.fg,
        borderRadius: 10,
        fontSize: 13,
        fontWeight: 600,
        whiteSpace: "nowrap",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Icon size={14} strokeWidth={2} />
      <span className="truncate">{label}</span>
    </button>
  );
}
