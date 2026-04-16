import type { Metadata } from "next";
import { Public_Sans } from "next/font/google";
import PlausibleProvider from "next-plausible";
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
  },
  twitter: {
    card: "summary_large_image",
    site: "@askarthur_au",
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
