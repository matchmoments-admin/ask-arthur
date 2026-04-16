import Link from "next/link";
import { Clock, ShieldAlert, TrendingDown, Eye } from "lucide-react";

interface SectorHeroProps {
  headline: string;
  subheadline: string;
  sector: string;
  ctaLabel?: string;
  ctaHref?: string;
}

export default function SectorHero({
  headline,
  subheadline,
  ctaLabel = "Book a Demo",
  ctaHref = "#lead-form",
}: SectorHeroProps) {
  return (
    <section className="mb-16">
      {/* Regulatory urgency banner */}
      <div className="bg-alert-amber/10 border border-alert-amber/30 rounded-xl px-4 py-3 mb-8 flex items-center gap-2 text-sm font-semibold text-alert-amber">
        <Clock size={16} className="shrink-0" />
        <span>SPF Act sector codes take effect 1 July 2026</span>
      </div>

      {/* Headline */}
      <h1 className="text-deep-navy text-4xl font-extrabold leading-tight mb-4">
        {headline}
      </h1>

      {/* Subheadline */}
      <p className="text-gov-slate text-lg leading-relaxed mb-8 max-w-[720px]">
        {subheadline}
      </p>

      {/* CTAs */}
      <div className="flex flex-wrap gap-4 mb-8">
        <Link
          href={ctaHref}
          className="inline-flex items-center px-6 py-3 bg-trust-teal text-white font-semibold rounded-xl hover:bg-trust-teal/90 transition-colors"
        >
          {ctaLabel}
        </Link>
        <Link
          href="/spf-assessment"
          className="inline-flex items-center px-6 py-3 border-2 border-trust-teal text-trust-teal font-semibold rounded-xl hover:bg-trust-teal/5 transition-colors"
        >
          Check Your SPF Readiness
        </Link>
      </div>

      {/* Stat badges */}
      <div className="flex flex-wrap gap-3">
        <span className="inline-flex items-center gap-1.5 bg-danger-bg text-danger-text text-sm font-medium px-3 py-1.5 rounded-full border border-danger-border">
          <ShieldAlert size={14} />
          $52.7M max penalty
        </span>
        <span className="inline-flex items-center gap-1.5 bg-warn-bg text-warn-text text-sm font-medium px-3 py-1.5 rounded-full border border-warn-border">
          <TrendingDown size={14} />
          $2.18B annual scam losses
        </span>
        <span className="inline-flex items-center gap-1.5 bg-slate-50 text-gov-slate text-sm font-medium px-3 py-1.5 rounded-full border border-border-light">
          <Eye size={14} />
          13% detection rate
        </span>
      </div>
    </section>
  );
}
