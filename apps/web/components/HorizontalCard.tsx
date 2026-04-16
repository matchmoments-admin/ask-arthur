import Link from "next/link";
import type { ReactNode } from "react";

export type HorizontalCardSize = "sm" | "lg";

interface HorizontalCardProps {
  title: string;
  description?: string;
  leading?: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  highlighted?: boolean;
  badge?: string;
  size?: HorizontalCardSize;
  href?: string;
  className?: string;
}

const BASE =
  "relative bg-white border rounded-xl shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all";

export default function HorizontalCard({
  title,
  description,
  leading,
  meta,
  trailing,
  highlighted = false,
  badge,
  size = "sm",
  href,
  className = "",
}: HorizontalCardProps) {
  const isLg = size === "lg";

  const padding = isLg ? "p-5 md:p-6" : "p-4";
  const layout = isLg
    ? "flex flex-col md:flex-row md:items-center gap-4 md:gap-6"
    : "flex items-center gap-4";
  const borderClass = highlighted
    ? "border-deep-navy ring-2 ring-deep-navy/15 bg-deep-navy/[0.02]"
    : "border-border-light";

  const titleNode = href ? (
    <Link
      href={href}
      className="font-semibold text-deep-navy text-sm hover:underline focus:outline-none focus-visible:underline after:content-[''] after:absolute after:inset-0"
    >
      {title}
    </Link>
  ) : (
    <span className="font-semibold text-deep-navy text-sm md:text-base">
      {title}
    </span>
  );

  return (
    <div className={`${BASE} ${borderClass} ${padding} ${layout} ${className}`}>
      {leading ? <div className="shrink-0">{leading}</div> : null}

      <div className={isLg ? "flex-1 min-w-0" : "min-w-0"}>
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="m-0 leading-tight">{titleNode}</h3>
          {badge ? (
            <span className="bg-deep-navy text-white text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full">
              {badge}
            </span>
          ) : null}
        </div>
        {description ? (
          <p className="text-xs text-gov-slate mt-1 leading-snug">
            {description}
          </p>
        ) : null}

        {isLg && meta ? <div className="mt-4">{meta}</div> : null}
      </div>

      {isLg && trailing ? (
        <div className="md:shrink-0 md:min-w-[160px] relative z-10">
          {trailing}
        </div>
      ) : null}
    </div>
  );
}
