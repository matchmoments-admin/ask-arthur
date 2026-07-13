import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

// Shared feature card — the icon-left / title / description shell first used
// inline on the About page ("A suite of tools, one idea"). Extracted so About,
// the clone-watch info cards, and each clone-watch domain entry all render the
// same card (single source of truth for the border / hover / spacing).
//
// Presentational only (no hooks) so it's safe in both server and client trees.
//
// - `align="start"` (default) is the About/info-card layout (icon nudged to the
//   title baseline).
// - `align="center"` is the compact horizontal row used by the domain list
//   (a leading dot + inline title + a trailing meta cluster).

interface FeatureCardProps {
  /** Lucide icon rendered in the site's action-teal at 22px. Ignored if `leading` is set. */
  icon?: LucideIcon;
  /** Custom leading node (e.g. a coloured status dot) — overrides `icon`. */
  leading?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** When set, the whole card is a link (used by About's tool cards). */
  href?: string;
  /** Right-aligned meta cluster (e.g. type label + age on domain rows). */
  trailing?: ReactNode;
  align?: "start" | "center";
  className?: string;
  children?: ReactNode;
}

const SHELL =
  "block p-4 bg-white border border-border-light rounded-xl hover:border-action-teal/40 hover:shadow-sm transition-all";

export default function FeatureCard({
  icon: Icon,
  leading,
  title,
  description,
  href,
  trailing,
  align = "start",
  className = "",
  children,
}: FeatureCardProps) {
  const inner = (
    <div className={`flex gap-4 ${align === "center" ? "items-center" : "items-start"}`}>
      {leading ? (
        <div className="shrink-0">{leading}</div>
      ) : Icon ? (
        <Icon
          size={22}
          className={`text-action-teal shrink-0 ${align === "start" ? "mt-1" : ""}`}
        />
      ) : null}

      <div className="min-w-0 flex-1">
        <div className="font-semibold text-deep-navy">{title}</div>
        {description ? (
          <p className="text-sm text-gov-slate mt-1 leading-relaxed">{description}</p>
        ) : null}
        {children}
      </div>

      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className={`${SHELL} ${className}`}>
        {inner}
      </Link>
    );
  }
  return <div className={`${SHELL} ${className}`}>{inner}</div>;
}
