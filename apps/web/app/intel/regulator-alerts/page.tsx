// Public list page for AU regulator narrative alerts (Scamwatch / ACSC / ASIC).
//
// Reads feed_items directly — no new API needed. ISR-revalidated every 30 min
// so SEO crawlers see fresh content but we don't burn function compute on
// every visit. Mirrors the /scam-feed page shell (Nav + max-w-[640px] +
// Footer) since /intel/* has no frontend pattern of its own yet.
//
// Detail pages (/intel/regulator-alerts/[slug]) are intentionally deferred —
// feed_items.external_id is a SHA-256 hash, not a URL-friendly slug. Adding
// a slug column + per-alert pages is a P3 follow-up if SEO data justifies.

import type { Metadata } from "next";
import { Shield } from "lucide-react";
import { createServiceClient } from "@askarthur/supabase/server";
import { SOURCE_CONFIG, relativeTime } from "@/lib/feed";

export const revalidate = 1800; // 30 min ISR

export const metadata: Metadata = {
  title: "Regulator scam alerts — Scamwatch, ACSC, ASIC | Ask Arthur",
  description:
    "Latest scam alerts published by Australian regulators (ACCC Scamwatch, ASD ACSC, ASIC Moneysmart). Authoritative warnings about active fraud campaigns targeting Australians.",
  openGraph: {
    title: "Regulator scam alerts — Scamwatch, ACSC, ASIC",
    description:
      "Authoritative AU regulator scam warnings. Scamwatch, ACSC and ASIC alerts in one place.",
    url: "https://askarthur.au/intel/regulator-alerts",
    siteName: "Ask Arthur",
    type: "website",
  },
};

interface RegulatorAlertRow {
  id: number;
  source: string;
  title: string;
  description: string | null;
  body_md: string | null;
  url: string | null;
  category: string | null;
  published_at: string | null;
  created_at: string;
  tags: string[] | null;
  impersonated_brand: string | null;
}

async function getAlerts(): Promise<RegulatorAlertRow[]> {
  const supabase = createServiceClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from("feed_items")
    .select(
      "id, source, title, description, body_md, url, category, published_at, created_at, tags, impersonated_brand",
    )
    .in("source", ["scamwatch_alert", "acsc", "asic_investor"])
    .eq("published", true)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(50);
  return (data ?? []) as RegulatorAlertRow[];
}

function bodyPreview(row: RegulatorAlertRow, maxChars = 220): string | null {
  const raw = row.body_md ?? row.description;
  if (!raw) return null;
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxChars) return cleaned;
  return cleaned.slice(0, maxChars).trimEnd() + "…";
}

export default async function RegulatorAlertsPage() {
  const alerts = await getAlerts();

  // Nav + Footer + container provided by /intel/layout.tsx — return only
  // the page-specific content.
  return (
    <>
      <div className="flex items-center gap-2 mb-4">
        <Shield size={20} className="text-deep-navy" />
        <span className="text-xs font-bold tracking-widest uppercase text-deep-navy">
          Regulator alerts
        </span>
      </div>
      <h1 className="text-deep-navy text-4xl md:text-5xl font-extrabold mb-4 leading-tight">
        Australian regulator scam warnings
      </h1>
      <p className="text-lg text-gov-slate mb-10 leading-relaxed">
        Authoritative alerts published by ACCC Scamwatch, ASD&apos;s
        Australian Cyber Security Centre, and ASIC Moneysmart. Updated
        continuously as regulators publish new warnings.
      </p>

        {alerts.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-lg font-semibold text-deep-navy mb-2">
              No regulator alerts yet
            </p>
            <p className="text-sm text-gov-slate">
              New alerts appear here within hours of regulator publication.
              Check back shortly.
            </p>
          </div>
        ) : (
          <ul className="space-y-6">
            {alerts.map((alert) => {
              const sourceLabel =
                SOURCE_CONFIG[alert.source]?.label ?? alert.source;
              const dateStr = alert.published_at
                ? relativeTime(alert.published_at)
                : relativeTime(alert.created_at);
              const preview = bodyPreview(alert);
              return (
                <li
                  key={alert.id}
                  className="border-b border-border-light pb-6 last:border-b-0"
                >
                  <div className="flex items-center gap-2 text-xs text-gov-slate mb-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-deep-navy/10 px-2 py-0.5 font-semibold text-deep-navy">
                      <Shield size={10} />
                      {sourceLabel}
                    </span>
                    <span>·</span>
                    <span>{dateStr}</span>
                    {alert.impersonated_brand && (
                      <>
                        <span>·</span>
                        <span>
                          impersonating{" "}
                          <span className="font-medium">
                            {alert.impersonated_brand}
                          </span>
                        </span>
                      </>
                    )}
                  </div>
                  <h2 className="text-xl font-semibold text-deep-navy mb-2 leading-snug">
                    {alert.url ? (
                      <a
                        href={alert.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                      >
                        {alert.title}
                      </a>
                    ) : (
                      alert.title
                    )}
                  </h2>
                  {preview && (
                    <p className="text-sm text-gov-slate leading-relaxed mb-2">
                      {preview}
                    </p>
                  )}
                  {alert.url && (
                    <a
                      href={alert.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-deep-navy underline-offset-2 hover:underline"
                    >
                      Read at source →
                    </a>
                  )}
                </li>
              );
            })}
        </ul>
      )}
    </>
  );
}
