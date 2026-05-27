"use client";

import type { LucideIcon } from "lucide-react";

interface UtilButtonProps {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  href?: string;
  title?: string;
  disabled?: boolean;
}

/**
 * Compact utility action (Copy / Open / Scan). Renders as <a> when
 * `href` is supplied so it can carry rel/target attributes; otherwise
 * <button> with an onClick handler.
 */
export default function UtilButton({
  icon: Icon,
  label,
  onClick,
  href,
  title,
  disabled,
}: UtilButtonProps) {
  const sharedClassName = "flex items-center justify-center gap-1.5 truncate";
  const sharedStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    height: 32,
    padding: "0 6px",
    border: "1px solid var(--color-line)",
    background: "var(--color-surface)",
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 500,
    color: "var(--color-ink-2)",
    whiteSpace: "nowrap",
    opacity: disabled ? 0.4 : 1,
  };

  if (href) {
    return (
      <a
        href={href}
        title={title}
        target="_blank"
        rel="noopener noreferrer"
        className={sharedClassName}
        style={sharedStyle}
      >
        <Icon size={13} strokeWidth={1.75} />
        <span className="truncate">{label}</span>
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={sharedClassName}
      style={sharedStyle}
    >
      <Icon size={13} strokeWidth={1.75} />
      <span className="truncate">{label}</span>
    </button>
  );
}
