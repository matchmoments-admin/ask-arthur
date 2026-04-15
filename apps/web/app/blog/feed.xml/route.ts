import { getAllPosts } from "@/lib/blog";

export async function GET() {
  const posts = await getAllPosts();

  const items = posts
    .slice(0, 20)
    .map(
      (post) => `
    <item>
      <title><![CDATA[${post.title}]]></title>
      <link>https://askarthur.au/blog/${post.slug}</link>
      <guid isPermaLink="true">https://askarthur.au/blog/${post.slug}</guid>
      <description><![CDATA[${post.excerpt}]]></description>
      <pubDate>${new Date(post.publishedAt).toUTCString()}</pubDate>
      ${post.categoryName ? `<category>${post.categoryName}</category>` : ""}
    </item>`
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Ask Arthur Blog</title>
    <link>https://askarthur.au/blog</link>
    <description>Scam alerts, protection guides, and threat intelligence for Australians.</description>
    <language>en-au</language>
    <atom:link href="https://askarthur.au/blog/feed.xml" rel="self" type="application/rss+xml"/>
    ${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600",
    },
  });
}
