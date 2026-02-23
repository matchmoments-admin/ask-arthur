import Link from "next/link";
import { CATEGORY_DISPLAY } from "@/lib/blog";
import type { CategoryCount } from "@/lib/blog";

interface CategoryTabsProps {
  categories: CategoryCount[];
  activeCategory?: string;
  totalPosts: number;
}

export default function CategoryTabs({
  categories,
  activeCategory,
  totalPosts,
}: CategoryTabsProps) {
  return (
    <nav
      className="flex gap-1 overflow-x-auto border-b border-border-light mb-8 -mx-1 px-1"
      aria-label="Blog categories"
    >
      <Link
        href="/blog"
        className={`whitespace-nowrap px-3 py-2.5 text-sm font-medium transition-colors ${
          !activeCategory
            ? "border-b-2 border-action-teal text-deep-navy font-bold"
            : "text-slate-400 hover:text-gov-slate"
        }`}
      >
        All ({totalPosts})
      </Link>
      {categories.map(({ category, count }) => (
        <Link
          key={category}
          href={`/blog/category/${category}`}
          className={`whitespace-nowrap px-3 py-2.5 text-sm font-medium transition-colors ${
            activeCategory === category
              ? "border-b-2 border-action-teal text-deep-navy font-bold"
              : "text-slate-400 hover:text-gov-slate"
          }`}
        >
          {CATEGORY_DISPLAY[category] || category} ({count})
        </Link>
      ))}
    </nav>
  );
}
