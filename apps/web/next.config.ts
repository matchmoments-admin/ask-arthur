import type { NextConfig } from "next";

// CSP shared by the Turnstile bridge page. Extensions must be allowed to
// iframe the bridge, and Cloudflare Turnstile must be allowed to load scripts
// + open its own iframe. Everything else stays locked down.
const turnstileCsp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
  "frame-ancestors chrome-extension://* moz-extension://*",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const turnstilePageHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Content-Security-Policy", value: turnstileCsp },
];

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
      "script-src 'self' 'unsafe-inline' https://plausible.io https://cdn.jsdelivr.net https://js.stripe.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
      "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net",
      "img-src 'self' data: blob: https://*.r2.cloudflarestorage.com https://*.stripe.com https://blog.askarthur.au",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://plausible.io https://cdn.jsdelivr.net https://api.stripe.com",
      "frame-src https://js.stripe.com https://hooks.stripe.com",
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
    remotePatterns: [
      { protocol: "https", hostname: "blog.askarthur.au" },
    ],
  },
  async headers() {
    return [
      // Global security headers — exclude /extension-turnstile which needs a
      // relaxed CSP so extensions can iframe it.
      {
        source: "/((?!extension-turnstile).*)",
        headers: securityHeaders,
      },
      // Turnstile bridge page — framed by chrome-extension:// and moz-extension://
      {
        source: "/extension-turnstile",
        headers: turnstilePageHeaders,
      },
      // Sensitive API routes — prevent caching
      {
        source: "/api/((?!feed|inngest|cron).*)",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, proxy-revalidate" },
          { key: "Pragma", value: "no-cache" },
        ],
      },
      // Extension CORS — wildcard needed for chrome-extension:// origins.
      // Auth is enforced via the per-install ECDSA signature, not CORS.
      {
        source: "/api/extension/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
          {
            key: "Access-Control-Allow-Headers",
            value: [
              "Content-Type",
              "X-Extension-Install-Id",
              "X-Extension-Timestamp",
              "X-Extension-Nonce",
              "X-Extension-Signature",
              "X-Request-ID",
              "X-Scan-Source",
            ].join(", "),
          },
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
      {
        source: "/scanner",
        destination: "/health",
        permanent: true,
      },
      // Pricing is hidden until there's a paid product worth showing — until
      // then anyone interested in commercial terms goes through /contact.
      // Temporary (307) so search engines don't drop /pricing from the index
      // when we bring it back.
      {
        source: "/pricing",
        destination: "/contact",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
