import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import FeedList from "@/components/FeedList";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Feed — Latest Australian Scam Alerts | Ask Arthur",
  description:
    "Browse the latest scam reports from Reddit, verified intelligence, and community reports. Filter by category, country, and search for specific threats.",
  openGraph: {
    title: "Feed — Latest Australian Scam Alerts",
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
      <main id="main-content">
        {/* Hero */}
        <section className="max-w-[640px] mx-auto px-5 pt-16 mb-8">
          <h1 className="text-deep-navy text-4xl md:text-5xl font-extrabold mb-4 leading-tight text-center">
            Feed
          </h1>
          <p className="text-lg text-gov-slate max-w-2xl mx-auto text-center leading-relaxed">
            Real-time scam intelligence from Reddit, verified analysis, and
            community reports. Stay informed about the latest threats targeting
            Australians.
          </p>
        </section>

        {/* Feed */}
        <section className="max-w-4xl mx-auto px-4 pb-8">
          <FeedList initialItems={items} initialTotal={total} />
        </section>
      </main>
      <Footer />
    </>
  );
}
