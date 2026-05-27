"use client";

import { CheckSquare, Square } from "lucide-react";

interface BrandGroupHeaderProps {
  brand: string;
  count: number;
  /** True when every row in the group is already selected. */
  allSelected: boolean;
  onToggleAll: () => void;
}

/**
 * Shown above the first row of any brand whose group has ≥2 pending
 * alerts. Lets the admin "Select all 5 kmart.com.au alerts" in one tap.
 * The check icon flips when every alert in the group is already
 * selected, so re-tapping the header deselects the whole group.
 */
export default function BrandGroupHeader({
  brand,
  count,
  allSelected,
  onToggleAll,
}: BrandGroupHeaderProps) {
  const Icon = allSelected ? CheckSquare : Square;
  return (
    <button
      type="button"
      onClick={onToggleAll}
      className="w-full flex items-center gap-2"
      style={{
        padding: "10px 14px",
        background: allSelected
          ? "var(--color-teal-soft)"
          : "var(--color-surface-2)",
        border: "none",
        borderTop: "1px solid var(--color-line-soft)",
        borderBottom: "1px solid var(--color-line-soft)",
        textAlign: "left",
        cursor: "pointer",
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
  );
}
