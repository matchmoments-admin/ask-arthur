import Link from "next/link";
import { getAllPosts, getCategories } from "@/lib/blog";
import { featureFlags } from "@askarthur/utils/feature-flags";
import SubscribeForm from "@/components/SubscribeForm";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Blog — Ask Arthur",
  description:
    "Scam alerts, security guides, and product updates. Stay protected with the latest threat intelligence from Ask Arthur.",
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
      <header className="mb-10">
        <h1 className="text-deep-navy text-[2rem] font-extrabold tracking-tight leading-tight mb-2">
          Blog
        </h1>
        <p className="text-slate-500 text-sm leading-relaxed mb-6">
          Scam alerts, protection guides, and product updates.
        </p>

        {/* Stacked category heading links — only categories with posts */}
        {activeCategories.length > 0 && (
          <nav className="flex flex-col items-start">
            {activeCategories.map((cat) => (
              <Link
                key={cat.slug}
                href={`/blog?category=${cat.slug}`}
                className={`text-[2rem] md:text-[2.75rem] font-extrabold tracking-tight leading-[1.2] transition-colors group ${
                  category === cat.slug
                    ? "text-deep-navy"
                    : "text-slate-300 hover:text-deep-navy"
                }`}
              >
                {cat.name}
                <span className="inline-block ml-1.5 text-[0.6em] transition-transform group-hover:translate-x-1">
                  →
                </span>
              </Link>
            ))}
          </nav>
        )}
      </header>

      {/* ── Filter indicator ── */}
      <div className="flex items-center border-b border-border-light pb-3 mb-8">
        {category ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-400">Showing:</span>
            <span className="text-deep-navy font-semibold">
              {categories.find((c) => c.slug === category)?.name}
            </span>
            <Link
              href="/blog"
              className="text-slate-400 hover:text-deep-navy transition-colors"
              title="Clear filter"
            >
              <span className="material-symbols-outlined text-base leading-none">close</span>
            </Link>
          </div>
        ) : (
          <span className="text-sm text-slate-400">All posts</span>
        )}
      </div>

      {/* ── Post list ── */}
      {posts.length === 0 ? (
        <div className="py-20 text-center">
          <p className="text-slate-400 text-base">
            No posts yet. Check back soon.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border-light">
          {posts.map((post) => (
            <article key={post.slug} className="py-6 first:pt-0">
              <Link href={`/blog/${post.slug}`} className="block group">
                {post.categoryName && (
                  <span className="text-action-teal text-xs font-semibold uppercase tracking-wider block mb-1.5">
                    {post.categoryName}
                  </span>
                )}
                <h2 className="text-deep-navy text-xl font-bold leading-snug mb-1 group-hover:text-action-teal transition-colors">
                  {post.title}
                </h2>
                <p className="text-slate-500 text-[15px] leading-relaxed mb-2.5 line-clamp-2">
                  {post.excerpt}
                </p>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <time dateTime={post.publishedAt}>
                    {new Date(post.publishedAt).toLocaleDateString("en-AU", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </time>
                  <span>·</span>
                  <span>{post.readingTimeMinutes} min</span>
                </div>
              </Link>
            </article>
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
          className="inline-block py-3 px-8 bg-deep-navy text-white font-bold text-sm uppercase tracking-widest rounded-[4px] hover:bg-navy transition-colors"
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
