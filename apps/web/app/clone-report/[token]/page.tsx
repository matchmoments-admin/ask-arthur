import { notFound } from "next/navigation";
import CoverageNote from "@/components/clone-watch/CoverageNote";
import type { Metadata } from "next";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { getCloneReportByToken } from "@/lib/clone-report";
import {
  registrarAbuseUrl,
  hostAbuseUrl,
  ICANN_COMPLAINT_URL,
} from "@/lib/email/registrar-abuse";
import {
  SQUAT_DEFINITION,
  SQUAT_LABEL,
  formatRegistered,
  safeAbuseEmail,
  squattingRows,
  squattingSummary,
  type SquatView,
} from "@/lib/clone-watch/squatting";
import ShareCharts, { type Slice } from "./ShareCharts";

// Colour carries meaning only alongside the text label (never alone).
const STATUS_STYLE: Record<SquatView, string> = {
  phishing: "bg-red-50 text-red-700",
  live: "bg-amber-50 text-amber-800",
  parked: "bg-slate-100 text-slate-700",
  unverified: "bg-slate-50 text-slate-500",
  registered: "bg-slate-50 text-slate-500",
  held_phishing: "bg-emerald-50 text-emerald-800",
  held: "bg-emerald-50 text-emerald-800",
  taken_down: "bg-teal-50 text-teal-800",
};

interface PageProps {
  params: Promise<{ token: string }>;
}

// Capability-token page — never index it, and don't follow links from it.
export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { token } = await params;
  const report = await getCloneReportByToken(token);
  return {
    title: report
      ? `${report.brandName} — lookalike-domain report (${report.periodLabel}) | Ask Arthur`
      : "Report not found | Ask Arthur",
    robots: { index: false, follow: false },
  };
}

function toSlices(rec: Record<string, number> | undefined): Slice[] {
  return Object.entries(rec ?? {})
    .filter(([, n]) => n > 0)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

export default async function CloneReportPage({ params }: PageProps) {
  const { token } = await params;
  const report = await getCloneReportByToken(token);
  if (!report) notFound();

  const { brandName, periodLabel, clones, preparedAt } = report;
  const statusesAsOf = formatRegistered(preparedAt);
  const countrySlices = toSlices(clones.byCountry);
  const registrars = toSlices(clones.byRegistrar);
  const asns = toSlices(clones.byAsn);
  const rows = squattingRows(clones.domains);
  const summary = squattingSummary(rows);

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main
        id="main-content"
        className="flex-1 w-full max-w-[760px] mx-auto px-5 pt-12 pb-16"
      >
        <p className="text-xs font-bold uppercase tracking-widest text-[#0F766E]">
          Ask Arthur · Clone-Watch
        </p>
        <h1 className="mt-2 text-2xl font-bold text-[#1B2A4A]">
          Lookalike domains impersonating {brandName}
        </h1>
        <p className="mt-1 text-slate-500">{periodLabel}</p>

        <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 px-6 py-5">
          <span className="text-3xl font-bold text-[#1B2A4A]">
            {clones.detected}
          </span>
          <span className="ml-2 text-slate-600">
            lookalike domain{clones.detected === 1 ? "" : "s"} detected this
            period
          </span>
        </div>

        {/* Interactive breakdown by hosting country */}
        {countrySlices.length > 0 && (
          <section className="mt-8">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
              Where they&apos;re hosted (country)
            </h2>
            <ShareCharts data={countrySlices} />
          </section>
        )}

        {/* Registrar breakdown with one-click abuse-report links */}
        {registrars.length > 0 && (
          <section className="mt-8">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
              Who registered them
            </h2>
            <ul className="mt-3 divide-y divide-slate-100">
              {registrars.map((r) => {
                const href = registrarAbuseUrl(r.name) ?? ICANN_COMPLAINT_URL;
                return (
                  <li
                    key={r.name}
                    className="flex items-center justify-between py-2 text-sm"
                  >
                    <span className="text-slate-700">
                      {r.name}{" "}
                      <span className="text-slate-400">· {r.value}</span>
                    </span>
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-[#0F766E] hover:underline"
                    >
                      Report to registrar →
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* ASN breakdown */}
        {asns.length > 0 && (
          <section className="mt-8">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
              Hosting network (ASN)
            </h2>
            <ul className="mt-3 divide-y divide-slate-100">
              {asns.map((a) => {
                const href = hostAbuseUrl(a.name);
                return (
                  <li
                    key={a.name}
                    className="flex items-center justify-between py-2 text-sm"
                  >
                    <span className="text-slate-700">
                      {a.name}{" "}
                      <span className="text-slate-400">· {a.value}</span>
                    </span>
                    {href && (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-[#0F766E] hover:underline"
                      >
                        Report to host →
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Who is squatting your brand — one row per lookalike, most urgent
            first: what it is now, who registered it, when, where to report. */}
        <section className="mt-8">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
            Who is squatting your brand
          </h2>
          {summary.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2" aria-label="Status summary">
              {summary.map((s) => (
                <li
                  key={s.view}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLE[s.view]}`}
                >
                  {s.count} {s.label.toLowerCase()}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                  <th className="py-2 pr-3 font-semibold">Domain</th>
                  <th className="py-2 pr-3 font-semibold">Status</th>
                  <th className="py-2 pr-3 font-semibold">Registered</th>
                  <th className="py-2 pr-3 font-semibold">Registrar</th>
                  <th className="py-2 pr-3 font-semibold">Hosting</th>
                  <th className="py-2 font-semibold">Report</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const form =
                    registrarAbuseUrl(c.registrar) ?? ICANN_COMPLAINT_URL;
                  const abuseEmail = safeAbuseEmail(c.abuseEmail);
                  return (
                    <tr
                      key={c.domain}
                      className="border-b border-slate-100 align-top"
                    >
                      <td className="py-2 pr-3 font-mono text-[13px] text-[#1B2A4A]">
                        {c.domain}
                      </td>
                      <td className="py-2 pr-3">
                        <span
                          className={`whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[c.view]}`}
                        >
                          {SQUAT_LABEL[c.view]}
                        </span>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap text-slate-600">
                        {formatRegistered(c.registeredAt) ?? "—"}
                      </td>
                      <td className="py-2 pr-3 text-slate-600">
                        {c.registrar ?? "—"}
                      </td>
                      <td className="py-2 pr-3 text-slate-600">
                        {[c.ip, c.country, c.asn].filter(Boolean).join(" · ") ||
                          "—"}
                      </td>
                      <td className="py-2 whitespace-nowrap">
                        {abuseEmail && (
                          <a
                            href={`mailto:${abuseEmail}?subject=${encodeURIComponent(`Abuse report: ${c.domain} impersonating ${brandName}`)}`}
                            className="block font-semibold text-[#0F766E] hover:underline"
                          >
                            Email abuse →
                          </a>
                        )}
                        <a
                          href={form}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block font-semibold text-[#0F766E] hover:underline"
                        >
                          Abuse form →
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {clones.detected > clones.domains.length && (
            <p className="mt-3 text-xs text-slate-400">
              + {clones.detected - clones.domains.length} more lookalike
              {clones.detected - clones.domains.length === 1 ? "" : "s"} — full
              list available on request.
            </p>
          )}
          <dl className="mt-4 grid gap-1 text-xs leading-relaxed text-slate-500">
            {summary.length > 0 &&
              (Object.keys(SQUAT_LABEL) as SquatView[]).map((v) => (
                <div key={v}>
                  <dt className="inline font-semibold text-slate-600">
                    {SQUAT_LABEL[v]}:
                  </dt>{" "}
                  <dd className="inline">{SQUAT_DEFINITION[v]}.</dd>
                </div>
              ))}
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-slate-400">
            Domains are those first detected in {periodLabel}; each
            domain&apos;s status is a snapshot
            {statusesAsOf ? ` taken ${statusesAsOf}` : ""}, not live.
            Registrant identities are redacted by privacy services, so the
            registrar is the accountable party.
          </p>
          <CoverageNote className="mt-2" />
        </section>

        <p className="mt-10 border-t border-slate-200 pt-6 text-xs leading-relaxed text-slate-500">
          This is a factual summary of automatically-detected lookalike domains,
          not a determination that any domain is malicious. Classification is
          urlscan.io&apos;s, shown verbatim. Hosting country is the
          infrastructure&apos;s location, not the operator&apos;s. Ask Arthur is
          operated in accordance with the Australian Privacy Act 1988 (Cth).
        </p>
      </main>
      <Footer />
    </div>
  );
}
