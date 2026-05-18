import type { Metadata } from "next";
import Link from "next/link";
import { Shield, ChevronDown } from "lucide-react";
import { gateOrNotFound } from "@/lib/featureGate";
import FeedList from "@/components/FeedList";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { SOURCE_CONFIG, relativeTime } from "@/lib/feed";
import { getInitialFeed, getPinnedRegulatorAlerts } from "@/lib/feed-loaders";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Feed — Latest Australian Scam Alerts | Ask Arthur",
  description:
    "Browse the latest scam alerts from Australian regulators (Scamwatch, ACSC, ASIC), Reddit, verified intelligence, and community reports. Filter by category, country, and search for specific threats.",
  openGraph: {
    title: "Feed — Latest Australian Scam Alerts",
    description:
      "Real-time scam intelligence from Australian regulators and the community. See what scams are trending right now.",
    url: "https://askarthur.au/scam-feed",
    siteName: "Ask Arthur",
    type: "website",
  },
};

export default async function ScamFeedPage() {
  gateOrNotFound("scamFeed");

  const [{ items, total }, pinned] = await Promise.all([
    getInitialFeed(),
    getPinnedRegulatorAlerts(),
  ]);

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main id="main-content" className="flex-1 w-full max-w-[640px] mx-auto px-5 pt-16 pb-16">
        <h1 className="text-deep-navy text-4xl md:text-5xl font-extrabold mb-4 leading-tight text-center">
          Feed
        </h1>
        <p className="text-lg text-gov-slate mb-10 leading-relaxed text-center">
          Real-time scam intelligence from Australian regulators (Scamwatch,
          ACSC, ASIC), Reddit, and verified community reports. Stay informed
          about the latest threats targeting Australians.
        </p>

        {/* Collapsible "Regulator alerts this week" subheading. Native
            <details> rather than React state so the page stays a Server
            Component and the section works without JS. Closed by default
            so the feed grid is the dominant element on the page. */}
        {pinned.length > 0 && (
          <details className="group mb-10">
            <summary className="flex items-center gap-2 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
              <Shield size={18} className="text-deep-navy flex-shrink-0" />
              <h2 className="text-xl md:text-2xl font-bold text-deep-navy">
                Regulator alerts this week
                <span className="ml-2 text-base font-normal text-gov-slate">
                  ({pinned.length})
                </span>
              </h2>
              <ChevronDown
                size={20}
                className="ml-auto text-deep-navy transition-transform duration-200 group-open:rotate-180"
              />
            </summary>
            <div className="mt-4 rounded-xl border border-deep-navy/20 bg-white p-5">
              <ul className="space-y-3">
                {pinned.map((alert) => {
                  const sourceLabel =
                    SOURCE_CONFIG[alert.source]?.label ?? alert.source;
                  const dateStr = alert.published_at
                    ? relativeTime(alert.published_at)
                    : relativeTime(alert.created_at);
                  const titleNode = (
                    <span className="font-semibold text-deep-navy hover:underline">
                      {alert.title}
                    </span>
                  );
                  return (
                    <li key={alert.id} className="text-sm leading-snug">
                      {alert.url ? (
                        <a
                          href={alert.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {titleNode}
                        </a>
                      ) : (
                        titleNode
                      )}
                      <span className="ml-2 text-xs text-gov-slate">
                        — {sourceLabel} · {dateStr}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <Link
                href="/intel/regulator-alerts"
                className="mt-4 inline-block text-xs font-medium text-deep-navy underline-offset-2 hover:underline"
              >
                View all regulator alerts →
              </Link>
            </div>
          </details>
        )}

        <FeedList initialItems={items} initialTotal={total} />
      </main>
      <Footer />
    </div>
  );
}
