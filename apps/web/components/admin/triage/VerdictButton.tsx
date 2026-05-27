"use client";

import { CheckCircle2, Search, XCircle } from "lucide-react";
import type { VerdictKind } from "./types";

interface VerdictMeta {
  bg: string;
  fg: string;
  ring: string;
  label: string;
  icon: typeof CheckCircle2;
}

// Labels rephrased 2026-05-28 (PR-C): "TP/FP/Investigate" is infosec-triage
// jargon that's hostile to anyone not steeped in intrusion-detection terms.
// The DB enum values (tp_confirmed / fp / needs_investigation) are unchanged
// so RPC contracts + downstream consumers keep working — this is a UI-only
// rename.
const KIND_META: Record<VerdictKind, VerdictMeta> = {
  tp: {
    bg: "var(--color-tp-bg)",
    fg: "var(--color-tp-fg)",
    ring: "var(--color-tp-ring)",
    label: "Confirm clone",
    icon: CheckCircle2,
  },
  inv: {
    bg: "var(--color-inv-bg)",
    fg: "var(--color-inv-fg)",
    ring: "var(--color-inv-ring)",
    label: "Park",
    icon: Search,
  },
  fp: {
    bg: "var(--color-fp-bg)",
    fg: "var(--color-fp-fg)",
    ring: "var(--color-fp-ring)",
    label: "Not a clone",
    icon: XCircle,
  },
};

interface VerdictButtonProps {
  kind: VerdictKind;
  onClick: () => void;
  disabled?: boolean;
  compact?: boolean;
  fullLabel?: string;
}

export default function VerdictButton({
  kind,
  onClick,
  disabled,
  compact,
  fullLabel,
}: VerdictButtonProps) {
  const meta = KIND_META[kind];
  const Icon = meta.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center gap-1.5 truncate"
      style={{
        flex: 1,
        minWidth: 0,
        height: compact ? 36 : 40,
        padding: "0 10px",
        border: `1px solid ${meta.ring}`,
        background: disabled ? "transparent" : meta.bg,
        color: meta.fg,
        borderRadius: 10,
        fontSize: 13,
        fontWeight: 600,
        whiteSpace: "nowrap",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Icon size={14} strokeWidth={2} />
      <span className="truncate">{fullLabel ?? meta.label}</span>
    </button>
  );
}
