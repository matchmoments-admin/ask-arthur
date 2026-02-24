import type { MetadataRoute } from "next";
import { getAllPosts, getCategories } from "@/lib/blog";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = "https://askarthur.au";

  const [posts, categories] = await Promise.all([
    getAllPosts(),
    getCategories(),
  ]);

  const postEntries: MetadataRoute.Sitemap = posts.map((post) => ({
    url: `${baseUrl}/blog/${post.slug}`,
    lastModified: new Date(post.updatedAt || post.publishedAt),
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  const categoryEntries: MetadataRoute.Sitemap = categories.map((cat) => ({
    url: `${baseUrl}/blog/category/${cat.slug}`,
    changeFrequency: "weekly" as const,
    priority: 0.6,
  }));

  return [
    {
      url: `${baseUrl}/blog`,
      changeFrequency: "daily" as const,
      priority: 0.8,
    },
    ...categoryEntries,
    ...postEntries,
  ];
}
