import Link from "next/link";
import { getAllPosts, getCategories } from "@/lib/blog";
import BlogSearch from "@/components/blog/BlogSearch";
import SubscribeForm from "@/components/SubscribeForm";
import { featureFlags } from "@askarthur/utils/feature-flags";
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
  const [posts, categories] = await Promise.all([
    getAllPosts(category),
    getCategories(),
  ]);

  const activeCategory = categories.find((c) => c.slug === category);

  return (
    <div>
      {/* Header */}
      <header className="flex items-start justify-between mb-10">
        <div>
          <h1 className="text-deep-navy text-[2.5rem] font-extrabold tracking-tight leading-tight mb-3">
            Blog
          </h1>
          <p className="text-slate-500 text-lg">
            Scam alerts, protection guides, and product updates.
          </p>
        </div>
        <Link
          href="/"
          className="hidden sm:inline-block py-2.5 px-6 bg-deep-navy text-white font-bold text-xs uppercase tracking-widest rounded-[4px] hover:bg-navy transition-colors mt-2"
        >
          Check a message
        </Link>
      </header>

      {/* Category nav — large heading links */}
      <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-8">
        {categories.map((cat) => (
          <Link
            key={cat.slug}
            href={`/blog?category=${cat.slug}`}
            className={`text-2xl md:text-3xl font-bold transition-colors ${
              category === cat.slug
                ? "text-deep-navy"
                : "text-slate-300 hover:text-deep-navy"
            }`}
          >
            {cat.name}
            <span className="ml-1 text-lg align-middle">&rarr;</span>
          </Link>
        ))}
      </nav>

      {/* Filter bar */}
      <div className="flex items-center justify-between border-b border-border-light pb-4 mb-8">
        <div className="text-sm text-slate-500">
          {activeCategory ? (
            <span className="flex items-center gap-2">
              Showing:{" "}
              <span className="font-semibold text-deep-navy">
                {activeCategory.name}
              </span>
              <Link
                href="/blog"
                className="text-slate-400 hover:text-deep-navy transition-colors"
                aria-label="Clear filter"
              >
                &times;
              </Link>
            </span>
          ) : (
            <span>All posts</span>
          )}
        </div>
        <BlogSearch />
      </div>

      {/* Post list */}
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
                  <span className="text-action-teal text-xs font-semibold uppercase tracking-wider mb-2 block">
                    {post.categoryName}
                  </span>
                )}

                <h2 className="text-deep-navy text-xl font-bold leading-snug mb-1.5 group-hover:text-action-teal transition-colors">
                  {post.title}
                </h2>

                <p className="text-slate-500 text-[15px] leading-relaxed mb-3 line-clamp-2">
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
                  <span>&middot;</span>
                  <span>{post.readingTimeMinutes} min</span>
                </div>
              </Link>
            </article>
          ))}
        </div>
      )}

      {/* CTA section */}
      <section className="mt-12 pt-10 border-t border-border-light">
        <div className="text-center mb-8">
          <h2 className="text-deep-navy text-xl font-bold mb-2">
            Protect yourself from scams
          </h2>
          <p className="text-slate-500 text-base mb-5">
            Free, private, no signup required.
          </p>
          <Link
            href="/"
            className="inline-block py-2.5 px-6 bg-deep-navy text-white font-bold text-xs uppercase tracking-widest rounded-[4px] hover:bg-navy transition-colors"
          >
            Check a message
          </Link>
        </div>

        {/* Newsletter signup — feature-flagged */}
        {featureFlags.newsletter && (
          <div className="max-w-md mx-auto">
            <SubscribeForm variant="inline" />
          </div>
        )}
      </section>
    </div>
  );
}
