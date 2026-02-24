import Link from "next/link";
import { searchPosts } from "@/lib/blog";
import type { Metadata } from "next";

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export async function generateMetadata({
  searchParams,
}: PageProps): Promise<Metadata> {
  const { q } = await searchParams;
  return { title: q ? `Search: ${q} — Ask Arthur` : "Search — Ask Arthur" };
}

export default async function BlogSearchPage({ searchParams }: PageProps) {
  const { q } = await searchParams;
  const results = q ? await searchPosts(q) : [];

  return (
    <div>
      <header className="mb-10">
        <Link
          href="/blog"
          className="text-action-teal text-sm font-medium hover:underline mb-4 block"
        >
          &larr; Back to blog
        </Link>
        <h1 className="text-deep-navy text-2xl font-bold">
          {q ? `Results for "${q}"` : "Search"}
        </h1>
        {q && (
          <p className="text-slate-400 text-sm mt-1">
            {results.length} {results.length === 1 ? "post" : "posts"} found
          </p>
        )}
      </header>

      {results.length === 0 ? (
        <p className="text-slate-400 py-12 text-center">
          {q
            ? "No posts match your search."
            : "Enter a search term to find posts."}
        </p>
      ) : (
        <div className="divide-y divide-border-light">
          {results.map((post) => (
            <article key={post.slug} className="py-6 first:pt-0">
              <Link href={`/blog/${post.slug}`} className="block group">
                {post.categoryName && (
                  <span className="text-action-teal text-xs font-semibold uppercase tracking-wider block mb-1">
                    {post.categoryName}
                  </span>
                )}
                <h2 className="text-deep-navy text-lg font-bold leading-snug group-hover:text-action-teal transition-colors">
                  {post.title}
                </h2>
                <p className="text-slate-500 text-sm mt-1 line-clamp-2">
                  {post.excerpt}
                </p>
                <time
                  dateTime={post.publishedAt}
                  className="text-xs text-slate-400 mt-2 block"
                >
                  {new Date(post.publishedAt).toLocaleDateString("en-AU", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </time>
              </Link>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
