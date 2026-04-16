import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/report/", "/scan/", "/api/og/"],
        disallow: ["/api/", "/admin/", "/app/", "/unsubscribe", "/badge/"],
      },
    ],
    sitemap: "https://askarthur.au/sitemap.xml",
  };
}
