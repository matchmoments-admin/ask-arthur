import { createServiceClient } from "@askarthur/supabase/server";
import readingTime from "reading-time";

export interface BlogPost {
  slug: string;
  title: string;
  subtitle: string | null;
  excerpt: string;
  content: string;
  author: string;
  tags: string[];
  categorySlug: string | null;
  categoryName: string | null;
  product: string | null;
  heroImageUrl: string | null;
  heroImageAlt: string | null;
  publishedAt: string;
  updatedAt: string | null;
  readingTime: string;
  readingTimeMinutes: number;
  isFeatured: boolean;
  seoTitle: string | null;
  metaDescription: string | null;
}

export interface BlogCategory {
  slug: string;
  name: string;
  description: string | null;
}

interface BlogRow {
  slug: string;
  title: string;
  subtitle: string | null;
  excerpt: string;
  content: string;
  author: string;
  tags: string[];
  category_slug: string | null;
  product: string | null;
  hero_image_url: string | null;
  hero_image_alt: string | null;
  published_at: string;
  updated_at: string | null;
  reading_time_minutes: number | null;
  is_featured: boolean | null;
  seo_title: string | null;
  meta_description: string | null;
  blog_categories: { name: string } | null;
}

function rowToPost(row: BlogRow): BlogPost {
  const rt = readingTime(row.content);
  const minutes = row.reading_time_minutes ?? Math.ceil(rt.minutes);
  return {
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle,
    excerpt: row.excerpt,
    content: row.content,
    author: row.author,
    tags: row.tags || [],
    categorySlug: row.category_slug,
    categoryName: row.blog_categories?.name ?? null,
    product: row.product,
    heroImageUrl: row.hero_image_url,
    heroImageAlt: row.hero_image_alt,
    publishedAt: row.published_at,
    updatedAt: row.updated_at ?? null,
    readingTime: rt.text,
    readingTimeMinutes: Math.max(1, minutes),
    isFeatured: row.is_featured ?? false,
    seoTitle: row.seo_title ?? null,
    metaDescription: row.meta_description ?? null,
  };
}

const POST_SELECT = `
  slug, title, subtitle, excerpt, content, author, tags,
  category_slug, product, hero_image_url, hero_image_alt,
  published_at, updated_at, reading_time_minutes, is_featured,
  seo_title, meta_description,
  blog_categories ( name )
`;

export async function getAllPosts(categorySlug?: string): Promise<BlogPost[]> {
  const supabase = createServiceClient();
  if (!supabase) return [];

  let query = supabase
    .from("blog_posts")
    .select(POST_SELECT)
    .eq("status", "published")
    .order("published_at", { ascending: false });

  if (categorySlug) {
    query = query.eq("category_slug", categorySlug);
  }

  const { data, error } = await query;
  if (error || !data) return [];
  return (data as unknown as BlogRow[]).map(rowToPost);
}

export async function getPostBySlug(slug: string): Promise<BlogPost | null> {
  const supabase = createServiceClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("blog_posts")
    .select(POST_SELECT)
    .eq("slug", slug)
    .eq("status", "published")
    .single();

  if (error || !data) return null;
  return rowToPost(data as unknown as BlogRow);
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

export async function getCategories(): Promise<BlogCategory[]> {
  const supabase = createServiceClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("blog_categories")
    .select("slug, name, description")
    .order("sort_order", { ascending: true });

  return (data as BlogCategory[]) || [];
}

export async function searchPosts(query: string): Promise<BlogPost[]> {
  const supabase = createServiceClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("blog_posts")
    .select(POST_SELECT)
    .eq("status", "published")
    .textSearch("search_vector", query, { type: "websearch" })
    .order("published_at", { ascending: false })
    .limit(20);

  if (error || !data) return [];
  return (data as unknown as BlogRow[]).map(rowToPost);
}

export async function getRelatedPosts(
  currentSlug: string,
  categorySlug: string | null,
  limit = 4
): Promise<BlogPost[]> {
  const supabase = createServiceClient();
  if (!supabase) return [];

  let query = supabase
    .from("blog_posts")
    .select(POST_SELECT)
    .eq("status", "published")
    .neq("slug", currentSlug)
    .order("published_at", { ascending: false })
    .limit(limit);

  if (categorySlug) {
    query = query.eq("category_slug", categorySlug);
  }

  const { data, error } = await query;
  if (error || !data) return [];
  return (data as unknown as BlogRow[]).map(rowToPost);
}
