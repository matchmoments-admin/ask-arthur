import {
  getPaginatedPosts,
  getAllCategories,
  CATEGORY_DISPLAY,
} from "@/lib/blog";
import PostCard from "@/components/blog/PostCard";
import CategoryTabs from "@/components/blog/CategoryTabs";
import Pagination from "@/components/blog/Pagination";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const displayName = CATEGORY_DISPLAY[slug] || slug;

  return {
    title: `${displayName} — Ask Arthur Blog`,
    description: `Browse ${displayName.toLowerCase()} posts on the Ask Arthur blog. Scam alerts and fraud prevention for Australians.`,
    openGraph: {
      title: `${displayName} — Ask Arthur Blog`,
      description: `Browse ${displayName.toLowerCase()} posts on the Ask Arthur blog.`,
      type: "website",
    },
  };
}

export const revalidate = 3600;

export default async function CategoryPage({
  params,
  searchParams,
}: PageProps) {
  const { slug: category } = await params;
  const { page: pageStr } = await searchParams;
  const page = Math.max(1, parseInt(pageStr || "1", 10) || 1);

  const [paginated, categories] = await Promise.all([
    getPaginatedPosts(page, 12, category),
    getAllCategories(),
  ]);

  const totalPosts = categories.reduce((sum, c) => sum + c.count, 0);
  const displayName = CATEGORY_DISPLAY[category] || category;

  return (
    <div>
      <h1 className="text-deep-navy text-3xl font-extrabold mb-2">
        {displayName}
      </h1>
      <p className="text-gov-slate text-base mb-8">
        Browse all {displayName.toLowerCase()} posts.
      </p>

      <CategoryTabs
        categories={categories}
        activeCategory={category}
        totalPosts={totalPosts}
      />

      {paginated.posts.length === 0 ? (
        <div className="text-center py-16">
          <span className="material-symbols-outlined text-slate-300 text-5xl mb-4 block">
            article
          </span>
          <p className="text-gov-slate text-base">
            No posts in this category yet.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {paginated.posts.map((post) => (
            <PostCard key={post.slug} post={post} />
          ))}
        </div>
      )}

      <Pagination
        page={paginated.page}
        totalPages={paginated.totalPages}
        basePath={`/blog/category/${category}`}
      />
    </div>
  );
}
