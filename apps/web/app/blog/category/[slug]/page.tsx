import { redirect } from "next/navigation";
import Link from "next/link";
import { getAllPosts, getCategories } from "@/lib/blog";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const categories = await getCategories();
  const cat = categories.find((c) => c.slug === slug);
  if (!cat) return { title: "Not Found — Ask Arthur" };

  return {
    title: `${cat.name} — Ask Arthur Blog`,
    description: cat.description || `${cat.name} posts from Ask Arthur.`,
  };
}

export const revalidate = 3600;

export default async function CategoryPage({ params }: PageProps) {
  const { slug } = await params;
  const [categories, posts] = await Promise.all([
    getCategories(),
    getAllPosts(slug),
  ]);

  const category = categories.find((c) => c.slug === slug);
  if (!category) redirect("/blog");

  return (
    <div>
      <header className="mb-10">
        <Link
          href="/blog"
          className="text-action-teal text-sm font-medium hover:underline mb-4 block"
        >
          &larr; All posts
        </Link>
        <h1 className="text-deep-navy text-[2rem] font-extrabold tracking-tight mb-2">
          {category.name}
        </h1>
        {category.description && (
          <p className="text-slate-500 text-base">{category.description}</p>
        )}
      </header>

      {/* Category tabs */}
      <nav className="flex items-center gap-1 border-b border-border-light mb-10 overflow-x-auto">
        {categories.map((cat) => (
          <Link
            key={cat.slug}
            href={`/blog/category/${cat.slug}`}
            className={`px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors relative ${
              cat.slug === slug
                ? "text-deep-navy after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-deep-navy"
                : "text-slate-400 hover:text-deep-navy"
            }`}
          >
            {cat.name}
          </Link>
        ))}
      </nav>

      {/* Posts */}
      {posts.length === 0 ? (
        <p className="text-slate-400 py-12 text-center">
          No posts in this category yet.
        </p>
      ) : (
        <div className="divide-y divide-border-light">
          {posts.map((post) => (
            <article key={post.slug} className="py-7 first:pt-0">
              <Link href={`/blog/${post.slug}`} className="block group">
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
    </div>
  );
}
