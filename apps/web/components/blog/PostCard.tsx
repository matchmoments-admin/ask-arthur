import Link from "next/link";
import type { BlogPost } from "@/lib/blog";
import { CATEGORY_DISPLAY } from "@/lib/blog";

interface PostCardProps {
  post: BlogPost;
  compact?: boolean;
}

export default function PostCard({ post, compact }: PostCardProps) {
  if (compact) {
    return (
      <article className="border border-border-light rounded-lg p-4 hover:border-action-teal/40 transition-colors">
        <Link href={`/blog/${post.slug}`} className="block group">
          <h3 className="text-deep-navy text-sm font-bold mb-1 group-hover:text-action-teal transition-colors line-clamp-2">
            {post.title}
          </h3>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <time dateTime={post.publishedAt}>
              {new Date(post.publishedAt).toLocaleDateString("en-AU", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </time>
            <span>&middot;</span>
            <span>{post.readingTime}</span>
          </div>
        </Link>
      </article>
    );
  }

  return (
    <article className="border border-border-light rounded-lg p-6 hover:border-action-teal/40 transition-colors">
      <Link href={`/blog/${post.slug}`} className="block group">
        <div className="flex items-center gap-2 mb-2">
          <span className="bg-action-teal/10 text-action-teal-text text-[10px] font-semibold px-2 py-0.5 rounded-full">
            {CATEGORY_DISPLAY[post.category] || post.category}
          </span>
          {post.isFeatured && (
            <span className="bg-warn-bg text-warn-text text-[10px] font-semibold px-2 py-0.5 rounded-full">
              Featured
            </span>
          )}
        </div>
        <h2 className="text-deep-navy text-xl font-bold mb-2 group-hover:text-action-teal transition-colors">
          {post.title}
        </h2>
        <p className="text-gov-slate text-sm mb-3 line-clamp-2">
          {post.excerpt}
        </p>
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
  );
}
