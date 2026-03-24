import type { NextConfig } from "next";

const securityHeaders = [
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=(), payment=(self)",
  },
  {
    key: "Cross-Origin-Embedder-Policy",
    value: "credentialless",
  },
  {
    key: "Cross-Origin-Opener-Policy",
    value: "same-origin",
  },
  {
    key: "Cross-Origin-Resource-Policy",
    value: "same-origin",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "worker-src 'self' blob:",
      "script-src 'self' 'unsafe-inline' https://plausible.io https://cdn.jsdelivr.net https://cdn.paddle.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
      "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net",
      "img-src 'self' data: blob: https://*.r2.cloudflarestorage.com",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://plausible.io https://cdn.jsdelivr.net https://*.paddle.com",
      "frame-src https://*.paddle.com",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  transpilePackages: ["@askarthur/types", "@askarthur/supabase", "@askarthur/utils", "@askarthur/scam-engine", "@askarthur/bot-core", "@askarthur/extension-audit", "@askarthur/mcp-audit"],
  poweredByHeader: false,
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200],
    imageSizes: [128, 256, 384],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      // Sensitive API routes — prevent caching
      {
        source: "/api/((?!feed|inngest|cron).*)",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, proxy-revalidate" },
          { key: "Pragma", value: "no-cache" },
        ],
      },
      // Extension CORS — wildcard needed for chrome-extension:// origins
      // (auth enforced via X-Extension-Secret, not CORS)
      {
        source: "/api/extension/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, X-Extension-Secret, X-Extension-Id" },
          { key: "Access-Control-Max-Age", value: "86400" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "(www\\.)?askarthur\\.com\\.au" }],
        destination: "https://askarthur.au/:path*",
        permanent: true,
      },
      {
        source: "/audit",
        destination: "/health",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
