import { createServiceClient } from "@askarthur/supabase/server";
import readingTime from "reading-time";

export interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  author: string;
  tags: string[];
  publishedAt: string;
  readingTime: string;
}

interface BlogRow {
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  author: string;
  tags: string[];
  published_at: string;
}

function rowToPost(row: BlogRow): BlogPost {
  return {
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    content: row.content,
    author: row.author,
    tags: row.tags || [],
    publishedAt: row.published_at,
    readingTime: readingTime(row.content).text,
  };
}

export async function getAllPosts(): Promise<BlogPost[]> {
  const supabase = createServiceClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("blog_posts")
    .select("slug, title, excerpt, content, author, tags, published_at")
    .eq("published", true)
    .order("published_at", { ascending: false });

  if (error || !data) return [];

  return data.map(rowToPost);
}

export async function getPostBySlug(slug: string): Promise<BlogPost | null> {
  const supabase = createServiceClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("blog_posts")
    .select("slug, title, excerpt, content, author, tags, published_at")
    .eq("slug", slug)
    .eq("published", true)
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
    .eq("published", true);

  return data?.map((row) => row.slug) || [];
}
