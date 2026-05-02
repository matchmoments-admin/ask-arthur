"use client";

import {
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  HelpCircle,
  ExternalLink,
  RotateCcw,
} from "lucide-react";

import { registrySourceForState } from "@/lib/charityRegistrySources";

export interface CharityCheckResult {
  verdict: "SAFE" | "UNCERTAIN" | "SUSPICIOUS" | "HIGH_RISK";
  composite_score: number;
  pillars: {
    acnc_registration: PillarPayload;
    abr_dgr: PillarPayload;
    donation_url: PillarPayload;
    pfra: PillarPayload;
  };
  coverage: {
    acnc: "live" | "degraded" | "disabled";
    abr: "live" | "degraded" | "disabled";
    donation_url: "live" | "degraded" | "disabled";
    pfra: "live" | "degraded" | "disabled";
  };
  providers_used: string[];
  explanation: string;
  official_donation_url: string | null;
  generated_at: string;
  request_id?: string;
  scamwatch_alerts?: {
    count: number;
    recent: Array<{ title: string; url: string; publishedAt: string | null }>;
  };
}

interface PillarPayload {
  id: string;
  score: number;
  confidence: number;
  available: boolean;
  reason?: string;
  detail?: Record<string, unknown>;
}

const VERDICT_STYLES: Record<
  CharityCheckResult["verdict"],
  {
    icon: React.ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean }>;
    pill: string;
    label: string;
  }
> = {
  SAFE: {
    icon: ShieldCheck,
    pill: "bg-green-50 border-green-200 text-green-800",
    label: "Looks legitimate",
  },
  UNCERTAIN: {
    icon: HelpCircle,
    pill: "bg-slate-50 border-slate-200 text-slate-700",
    label: "Pause — we can&rsquo;t fully verify",
  },
  SUSPICIOUS: {
    icon: AlertTriangle,
    pill: "bg-amber-50 border-amber-200 text-amber-800",
    label: "Suspicious",
  },
  HIGH_RISK: {
    icon: ShieldAlert,
    pill: "bg-red-50 border-red-200 text-red-800",
    label: "High risk — don&rsquo;t donate",
  },
};

export default function CharityVerdict({
  result,
  onCheckAnother,
}: {
  result: CharityCheckResult;
  onCheckAnother: () => void;
}) {
  const style = VERDICT_STYLES[result.verdict];
  const Icon = style.icon;

  const acncDetail = (result.pillars.acnc_registration?.detail ?? {}) as Record<string, unknown>;
  const abrDetail = (result.pillars.abr_dgr?.detail ?? {}) as Record<string, unknown>;

  const acncRegistered = acncDetail.registered === true;
  const abnActive =
    result.pillars.abr_dgr.available &&
    typeof abrDetail.abn_status === "string" &&
    !(abrDetail.abn_status as string).toLowerCase().startsWith("can");
  const dgrEndorsed = abrDetail.dgr_endorsed === true;
  const charityState = (acncDetail.state as string | undefined) ?? null;
  const charityName = (acncDetail.charity_legal_name as string | undefined) ?? null;
  const stateRegistry = registrySourceForState(charityState);

  // Donation URL pillar (v0.2a). Two checks roll into one tick:
  //   - safe_browsing_malicious must NOT be true
  //   - domain_age_band must be "established_90d_plus" (or unknown WHOIS
  //     when Safe Browsing is clean)
  const donationDetail = (result.pillars.donation_url?.detail ?? {}) as Record<string, unknown>;
  const donationDomain = (donationDetail.domain as string | undefined) ?? null;
  const donationAgeDays =
    typeof donationDetail.domain_age_days === "number"
      ? (donationDetail.domain_age_days as number)
      : null;
  const donationAgeBand = (donationDetail.domain_age_band as string | undefined) ?? null;
  const donationRegistrar = (donationDetail.whois_registrar as string | undefined) ?? null;
  const donationCountry = (donationDetail.whois_country as string | undefined) ?? null;
  const donationSafeBrowsingChecked = donationDetail.safe_browsing_checked === true;
  const donationSafeBrowsingMalicious = donationDetail.safe_browsing_malicious === true;
  const donationSafeBrowsingSources =
    (donationDetail.safe_browsing_sources as string[] | undefined) ?? [];
  const donationUrlPassed =
    result.pillars.donation_url.available &&
    !donationSafeBrowsingMalicious &&
    (donationAgeBand === "established_90d_plus" || donationAgeBand === "unknown");

  // PFRA pillar (v0.2c). PFRA membership is additive only — when present,
  // it's a positive signal. The 5th tick reads as a green ✓ when the
  // charity is a PFRA member, and a neutral "—" when it isn't (no
  // penalty for non-membership).
  const pfraDetail = (result.pillars.pfra?.detail ?? {}) as Record<string, unknown>;
  const pfraIsMember = result.pillars.pfra.available;
  const pfraMemberType = pfraDetail.member_type as "charity" | "agency" | undefined;
  const pfraSourceUrl = (pfraDetail.source_url as string | undefined) ?? null;

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={onCheckAnother}
        className="inline-flex items-center gap-1.5 text-sm text-gov-slate hover:text-deep-navy"
      >
        <RotateCcw size={14} aria-hidden /> Check another charity
      </button>

      {/* Verdict pill — above the fold */}
      <div className={`p-5 rounded-xl border ${style.pill}`} role="status">
        <div className="flex items-start gap-3">
          <Icon size={28} className="shrink-0 mt-0.5" aria-hidden />
          <div>
            <div className="text-sm font-semibold tracking-wide uppercase mb-1" dangerouslySetInnerHTML={{ __html: style.label }} />
            <p className="text-base leading-relaxed">{result.explanation}</p>
          </div>
        </div>
      </div>

      {/* 5-fact icon strip — fits as a 2-col grid on mobile, 5-col on desktop */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Fact label="ACNC registered" pass={acncRegistered} unavailable={!result.pillars.acnc_registration.available} />
        <Fact label="ABN active" pass={abnActive} unavailable={!result.pillars.abr_dgr.available} />
        <Fact label="DGR endorsed" pass={dgrEndorsed} unavailable={!result.pillars.abr_dgr.available} />
        <Fact
          label="Donation URL"
          pass={donationUrlPassed}
          unavailable={!result.pillars.donation_url.available}
        />
        <Fact
          label={pfraMemberType === "agency" ? "PFRA agency" : "PFRA member"}
          pass={pfraIsMember}
          unavailable={!pfraIsMember}
        />
      </div>

      {/* Donation-URL detail — collapsible, shown only when the user gave a
          URL so the pillar actually ran. */}
      {result.pillars.donation_url.available && donationDomain && (
        <details className="border border-slate-200 rounded-lg">
          <summary className="cursor-pointer px-4 py-3 font-medium text-deep-navy">
            Donation URL details
          </summary>
          <dl className="px-4 pb-4 text-sm space-y-2">
            <Detail term="Domain" desc={donationDomain} />
            {donationSafeBrowsingChecked && (
              <Detail
                term="Safe Browsing"
                desc={
                  donationSafeBrowsingMalicious
                    ? `Flagged (${donationSafeBrowsingSources.join(", ") || "Google"})`
                    : "Clean"
                }
              />
            )}
            {donationAgeDays !== null && (
              <Detail
                term="Domain age"
                desc={`${donationAgeDays} day${donationAgeDays === 1 ? "" : "s"} (${formatAgeBand(donationAgeBand ?? undefined)})`}
              />
            )}
            {donationRegistrar && <Detail term="Registrar" desc={donationRegistrar} />}
            {donationCountry && <Detail term="Registrant country" desc={donationCountry} />}
          </dl>
        </details>
      )}

      {/* Official donation URL CTA — only on SAFE / UNCERTAIN with a known URL */}
      {(result.verdict === "SAFE" || result.verdict === "UNCERTAIN") && result.official_donation_url && (
        <a
          href={result.official_donation_url}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full text-center bg-deep-navy text-white font-semibold py-3 px-6 rounded-lg inline-flex items-center justify-center gap-2"
        >
          Donate via their official site <ExternalLink size={16} aria-hidden />
        </a>
      )}

      {/* State-register caveat — when WA/TAS and the charity is registered */}
      {acncRegistered && stateRegistry?.requiresOwnLicence && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-900">
          <p className="font-medium mb-1">Also worth checking — {charityState ?? "state"} register</p>
          <p>
            {charityState} still requires its own fundraising licence on top of ACNC registration.{" "}
            <a
              href={stateRegistry.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline inline-flex items-center gap-1"
            >
              {stateRegistry.label} <ExternalLink size={12} aria-hidden />
            </a>
          </p>
        </div>
      )}

      {/* HIGH_RISK escalation prompts */}
      {result.verdict === "HIGH_RISK" && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-900">
          <p className="font-medium mb-2">If you&rsquo;ve already paid:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Contact your bank immediately and report the transaction.</li>
            <li>
              Report this scam to Scamwatch at{" "}
              <a href="https://www.scamwatch.gov.au/report-a-scam" target="_blank" rel="noopener noreferrer" className="underline">
                scamwatch.gov.au/report-a-scam
              </a>
              .
            </li>
            <li>
              For identity theft support, contact IDCARE at{" "}
              <a href="https://www.idcare.org" target="_blank" rel="noopener noreferrer" className="underline">
                idcare.org
              </a>
              .
            </li>
          </ul>
        </div>
      )}

      {/* Below-the-fold: charity card details */}
      {acncRegistered && charityName && (
        <details className="border border-slate-200 rounded-lg">
          <summary className="cursor-pointer px-4 py-3 font-medium text-deep-navy">
            Charity details
          </summary>
          <dl className="px-4 pb-4 text-sm space-y-2">
            <Detail term="Legal name" desc={charityName} />
            <Detail term="ABN" desc={(acncDetail.abn as string | undefined) ?? (abrDetail.entity_type as string | undefined) ?? "—"} />
            <Detail term="Registered" desc={(acncDetail.registration_date as string | undefined) ?? "—"} />
            <Detail term="Size" desc={(acncDetail.charity_size as string | undefined) ?? "—"} />
            <Detail term="Address" desc={[acncDetail.town_city as string | undefined, acncDetail.state as string | undefined, acncDetail.postcode as string | undefined].filter(Boolean).join(", ") || "—"} />
            {dgrEndorsed && (
              <Detail
                term="DGR endorsement"
                desc={[
                  abrDetail.dgr_item_number ? `Item ${abrDetail.dgr_item_number}` : null,
                  abrDetail.dgr_effective_from ? `from ${abrDetail.dgr_effective_from}` : null,
                ]
                  .filter(Boolean)
                  .join(" ") || "Active"}
              />
            )}
          </dl>
        </details>
      )}

      {/* PFRA explainer when membership IS present */}
      {pfraIsMember && pfraSourceUrl && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-900">
          <p className="font-medium mb-1">
            {pfraMemberType === "agency"
              ? "PFRA-accredited fundraising agency"
              : "PFRA-aligned charity"}
          </p>
          <p>
            This {pfraMemberType === "agency" ? "agency" : "charity"} is a member of the
            Public Fundraising Regulatory Association — its face-to-face fundraisers
            carry numbered ID badges and follow the PFRA Standard.{" "}
            <a
              href={pfraSourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline inline-flex items-center gap-1"
            >
              Member directory <ExternalLink size={12} aria-hidden />
            </a>
          </p>
        </div>
      )}

      {/* Scamwatch alerts — context only, NOT a verdict input. Surfaces
          recent (≤365d) alerts that mention the charity name so the user
          can make an informed call. */}
      {result.scamwatch_alerts && result.scamwatch_alerts.count > 0 && (
        <details className="border border-amber-200 bg-amber-50/50 rounded-lg">
          <summary className="cursor-pointer px-4 py-3 font-medium text-amber-900">
            Recent Scamwatch alerts mentioning this name ({result.scamwatch_alerts.count})
          </summary>
          <div className="px-4 pb-4 text-sm">
            <p className="text-xs text-amber-800 mb-3 italic">
              These alerts may describe scammers <em>impersonating</em> this charity —
              not the charity itself. Read each one to judge.
            </p>
            <ul className="space-y-2">
              {result.scamwatch_alerts.recent.map((alert, i) => (
                <li key={i}>
                  <a
                    href={alert.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-amber-900 underline inline-flex items-start gap-1"
                  >
                    {alert.title} <ExternalLink size={12} aria-hidden className="shrink-0 mt-1" />
                  </a>
                  {alert.publishedAt && (
                    <span className="block text-xs text-amber-700">
                      {new Date(alert.publishedAt).toLocaleDateString("en-AU", { year: "numeric", month: "short", day: "numeric" })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}

      <p className="text-xs text-gov-slate text-center">
        Powered by ACNC Charity Register · ABR Lookup · PFRA · Scamwatch · {result.providers_used.length} sources checked
      </p>
    </div>
  );
}

function Fact({ label, pass, unavailable }: { label: string; pass: boolean; unavailable: boolean }) {
  const symbol = unavailable ? "—" : pass ? "✓" : "✗";
  const color = unavailable
    ? "bg-slate-50 border-slate-200 text-gov-slate"
    : pass
      ? "bg-green-50 border-green-200 text-green-800"
      : "bg-red-50 border-red-200 text-red-800";
  return (
    <div className={`text-center p-2 rounded-lg border ${color}`}>
      <div className="text-2xl font-bold leading-none mb-1">{symbol}</div>
      <div className="text-xs font-medium leading-tight">{label}</div>
    </div>
  );
}

function Detail({ term, desc }: { term: string; desc: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-slate-100 pb-1.5 last:border-0">
      <dt className="text-gov-slate">{term}</dt>
      <dd className="text-deep-navy font-medium text-right">{desc}</dd>
    </div>
  );
}

function formatAgeBand(band: string | undefined): string {
  switch (band) {
    case "fresh_under_30d":
      return "very fresh — high risk";
    case "fresh_30_to_90d":
      return "fresh — caution";
    case "established_90d_plus":
      return "established";
    default:
      return "unknown";
  }
}
