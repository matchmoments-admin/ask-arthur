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
  title: "Ask Arthur — Free AI Scam Checker",
  description:
    "Paste a suspicious message, email, or URL and get an instant AI-powered verdict. Free, private, no signup required.",
  openGraph: {
    title: "Ask Arthur — Free AI Scam Checker",
    description:
      "Paste a suspicious message and find out if it's a scam — instantly, for free.",
    url: "https://askarthur.au",
    siteName: "Ask Arthur",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Ask Arthur — Free AI Scam Checker",
    description:
      "Paste a suspicious message and find out if it's a scam — instantly, for free.",
  },
  robots: "index, follow",
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
