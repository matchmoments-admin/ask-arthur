import Link from "next/link";

const SLUG_COLORS: Record<string, { bg: string; text: string; hover: string }> = {
  "scam-alerts": { bg: "bg-red-50", text: "text-red-700", hover: "hover:bg-red-100" },
  guides: { bg: "bg-teal-50", text: "text-teal-700", hover: "hover:bg-teal-100" },
  product: { bg: "bg-indigo-50", text: "text-indigo-700", hover: "hover:bg-indigo-100" },
  security: { bg: "bg-amber-50", text: "text-amber-700", hover: "hover:bg-amber-100" },
  "real-stories": { bg: "bg-purple-50", text: "text-purple-700", hover: "hover:bg-purple-100" },
};

const FALLBACK = { bg: "bg-slate-100", text: "text-slate-600", hover: "hover:bg-slate-200" };

const BASE = "inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium transition-colors";

interface PillProps {
  label: string;
  /** Slug for per-category colour lookup (blog categories) */
  slug?: string | null;
  /** Render as Next.js Link */
  href?: string;
  /** Interactive filter mode — active/inactive toggle */
  active?: boolean;
  onClick?: () => void;
  /** Hex colour for inline styling (feed category badges) */
  color?: string;
}

export default function Pill({ label, slug, href, active, onClick, color }: PillProps) {
  // Interactive filter variant
  if (onClick !== undefined) {
    return (
      <button
        onClick={onClick}
        className={`${BASE} ${
          active
            ? "bg-deep-navy text-white"
            : "bg-slate-100 text-gov-slate hover:bg-slate-200"
        }`}
      >
        {label}
      </button>
    );
  }

  // Inline colour variant (feed category badges)
  if (color) {
    const style = { backgroundColor: `${color}15`, color };
    if (href) {
      return (
        <Link href={href} className={BASE} style={style}>
          {label}
        </Link>
      );
    }
    return (
      <span className={BASE} style={style}>
        {label}
      </span>
    );
  }

  // Slug-based colour variant (blog category pills)
  const scheme = (slug && SLUG_COLORS[slug]) || FALLBACK;

  if (href) {
    return (
      <Link href={href} className={`${BASE} ${scheme.bg} ${scheme.text} ${scheme.hover}`}>
        {label}
      </Link>
    );
  }

  return (
    <span className={`${BASE} ${scheme.bg} ${scheme.text}`}>
      {label}
    </span>
  );
}
