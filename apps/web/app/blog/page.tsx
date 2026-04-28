import Link from "next/link";
import Image from "next/image";
import { getAllPosts, getCategories } from "@/lib/blog";
import { featureFlags } from "@askarthur/utils/feature-flags";
import SubscribeForm from "@/components/SubscribeForm";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Blog — Ask Arthur",
  description:
    "Scam alerts, security guides, and product updates. Stay protected with the latest threat intelligence from Ask Arthur.",
  alternates: {
    canonical: "https://askarthur.au/blog",
  },
  openGraph: {
    title: "Blog — Ask Arthur",
    description: "Scam alerts, security guides, and product updates.",
    type: "website",
  },
};

export const revalidate = 3600;

interface PageProps {
  searchParams: Promise<{ category?: string }>;
}

export default async function BlogPage({ searchParams }: PageProps) {
  const { category } = await searchParams;
  const [allPosts, categories] = await Promise.all([
    getAllPosts(),
    getCategories(),
  ]);

  // Count posts per category so we only show categories that have content
  const categoryCounts = new Map<string, number>();
  for (const post of allPosts) {
    if (post.categorySlug) {
      categoryCounts.set(
        post.categorySlug,
        (categoryCounts.get(post.categorySlug) ?? 0) + 1
      );
    }
  }
  const activeCategories = categories.filter(
    (c) => (categoryCounts.get(c.slug) ?? 0) > 0
  );

  const posts = category
    ? allPosts.filter((p) => p.categorySlug === category)
    : allPosts;

  return (
    <div>
      {/* ── Header ── */}
      <header className="mb-10 text-center">
        <h1 className="text-deep-navy text-4xl md:text-5xl font-extrabold leading-tight mb-3">
          Blog
        </h1>
        <p className="text-slate-500 text-base leading-relaxed max-w-xl mx-auto">
          Scam alerts, protection guides, and product updates.
        </p>
      </header>

      {/* ── Category tabs ── */}
      {activeCategories.length > 0 && (
        <nav className="flex items-center gap-1 border-b border-border-light mb-10 overflow-x-auto">
          <Link
            href="/blog"
            className={`px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors relative ${
              !category
                ? "text-deep-navy after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-deep-navy"
                : "text-slate-400 hover:text-deep-navy"
            }`}
          >
            All
          </Link>
          {activeCategories.map((cat) => (
            <Link
              key={cat.slug}
              href={`/blog?category=${cat.slug}`}
              className={`px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors relative ${
                category === cat.slug
                  ? "text-deep-navy after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-deep-navy"
                  : "text-slate-400 hover:text-deep-navy"
              }`}
            >
              {cat.name}
            </Link>
          ))}
        </nav>
      )}

      {/* ── Post grid ── */}
      {posts.length === 0 ? (
        <div className="py-20 text-center">
          <p className="text-slate-400 text-base">
            No posts yet. Check back soon.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {posts.map((post) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="group bg-white border border-border-light rounded-xl shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all overflow-hidden flex flex-col"
            >
              {post.heroImageUrl ? (
                <div className="relative aspect-[16/10] bg-slate-50 overflow-hidden">
                  <Image
                    src={post.heroImageUrl}
                    alt={post.heroImageAlt || post.title}
                    fill
                    sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                    className="object-cover group-hover:scale-[1.02] transition-transform duration-300"
                  />
                </div>
              ) : (
                <div className="aspect-[16/10] bg-cream flex items-center justify-center p-6">
                  <p className="text-deep-navy font-bold text-base text-center line-clamp-3">
                    {post.title}
                  </p>
                </div>
              )}

              <div className="p-5 flex flex-col flex-1">
                <h2 className="text-deep-navy text-lg font-bold leading-snug line-clamp-2 group-hover:text-action-teal transition-colors">
                  {post.title}
                </h2>
                <p className="text-slate-500 text-sm leading-relaxed line-clamp-2 mt-2">
                  {post.excerpt}
                </p>
                <div className="flex items-center gap-2 text-xs text-slate-400 mt-4 pt-4 border-t border-border-light/60">
                  <time dateTime={post.publishedAt}>
                    {new Date(post.publishedAt).toLocaleDateString("en-AU", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </time>
                  <span>&middot;</span>
                  <span>{post.readingTimeMinutes} min</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* ── Bottom CTA ── */}
      <section className="mt-12 pt-10 border-t border-border-light text-center">
        <h2 className="text-deep-navy text-xl font-bold mb-1.5">
          Protect yourself from scams
        </h2>
        <p className="text-slate-500 text-sm mb-5">
          Free, private, no signup required.
        </p>
        <Link
          href="/"
          className="block w-full max-w-md mx-auto py-3.5 bg-deep-navy text-white font-bold text-sm uppercase tracking-widest rounded-[4px] hover:bg-navy transition-colors text-center"
        >
          Check a message
        </Link>
      </section>

      {/* ── Newsletter (feature-flagged) ── */}
      {featureFlags.newsletter && (
        <section className="mt-10 pt-8 border-t border-border-light">
          <div className="max-w-md mx-auto">
            <h3 className="text-deep-navy text-sm font-bold uppercase tracking-wider mb-1">
              Get weekly scam alerts
            </h3>
            <p className="text-slate-400 text-sm mb-3">
              Stay ahead of the latest scams — delivered to your inbox every Monday.
            </p>
            <SubscribeForm variant="inline" />
          </div>
        </section>
      )}
    </div>
  );
}
