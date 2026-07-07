import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAdmin } from "@/lib/adminAuth";
import { featureFlags } from "@askarthur/utils/feature-flags";
import AustraliaMap from "@/components/charts/AustraliaMap";
import {
  PARTNER_FRAMING,
  AU_JURISDICTIONS,
  resolvePartnerType,
  resolveJurisdiction,
} from "@/lib/partner/framing";
import {
  getJurisdictionThreatPicture,
  getJurisdictionTrend,
  getRouteClickFunnel,
  type TrendPoint,
} from "@/lib/partner/dashboard-data";
import type { RankedItem } from "@/lib/partner/framing";

export const dynamic = "force-dynamic";

const TREND_WINDOW_DAYS = 30;

const AUD = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});

// Admin-gated, partner-type-framed pilot demo dashboard. De-identified
// aggregates only. Parametrised by ?partner= and ?jurisdiction= — no DB
// changes; org-scoping is a follow-up once the pilot model is decided.
export default async function PartnerDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ partner?: string; jurisdiction?: string }>;
}) {
  await requireAdmin();
  if (!featureFlags.partnerDashboard) notFound();

  const params = await searchParams;
  const framing = PARTNER_FRAMING[resolvePartnerType(params.partner)];
  const jurisdiction = resolveJurisdiction(params.jurisdiction) ?? "NSW";
  const scoped = framing.scope === "jurisdiction" ? jurisdiction : null;

  const [threat, trend, funnel] = await Promise.all([
    getJurisdictionThreatPicture(scoped),
    getJurisdictionTrend(jurisdiction, TREND_WINDOW_DAYS),
    getRouteClickFunnel(scoped),
  ]);

  const buildHref = (partner: string, j: string) =>
    `/admin/partner-dashboard?partner=${partner}&jurisdiction=${j}`;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      {/* Framing header */}
      <header className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-deep-navy px-3 py-1 text-xs font-bold uppercase tracking-widest text-white">
            {framing.label}
          </span>
          <span className="text-xs text-gov-slate">Pilot demo · de-identified</span>
        </div>
        <h1 className="text-2xl font-bold text-deep-navy">Partner threat & reporting dashboard</h1>
        <p className="text-gov-slate max-w-3xl">{framing.headline}</p>
        <ul className="grid gap-2 sm:grid-cols-3 pt-2">
          {framing.pillars.map((p, i) => (
            <li key={i} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-deep-navy">
              {p}
            </li>
          ))}
        </ul>
      </header>

      {/* Partner-type + jurisdiction switcher */}
      <nav className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gov-slate">Partner:</span>
        {Object.values(PARTNER_FRAMING).map((f) => (
          <Link
            key={f.type}
            href={buildHref(f.type, jurisdiction)}
            className={`rounded-lg border px-3 py-1 ${
              f.type === framing.type
                ? "border-deep-navy bg-deep-navy text-white"
                : "border-slate-300 text-deep-navy hover:border-deep-navy"
            }`}
          >
            {f.label}
          </Link>
        ))}
        {framing.scope === "jurisdiction" && (
          <>
            <span className="ml-4 text-gov-slate">Jurisdiction:</span>
            {AU_JURISDICTIONS.map((j) => (
              <Link
                key={j}
                href={buildHref(framing.type, j)}
                className={`rounded-lg border px-2.5 py-1 ${
                  j === jurisdiction
                    ? "border-deep-navy bg-deep-navy text-white"
                    : "border-slate-300 text-deep-navy hover:border-deep-navy"
                }`}
              >
                {j}
              </Link>
            ))}
          </>
        )}
      </nav>

      {/* Panel: regional threat picture — map (all-time volume) + jurisdiction
          trend (last 30 days) + ranked top scam types / brands. */}
      {framing.panels.includes("regional_threat") && (
        <section className="rounded-lg border border-slate-200 p-5">
          <h2 className="text-lg font-bold text-deep-navy mb-1">Regional threat picture</h2>
          <p className="text-sm text-gov-slate mb-4">
            Reported scam volume by state (all-time) and {jurisdiction} trend over the last{" "}
            {TREND_WINDOW_DAYS} days — de-identified aggregates.
          </p>
          {threat.unavailable ? (
            <p className="text-sm text-gov-slate">Threat aggregate source unavailable.</p>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              <div className="max-w-sm">
                <AustraliaMap stateData={threat.stateData} />
              </div>
              <div className="space-y-4">
                <h3 className="font-bold text-deep-navy">{jurisdiction}</h3>
                <div className="grid grid-cols-3 gap-3">
                  <Stat label={`Reports (${TREND_WINDOW_DAYS}d)`} value={trend.totalReports.toLocaleString()} />
                  <Stat label={`High-risk (${TREND_WINDOW_DAYS}d)`} value={trend.totalHighRisk.toLocaleString()} />
                  <Stat
                    label="Reported loss (all-time)"
                    value={threat.focusLoss != null ? AUD.format(threat.focusLoss) : "—"}
                  />
                </div>
                <TrendBars series={trend.series} />
                <RankedRow label="Top scam types" items={trend.topScamTypes} />
                <RankedRow label="Top impersonated brands" items={trend.topBrands} />
              </div>
            </div>
          )}
        </section>
      )}

      {/* Panel: reporting funnel */}
      {framing.panels.includes("reporting_funnel") && (
        <section className="rounded-lg border border-slate-200 p-5">
          <h2 className="text-lg font-bold text-deep-navy mb-1">Reporting funnel</h2>
          <p className="text-sm text-gov-slate mb-4">
            Where victims were routed from the Next Steps card
            {framing.scope === "jurisdiction" ? ` (${jurisdiction})` : ""}. Metadata only.
          </p>
          {funnel.total === 0 ? (
            <p className="text-sm text-gov-slate">
              No route-click data yet — enable <code>FF_ROUTE_CLICK_TELEMETRY</code> and let taps
              accumulate.
            </p>
          ) : (
            <ul className="space-y-2">
              {funnel.rows.map((r) => (
                <li key={r.routeLabel} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-deep-navy">{r.routeLabel}</span>
                  <span className="flex items-center gap-2">
                    <span
                      className="h-2 rounded-full bg-deep-navy"
                      style={{ width: `${Math.max(8, (r.count / funnel.total) * 160)}px` }}
                      aria-hidden="true"
                    />
                    <span className="text-sm font-bold text-deep-navy tabular-nums">{r.count}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <p className="text-xs text-gov-slate border-t border-slate-200 pt-4">{framing.governanceNote}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-lg font-bold text-deep-navy tabular-nums">{value}</div>
      <div className="text-xs text-gov-slate">{label}</div>
    </div>
  );
}

function RankedRow({ label, items }: { label: string; items: RankedItem[] }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-gov-slate mb-1">{label}</div>
      {items.length === 0 ? (
        <span className="text-sm text-gov-slate">—</span>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((it, i) => (
            <span
              key={it.name}
              className="flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-deep-navy"
            >
              <span className="text-gov-slate">{i + 1}.</span>
              {it.name}
              <span className="rounded-full bg-slate-100 px-1.5 font-semibold tabular-nums">{it.count}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Lightweight inline bar chart (no chart lib) — daily reports over the window.
function TrendBars({ series }: { series: TrendPoint[] }) {
  if (series.length === 0) {
    return (
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-gov-slate mb-1">
          Reports per day
        </div>
        <p className="text-sm text-gov-slate">No activity in this window.</p>
      </div>
    );
  }
  const max = Math.max(1, ...series.map((p) => p.reports));
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-gov-slate mb-1">
        Reports per day
      </div>
      <div className="flex items-end gap-1 h-20" role="img" aria-label="Daily reports trend">
        {series.map((p) => (
          <div
            key={p.date}
            className="flex-1 min-w-[3px] rounded-t bg-deep-navy"
            style={{ height: `${Math.max(4, (p.reports / max) * 100)}%` }}
            title={`${p.date}: ${p.reports} report(s), ${p.highRisk} high-risk`}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-gov-slate mt-1">
        <span>{series[0].date}</span>
        <span>{series[series.length - 1].date}</span>
      </div>
    </div>
  );
}
