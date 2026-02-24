import Link from "next/link";
import { getAllPosts, getCategories } from "@/lib/blog";
import BlogSearch from "@/components/blog/BlogSearch";
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
  const [posts, categories] = await Promise.all([
    getAllPosts(category),
    getCategories(),
  ]);

  return (
    <div>
      {/* Hero — minimal */}
      <header className="mb-12">
        <h1 className="text-deep-navy text-[2.5rem] font-extrabold tracking-tight leading-tight mb-3">
          Blog
        </h1>
        <p className="text-slate-500 text-lg">
          Scam alerts, protection guides, and product updates.
        </p>
      </header>

      {/* Category tabs — horizontal, underline style */}
      <nav className="flex items-center gap-1 border-b border-border-light mb-10 -mx-1 overflow-x-auto">
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
        {categories.map((cat) => (
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

        {/* Search — right aligned */}
        <div className="ml-auto pl-4">
          <BlogSearch />
        </div>
      </nav>

      {/* Post list — ultra-minimal, divider style */}
      {posts.length === 0 ? (
        <div className="py-20 text-center">
          <p className="text-slate-400 text-base">
            No posts yet. Check back soon.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border-light">
          {posts.map((post) => (
            <article key={post.slug} className="py-7 first:pt-0">
              <Link href={`/blog/${post.slug}`} className="block group">
                <div className="flex items-center gap-2 mb-2">
                  {post.categoryName && (
                    <span className="text-action-teal text-xs font-semibold uppercase tracking-wider">
                      {post.categoryName}
                    </span>
                  )}
                  {post.product && (
                    <>
                      <span className="text-slate-300">&middot;</span>
                      <span className="text-slate-400 text-xs">
                        {post.product}
                      </span>
                    </>
                  )}
                </div>

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
      <section className="mt-16 pt-12 border-t border-border-light">
        <div className="text-center mb-10">
          <h2 className="text-deep-navy text-2xl font-bold mb-2">
            Protect yourself from scams
          </h2>
          <p className="text-slate-500 text-base mb-6">
            Free, private, no signup required.
          </p>
          <Link
            href="/"
            className="inline-block py-3 px-8 bg-deep-navy text-white font-bold text-sm uppercase tracking-widest rounded-[4px] hover:bg-navy transition-colors"
          >
            Check a message
          </Link>
        </div>

        {/* Newsletter signup */}
        <div className="max-w-md mx-auto">
          <SubscribeForm />
        </div>
      </section>
    </div>
  );
}
