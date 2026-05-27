"use client";

import { Menu } from "lucide-react";

interface TopBarProps {
  /** Page title displayed under the eyebrow on mobile. Derived from
   *  NAV_SECTIONS lookup in AdminShell — falls back to "Admin". */
  title: string;
  /** Open the mobile drawer. */
  onMenu: () => void;
}

/**
 * Sticky mobile top bar. Hidden on desktop (≥lg) — the permanent rail
 * provides nav, and each page's H1 carries the title.
 */
export default function TopBar({ title, onMenu }: TopBarProps) {
  return (
    <div
      className="lg:hidden sticky top-0 z-20"
      style={{
        background: "rgba(255,255,255,0.92)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderBottom: "1px solid var(--color-line)",
      }}
    >
      <div
        className="flex items-center gap-2.5"
        style={{
          padding: "10px 14px",
        }}
      >
        <button
          type="button"
          onClick={onMenu}
          aria-label="Open menu"
          className="grid place-items-center shrink-0"
          style={{
            width: 38,
            height: 38,
            borderRadius: 10,
            border: "1px solid var(--color-line)",
            background: "#fff",
            padding: 0,
          }}
        >
          <Menu size={18} className="text-[var(--color-ink)]" />
        </button>
        <div className="flex-1 min-w-0">
          <div
            className="text-[10.5px] font-semibold uppercase tracking-[0.09em]"
            style={{ color: "var(--color-muted)" }}
          >
            Ask Arthur · admin
          </div>
          <div
            className="serif text-[17px] leading-[1.1] truncate"
            style={{ color: "var(--color-ink)" }}
          >
            {title}
          </div>
        </div>
        <span
          aria-hidden
          className="grid place-items-center text-white font-semibold shrink-0"
          style={{
            width: 38,
            height: 38,
            borderRadius: "50%",
            border: "1px solid var(--color-line)",
            background: "linear-gradient(135deg,#0B1F3A 0%,#1B3257 100%)",
            fontSize: 13,
          }}
        >
          AA
        </span>
      </div>
    </div>
  );
}
