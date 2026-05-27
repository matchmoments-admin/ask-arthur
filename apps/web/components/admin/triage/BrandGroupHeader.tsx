"use client";

import { CheckSquare, Square, XCircle } from "lucide-react";

interface BrandGroupHeaderProps {
  brand: string;
  count: number;
  /** True when every row in the group is already selected. */
  allSelected: boolean;
  onToggleAll: () => void;
  /**
   * Optional one-click "mark every row in this group as Not a clone"
   * action. When set, a secondary inline button surfaces next to "Select
   * all" — saves the three-tap flow (select all → focus bar → click
   * Not a clone) for matcher-noise days where N FPs all share a brand.
   * No Confirm-all equivalent: every TP must be individually intentional
   * (it triggers an outbound email).
   */
  onBulkDismiss?: () => void;
  disabled?: boolean;
}

/**
 * Shown above the first row of any brand whose group has ≥2 pending
 * alerts. Lets the admin "Select all 5 kmart.com.au alerts" in one tap.
 * The check icon flips when every alert in the group is already
 * selected, so re-tapping the header deselects the whole group.
 *
 * PR-F (#495) — added `onBulkDismiss` as a sibling action so common
 * noise-day workflows (10x FP on a single brand) compress to one click.
 */
export default function BrandGroupHeader({
  brand,
  count,
  allSelected,
  onToggleAll,
  onBulkDismiss,
  disabled,
}: BrandGroupHeaderProps) {
  const Icon = allSelected ? CheckSquare : Square;
  return (
    <div
      className="w-full flex items-stretch"
      style={{
        background: allSelected
          ? "var(--color-teal-soft)"
          : "var(--color-surface-2)",
        borderTop: "1px solid var(--color-line-soft)",
        borderBottom: "1px solid var(--color-line-soft)",
      }}
    >
      <button
        type="button"
        onClick={onToggleAll}
        disabled={disabled}
        className="flex-1 flex items-center gap-2 disabled:opacity-50"
        style={{
          padding: "10px 14px",
          background: "transparent",
          border: "none",
          textAlign: "left",
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        <Icon
          size={16}
          strokeWidth={1.75}
          style={{ color: allSelected ? "var(--color-teal)" : "var(--color-muted)" }}
        />
        <span
          className="text-[12.5px]"
          style={{ color: "var(--color-ink-2)", fontWeight: 500 }}
        >
          {allSelected ? "Selected" : "Select all"}{" "}
          <span className="serif" style={{ color: "var(--color-ink)" }}>
            {count}
          </span>{" "}
          <span className="mono" style={{ color: "var(--color-ink-2)" }}>
            {brand}
          </span>{" "}
          alerts
        </span>
      </button>
      {onBulkDismiss && (
        <button
          type="button"
          onClick={onBulkDismiss}
          disabled={disabled}
          aria-label={`Mark all ${count} ${brand} alerts as Not a clone`}
          title={`Mark all ${count} as Not a clone`}
          className="flex items-center gap-1.5 shrink-0 disabled:opacity-50"
          style={{
            padding: "0 12px",
            background: "transparent",
            border: "none",
            borderLeft: "1px solid var(--color-line-soft)",
            color: "var(--color-fp-fg)",
            fontSize: 12,
            fontWeight: 600,
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          <XCircle size={13} />
          <span className="hidden sm:inline">Not a clone</span>
        </button>
      )}
    </div>
  );
}
