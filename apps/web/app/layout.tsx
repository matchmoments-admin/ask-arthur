import type { Metadata } from "next";
import { Public_Sans } from "next/font/google";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_IMAGE_URL } from "@/lib/og";
import PlausibleProvider from "next-plausible";
import { AxiomWebVitals } from "next-axiom";
import "./globals.css";

const publicSans = Public_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-public-sans",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://askarthur.au"),
  title: {
    default: "Ask Arthur — Free AI Scam Checker",
    template: "%s — Ask Arthur",
  },
  description:
    "Australia's AI-powered scam detection platform. Check suspicious messages, links, phone numbers and more — free, private, no sign-up required.",
  openGraph: {
    siteName: "Ask Arthur",
    locale: "en_AU",
    type: "website",
    // Sitewide fallback card. Until this existed, EVERY shared askarthur.au
    // link — every blog post, the scanner, /clone-watch, the SPF landing pages
    // — rendered a bare preview on LinkedIn, Slack and iMessage.
    //
    // Static PNG rather than an ImageResponse route: the card is a fixed brand
    // asset, so there is nothing to compute per request, and a static file
    // costs nothing on the scrape. Regenerate with
    // `pnpm --filter @askarthur/web og:card` (scripts/og-card-export.ts) after
    // editing the copy, and commit the PNG.
    //
    // Routes that ship their own opengraph-image file convention (e.g. /hub)
    // override this automatically — the file convention beats parent metadata.
    images: OG_DEFAULT_IMAGE,
  },
  twitter: {
    card: "summary_large_image",
    site: "@askarthur_au",
    images: [OG_DEFAULT_IMAGE_URL],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`light ${publicSans.variable}`}>
      <head>
        <PlausibleProvider domain={process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN || "askarthur.au"} />
      </head>
      <body className="bg-white text-gov-slate antialiased">
        {/* Reports Core Web Vitals (LCP/CLS/INP/FCP/TTFB) to the ask-arthur
            Axiom dataset (source: "web-vitals") so page-speed regressions are
            visible on the dashboard. Client-only, fire-and-forget, no alerting. */}
        <AxiomWebVitals />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-deep-navy focus:text-white focus:px-4 focus:py-2 focus:rounded"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
