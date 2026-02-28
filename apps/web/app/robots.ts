import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/report/", "/scan/"],
      disallow: ["/api/", "/admin/", "/unsubscribe", "/badge/"],
    },
    sitemap: "https://askarthur.au/sitemap.xml",
  };
}
