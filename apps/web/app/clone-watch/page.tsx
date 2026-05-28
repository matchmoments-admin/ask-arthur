// Layer 0 clone-watch public page. Renders yesterday's top NRD hits with
// factual-signal-only copy per docs/policy/draft-disclaimer-pack-v0.md
// Surface 5 principles.
//
// `noindex` for the first 7 days while v0 copy is unvetted. Sitemap
// excludes /clone-watch (see apps/web/app/sitemap.ts). Index-flip is a
// follow-up PR after #371 lawyer-vetted v1 copy lands.
//
// Read path: service-role Supabase client (the table is service-role-only
// per v140 RLS); page renders server-side, never via browser supabase-js.

import type { Metadata } from "next";
import { AlertTriangle, ShieldQuestion } from "lucide-react";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";

export const revalidate = 3600; // 1 hour ISR

export const metadata: Metadata = {
  title:
    "Clone-watch — newly-registered AU brand-pattern domains | Ask Arthur",
  description:
    "A daily list of newly-registered domains matching the lexical pattern of Australian retail brand names. Public-registry observations only.",
  // v0 page — noindex for the first 7 days while v0 copy is unvetted by
  // counsel. Flip via a follow-up PR after #371 lawyer pack returns.
  robots: { index: false, follow: false },
};

interface CloneAlertRow {
  id: number;
  candidate_domain: string;
  inferred_target_domain: string | null;
  signals: unknown;
  severity_tier: string;
  first_seen_at: string;
  source: string;
}

interface SignalEntry {
  type?: string;
  signal_type?: string;
  score?: number;
  evidence?: Record<string, unknown>;
}

async function getAlerts(): Promise<CloneAlertRow[]> {
  const supabase = createServiceClient();
  if (!supabase) return [];
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("shopfront_clone_alerts")
    .select(
      "id, candidate_domain, inferred_target_domain, signals, severity_tier, first_seen_at, source",
    )
    .is("target_shop_id", null)
    .eq("source", "nrd")
    .eq("alert_state", "open")
    // Only publish operator-CONFIRMED clones. Without this, the page rendered
    // every open NRD row regardless of triage outcome — verified 2026-05-29 to
    // be leaking 35 `fp` (false-positive, already cleared as NOT clones) and 1
    // `needs_investigation` row out of 47, i.e. publicly naming legitimate
    // businesses' domains as "possible clones". `noindex` keeps it out of
    // search but the page is still publicly reachable, so this is a
    // defamation/reputational fix, not cosmetic.
    .in("triage_status", ["tp_confirmed", "tp_actioned"])
    .gte("first_seen_at", since)
    .order("severity", { ascending: false })
    .order("first_seen_at", { ascending: false })
    .limit(100);
  return (data ?? []) as CloneAlertRow[];
}

interface PublicImpactSnapshot {
  window_days: number;
  candidates_total: number;
  tp_confirmed_total: number;
  netcraft_submits_total: number;
  brand_notifications_total: number;
  brands_protected: number;
}

interface PublicTakedownStats {
  window_days: number;
  takedowns_total: number;
  median_minutes: number;
}

async function getPublicImpact(): Promise<{
  impact: PublicImpactSnapshot;
  takedown: PublicTakedownStats | null;
} | null> {
  const supabase = createServiceClient();
  if (!supabase) return null;
  const [impactRes, takedownRes] = await Promise.all([
    supabase.rpc("clone_watch_public_impact", { p_days: 30 }),
    supabase.rpc("clone_watch_takedown_stats", { p_days: 30 }),
  ]);
  if (!Array.isArray(impactRes.data) || impactRes.data.length === 0) return null;
  const impact = impactRes.data[0] as PublicImpactSnapshot;
  const takedown =
    Array.isArray(takedownRes.data) && takedownRes.data[0]
      ? (takedownRes.data[0] as PublicTakedownStats)
      : null;
  return { impact, takedown };
}

function firstSignal(signals: unknown): SignalEntry | null {
  if (!Array.isArray(signals) || signals.length === 0) return null;
  const first = signals[0];
  if (typeof first !== "object" || first === null) return null;
  return first as SignalEntry;
}

function signalLabel(sig: SignalEntry | null): string {
  if (!sig?.signal_type) return "match";
  switch (sig.signal_type) {
    case "confusable":
      return "look-alike characters";
    case "substring":
      return "brand name in domain";
    case "levenshtein":
      return "1-char typo";
    default:
      // Whitelist: anything outside the curated vocabulary falls back to
      // the generic label so attacker-influenced JSONB can't surface raw
      // enum tokens inside the styled pill.
      return "match";
  }
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function PublicImpactBlock({
  impact,
  takedown,
}: {
  impact: PublicImpactSnapshot;
  takedown: PublicTakedownStats | null;
}) {
  // Aggregate-only — never names a specific candidate domain. Renders only
  // when FF_SHOPFRONT_CLONE_OUTREACH=true AND there's at least one
  // candidate in the window. Quiet weeks render no block (intentional —
  // an "0 candidates" block reads as broken, not as quiet).
  const fmtMinutes = (m: number) =>
    m < 60 ? `${m} min` : `${(m / 60).toFixed(1)}h`;
  const tiles: Array<{ label: string; value: string }> = [
    {
      label: "Candidates surfaced",
      value: impact.candidates_total.toLocaleString(),
    },
    { label: "Brands protected", value: impact.brands_protected.toLocaleString() },
    {
      label: "Reported to Netcraft",
      value: impact.netcraft_submits_total.toLocaleString(),
    },
    // Show median-time-to-takedown when Netcraft has confirmed at least one;
    // otherwise show brand-notification count (it's the next-most-impressive
    // metric while takedown polling is still warming up).
    takedown && takedown.takedowns_total > 0
      ? {
          label: "Median time-to-takedown",
          value: fmtMinutes(takedown.median_minutes),
        }
      : {
          label: "Brand teams notified",
          value: impact.brand_notifications_total.toLocaleString(),
        },
  ];
  return (
    <section
      aria-labelledby="impact-heading"
      className="rounded-xl border border-deep-navy/15 bg-deep-navy/[0.04] p-5 mb-8"
    >
      <h2
        id="impact-heading"
        className="text-xs font-bold uppercase tracking-widest text-deep-navy mb-3"
      >
        Last {impact.window_days} days · clone-watch impact
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {tiles.map((t) => (
          <div key={t.label}>
            <p
              className="text-2xl md:text-3xl font-extrabold text-deep-navy"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {t.value}
            </p>
            <p className="text-[11px] text-gov-slate mt-0.5 leading-snug">
              {t.label}
            </p>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-gov-slate mt-4 leading-relaxed">
        Numbers are aggregate-only. We never publish which specific domains
        we&apos;ve reported. Reports go to community blocklist aggregators
        (so suspect domains get browser-blocked globally) and to the
        affected brand&apos;s security team.
      </p>
    </section>
  );
}

export default async function CloneWatchPage() {
  const [alerts, impactBundle] = await Promise.all([
    getAlerts(),
    featureFlags.shopfrontCloneOutreach
      ? getPublicImpact()
      : Promise.resolve(null),
  ]);
  const impact = impactBundle?.impact ?? null;
  const takedown = impactBundle?.takedown ?? null;

  return (
    <>
      <div className="flex items-center gap-2 mb-4">
        <ShieldQuestion size={20} className="text-deep-navy" />
        <span className="text-xs font-bold tracking-widest uppercase text-deep-navy">
          Clone-watch · daily NRD sweep
        </span>
      </div>
      <h1 className="text-deep-navy text-4xl md:text-5xl font-extrabold mb-4 leading-tight">
        Newly-registered AU brand-pattern domains
      </h1>

      <p className="text-lg text-gov-slate mb-6 leading-relaxed">
        Each entry below is a domain registered in the last 7 days whose
        characters match the lexical pattern of an Australian brand on
        our reference list. These are factual observations from a
        public-registry sweep — not characterisations of the registrant
        or their intent.
      </p>

      {impact && impact.candidates_total > 0 && (
        <PublicImpactBlock impact={impact} takedown={takedown} />
      )}

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 mb-10 text-sm leading-relaxed text-amber-900">
        <div className="flex items-start gap-2">
          <AlertTriangle
            size={16}
            className="mt-0.5 shrink-0 text-amber-700"
          />
          <div>
            <p className="font-semibold mb-1">What this list is</p>
            <p>
              A daily lexical match against newly-registered domains. We
              do <strong>not</strong> claim any listed domain is operated
              by a scammer or is hosting fraudulent content. We claim
              only that the domain string is characteristically similar
              to an Australian brand name by a deterministic
              measurement.
            </p>
            <p className="mt-3 font-semibold">If your brand appears here</p>
            <p>
              You can verify your shop on Ask Arthur or request removal
              from the reference list by emailing{" "}
              <a
                href="mailto:hello@askarthur.au"
                className="underline font-medium"
              >
                hello@askarthur.au
              </a>
              .
            </p>
          </div>
        </div>
      </div>

      {alerts.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-lg font-semibold text-deep-navy mb-2">
            No registrations matched in the last 7 days
          </p>
          <p className="text-sm text-gov-slate">
            New entries appear here within hours of each daily sweep
            (08:30 UTC).
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {alerts.map((alert) => {
            const sig = firstSignal(alert.signals);
            return (
              <li key={alert.id}>
                <article className="rounded-lg border border-deep-navy/15 bg-white p-4">
                  <div className="flex items-center gap-2 text-xs text-gov-slate mb-2">
                    <span className="inline-flex items-center rounded-full border border-deep-navy/30 px-2 py-0.5 font-semibold text-deep-navy">
                      {signalLabel(sig)}
                    </span>
                    <span>·</span>
                    <span>{relativeTime(alert.first_seen_at)}</span>
                  </div>
                  <p className="text-base text-deep-navy">
                    <span className="font-semibold break-all">
                      {alert.candidate_domain}
                    </span>
                    {alert.inferred_target_domain && (
                      <span className="text-gov-slate">
                        {" "}
                        resembles{" "}
                        <span className="font-medium">
                          {alert.inferred_target_domain}
                        </span>
                      </span>
                    )}
                  </p>
                </article>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-12 pt-8 border-t border-deep-navy/10 text-xs leading-relaxed text-gov-slate">
        <p className="mb-2">
          <strong className="text-deep-navy">Data source:</strong>{" "}
          Newly-registered domain (NRD) lists from whoisds.com (free
          public tier), filtered against a reference list of
          approximately 50 Australian retail, bank, telco, and
          logistics brand names.
        </p>
        <p className="mb-2">
          <strong className="text-deep-navy">What we have not done:</strong>{" "}
          We have not contacted the registrant. We have not verified
          whether the domain resolves, serves a website, or has any
          content. We have not made any legal characterisation of the
          domain or its registrant.
        </p>
        <p>
          <strong className="text-deep-navy">Updates:</strong> The list
          refreshes once per day. Entries fall off after 7 days. See{" "}
          <a
            href="/privacy"
            className="underline"
          >
            our privacy policy
          </a>{" "}
          for how we handle this data.
        </p>
      </div>
    </>
  );
}
