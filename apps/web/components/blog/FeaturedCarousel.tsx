import Link from "next/link";
import type { BlogPost } from "@/lib/blog";
import { CATEGORY_DISPLAY } from "@/lib/blog";

interface FeaturedCarouselProps {
  posts: BlogPost[];
}

export default function FeaturedCarousel({ posts }: FeaturedCarouselProps) {
  if (posts.length === 0) return null;

  return (
    <section className="mb-10">
      <h2 className="text-deep-navy text-sm font-bold uppercase tracking-wider mb-4">
        Featured
      </h2>
      <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1">
        {posts.map((post) => (
          <Link
            key={post.slug}
            href={`/blog/${post.slug}`}
            className="snap-start shrink-0 w-[280px] border border-border-light rounded-lg p-5 hover:border-action-teal/40 transition-colors group"
          >
            <span className="bg-action-teal/10 text-action-teal-text text-[10px] font-semibold px-2 py-0.5 rounded-full">
              {CATEGORY_DISPLAY[post.category] || post.category}
            </span>
            <h3 className="text-deep-navy text-base font-bold mt-2 mb-1 group-hover:text-action-teal transition-colors line-clamp-2">
              {post.title}
            </h3>
            <p className="text-gov-slate text-xs line-clamp-2 mb-2">
              {post.excerpt}
            </p>
            <span className="text-xs text-slate-400">{post.readingTime}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
