import Link from "next/link";
import { getAllPosts } from "@/lib/blog";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Scam Alerts & Guides — Ask Arthur Blog",
  description:
    "Weekly scam alerts, fraud prevention guides, and cybersecurity tips for Australians. Stay informed about the latest scams targeting Australians.",
  openGraph: {
    title: "Scam Alerts & Guides — Ask Arthur Blog",
    description:
      "Weekly scam alerts and fraud prevention guides for Australians.",
    type: "website",
  },
};

// Revalidate every hour
export const revalidate = 3600;

export default async function BlogPage() {
  const posts = await getAllPosts();

  return (
    <div>
      <h1 className="text-deep-navy text-3xl font-extrabold mb-2">
        Scam Alerts & Guides
      </h1>
      <p className="text-gov-slate text-base mb-10">
        Weekly scam alerts and fraud prevention tips based on real threats
        detected by Ask Arthur.
      </p>

      {posts.length === 0 ? (
        <div className="text-center py-16">
          <span className="material-symbols-outlined text-slate-300 text-5xl mb-4 block">
            article
          </span>
          <p className="text-gov-slate text-base">
            No posts yet. Check back soon for weekly scam alerts.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {posts.map((post) => (
            <article
              key={post.slug}
              className="border border-border-light rounded-lg p-6 hover:border-action-teal/40 transition-colors"
            >
              <Link href={`/blog/${post.slug}`} className="block group">
                <h2 className="text-deep-navy text-xl font-bold mb-2 group-hover:text-action-teal transition-colors">
                  {post.title}
                </h2>
                <p className="text-gov-slate text-sm mb-3">{post.excerpt}</p>
                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <time dateTime={post.publishedAt}>
                    {new Date(post.publishedAt).toLocaleDateString("en-AU", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </time>
                  <span>&middot;</span>
                  <span>{post.readingTime}</span>
                  {post.tags.length > 0 && (
                    <>
                      <span>&middot;</span>
                      <div className="flex gap-1.5">
                        {post.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-medium"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </Link>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
