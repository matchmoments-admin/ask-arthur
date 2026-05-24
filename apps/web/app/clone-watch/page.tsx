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

export const revalidate = 3600; // 1 hour ISR

export const metadata: Metadata = {
  title: "Clone-watch — AU brand-domain registrations under review | Ask Arthur",
  description:
    "Newly-registered domains that match patterns of Australian retail brands. Factual signals from a daily public-registry sweep. No legal claim of bad faith.",
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
    .gte("first_seen_at", since)
    .order("severity", { ascending: false })
    .order("first_seen_at", { ascending: false })
    .limit(100);
  return (data ?? []) as CloneAlertRow[];
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
      return String(sig.signal_type);
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

export default async function CloneWatchPage() {
  const alerts = await getAlerts();

  return (
    <>
      <div className="flex items-center gap-2 mb-4">
        <ShieldQuestion size={20} className="text-deep-navy" />
        <span className="text-xs font-bold tracking-widest uppercase text-deep-navy">
          Clone-watch · daily NRD sweep
        </span>
      </div>
      <h1 className="text-deep-navy text-4xl md:text-5xl font-extrabold mb-4 leading-tight">
        AU brand-domain registrations under review
      </h1>

      <p className="text-lg text-gov-slate mb-6 leading-relaxed">
        Each entry below is a domain registered in the last 7 days that
        matches a pattern of an Australian retail brand on our watchlist.
        These are factual signals from a public-registry sweep, not legal
        claims that the registrant is acting in bad faith.
      </p>

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
              by a scammer, infringes any trademark, or is hosting
              fraudulent content. We claim only that the domain string
              resembles an Australian brand by a deterministic
              measurement.
            </p>
            <p className="mt-3 font-semibold">If your brand appears here</p>
            <p>
              You can verify your shop on Ask Arthur or request removal
              from the watchlist by emailing{" "}
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
          public tier), filtered against a watchlist of approximately
          50 Australian retail, bank, telco, and logistics brands.
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
