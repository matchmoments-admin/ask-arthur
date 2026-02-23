import type { MetadataRoute } from "next";
import { getAllPosts, getAllCategories } from "@/lib/blog";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = "https://askarthur.au";

  const [posts, categories] = await Promise.all([
    getAllPosts(),
    getAllCategories(),
  ]);

  const postEntries: MetadataRoute.Sitemap = posts.map((post) => ({
    url: `${baseUrl}/blog/${post.slug}`,
    lastModified: new Date(post.updatedAt || post.publishedAt),
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  const categoryEntries: MetadataRoute.Sitemap = categories.map(
    ({ category }) => ({
      url: `${baseUrl}/blog/category/${category}`,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })
  );

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
