import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import FeedList from "@/components/FeedList";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Scam Feed — Latest Australian Scam Alerts | Ask Arthur",
  description:
    "Browse the latest scam reports from Reddit, verified intelligence, and community reports. Filter by category, country, and search for specific threats.",
  openGraph: {
    title: "Scam Feed — Latest Australian Scam Alerts",
    description:
      "Real-time scam intelligence feed. See what scams are trending right now in Australia and worldwide.",
    url: "https://askarthur.au/scam-feed",
    siteName: "Ask Arthur",
    type: "website",
  },
};

async function getInitialFeed() {
  const supabase = createServiceClient();
  if (!supabase) {
    return { items: [], total: 0 };
  }

  const { data, count, error } = await supabase
    .from("feed_items")
    .select("*", { count: "exact" })
    .eq("published", true)
    .order("source_created_at", { ascending: false, nullsFirst: false })
    .range(0, 19);

  if (error) {
    return { items: [], total: 0 };
  }

  return { items: data || [], total: count ?? 0 };
}

export default async function ScamFeedPage() {
  if (!featureFlags.scamFeed) notFound();

  const { items, total } = await getInitialFeed();

  return (
    <>
      <Nav />
      <main id="main-content" className="max-w-6xl mx-auto px-4 py-8">
        {/* Hero */}
        <section className="mb-8">
          <h1 className="text-3xl font-bold text-deep-navy mb-2">
            Scam Feed
          </h1>
          <p className="text-gov-slate max-w-2xl">
            Real-time scam intelligence from Reddit, verified analysis, and
            community reports. Stay informed about the latest threats targeting
            Australians.
          </p>
        </section>

        {/* Feed */}
        <FeedList initialItems={items} initialTotal={total} />
      </main>
      <Footer />
    </>
  );
}
