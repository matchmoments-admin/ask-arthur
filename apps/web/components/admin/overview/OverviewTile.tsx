import Link from "next/link";
import { ArrowRight } from "lucide-react";

interface OverviewTileProps {
  href: string;
  title: string;
  /** One-line description of the tile's purpose. */
  sub: string;
  /** Primary metric value (the headline number / string). */
  primary: string;
  /** Caption under the primary value. */
  primaryLabel: string;
  /** Optional small foot caption (right-aligned). */
  foot?: string;
  /** Render in warn-tone when above a per-tile threshold. */
  warn?: boolean;
}

export default function OverviewTile({
  href,
  title,
  sub,
  primary,
  primaryLabel,
  foot,
  warn,
}: OverviewTileProps) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-2"
      style={{
        background: warn ? "#FFF7E6" : "var(--color-surface)",
        border: `1px solid ${warn ? "#F3DE92" : "var(--color-line)"}`,
        borderRadius: 14,
        padding: "14px 14px 13px",
        boxShadow: "var(--shadow-card)",
        textAlign: "left",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div
            className="serif"
            style={{ fontSize: 16, lineHeight: 1.15, color: "var(--color-ink)" }}
          >
            {title}
          </div>
          <div
            className="mt-[3px]"
            style={{
              fontSize: 12,
              color: "var(--color-muted)",
              lineHeight: 1.35,
            }}
          >
            {sub}
          </div>
        </div>
        <div
          className="grid place-items-center shrink-0"
          style={{
            width: 26,
            height: 26,
            borderRadius: 8,
            background: "var(--color-teal-soft)",
            color: "var(--color-teal)",
          }}
        >
          <ArrowRight size={14} strokeWidth={1.75} />
        </div>
      </div>
      <div
        className="mt-1 flex items-baseline justify-between gap-2"
        style={{
          paddingTop: 10,
          borderTop: "1px dashed var(--color-line)",
        }}
      >
        <div>
          <div
            className="serif"
            style={{
              fontSize: 20,
              lineHeight: 1,
              color: warn ? "#B45309" : "var(--color-ink)",
            }}
          >
            {primary}
          </div>
          <div
            className="mt-[3px] text-[10.5px] font-semibold uppercase"
            style={{ letterSpacing: "0.08em", color: "var(--color-muted)" }}
          >
            {primaryLabel}
          </div>
        </div>
        {foot && (
          <div
            className="text-right"
            style={{
              fontSize: 11,
              color: "var(--color-muted-2)",
              lineHeight: 1.35,
              maxWidth: "52%",
            }}
          >
            {foot}
          </div>
        )}
      </div>
    </Link>
  );
}
