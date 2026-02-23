import { createServiceClient } from "@askarthur/supabase/server";
import readingTime from "reading-time";

export const CATEGORY_DISPLAY: Record<string, string> = {
  "weekly-roundup": "Weekly Roundup",
  "scam-alerts": "Scam Alerts",
  guides: "Guides",
  "platform-safety": "Platform Safety",
  news: "News",
};

export interface BlogPost {
  slug: string;
  title: string;
  subtitle: string | null;
  excerpt: string;
  content: string;
  author: string;
  tags: string[];
  publishedAt: string;
  updatedAt: string | null;
  readingTime: string;
  readingTimeMinutes: number;
  category: string;
  isFeatured: boolean;
  seoTitle: string | null;
  metaDescription: string | null;
}

interface BlogRow {
  slug: string;
  title: string;
  subtitle: string | null;
  excerpt: string;
  content: string;
  author: string;
  tags: string[];
  published_at: string;
  updated_at: string | null;
  reading_time_minutes: number | null;
  category: string | null;
  is_featured: boolean | null;
  seo_title: string | null;
  meta_description: string | null;
}

const POST_COLUMNS =
  "slug, title, subtitle, excerpt, content, author, tags, published_at, updated_at, reading_time_minutes, category, is_featured, seo_title, meta_description";

function rowToPost(row: BlogRow): BlogPost {
  const minutes = row.reading_time_minutes ?? Math.ceil(readingTime(row.content).minutes);
  return {
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle ?? null,
    excerpt: row.excerpt,
    content: row.content,
    author: row.author,
    tags: row.tags || [],
    publishedAt: row.published_at,
    updatedAt: row.updated_at ?? null,
    readingTime: `${minutes} min read`,
    readingTimeMinutes: minutes,
    category: row.category || "weekly-roundup",
    isFeatured: row.is_featured ?? false,
    seoTitle: row.seo_title ?? null,
    metaDescription: row.meta_description ?? null,
  };
}

export async function getAllPosts(): Promise<BlogPost[]> {
  const supabase = createServiceClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("blog_posts")
    .select(POST_COLUMNS)
    .eq("status", "published")
    .order("published_at", { ascending: false });

  if (error || !data) return [];

  return data.map(rowToPost);
}

export async function getPostBySlug(slug: string): Promise<BlogPost | null> {
  const supabase = createServiceClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("blog_posts")
    .select(POST_COLUMNS)
    .eq("slug", slug)
    .eq("status", "published")
    .single();

  if (error || !data) return null;

  return rowToPost(data);
}

export async function getAllSlugs(): Promise<string[]> {
  const supabase = createServiceClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("blog_posts")
    .select("slug")
    .eq("status", "published");

  return data?.map((row) => row.slug) || [];
}

export async function getFeaturedPosts(limit = 5): Promise<BlogPost[]> {
  const supabase = createServiceClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("blog_posts")
    .select(POST_COLUMNS)
    .eq("status", "published")
    .eq("is_featured", true)
    .order("published_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return data.map(rowToPost);
}

export async function getRelatedPosts(
  slug: string,
  category: string,
  limit = 4
): Promise<BlogPost[]> {
  const supabase = createServiceClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("blog_posts")
    .select(POST_COLUMNS)
    .eq("status", "published")
    .eq("category", category)
    .neq("slug", slug)
    .order("published_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return data.map(rowToPost);
}

export interface CategoryCount {
  category: string;
  count: number;
}

export async function getAllCategories(): Promise<CategoryCount[]> {
  const supabase = createServiceClient();
  if (!supabase) return [];

  // Supabase JS doesn't support GROUP BY, so fetch all published and count client-side
  const { data, error } = await supabase
    .from("blog_posts")
    .select("category")
    .eq("status", "published");

  if (error || !data) return [];

  const counts = new Map<string, number>();
  for (const row of data) {
    const cat = row.category || "weekly-roundup";
    counts.set(cat, (counts.get(cat) || 0) + 1);
  }

  return Array.from(counts.entries()).map(([category, count]) => ({
    category,
    count,
  }));
}

export interface PaginatedResult {
  posts: BlogPost[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function getPaginatedPosts(
  page = 1,
  pageSize = 12,
  category?: string
): Promise<PaginatedResult> {
  const supabase = createServiceClient();
  if (!supabase) return { posts: [], total: 0, page, pageSize, totalPages: 0 };

  let query = supabase
    .from("blog_posts")
    .select(POST_COLUMNS, { count: "exact" })
    .eq("status", "published");

  if (category) {
    query = query.eq("category", category);
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await query
    .order("published_at", { ascending: false })
    .range(from, to);

  if (error || !data) {
    return { posts: [], total: 0, page, pageSize, totalPages: 0 };
  }

  const total = count ?? 0;
  return {
    posts: data.map(rowToPost),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}
