import type { Metadata } from "next";
import PlausibleProvider from "next-plausible";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ask Arthur — Free AI Scam Checker",
  description:
    "Paste a suspicious message, email, or URL and get an instant AI-powered verdict. Free, private, no signup required.",
  openGraph: {
    title: "Ask Arthur — Free AI Scam Checker",
    description:
      "Paste a suspicious message and find out if it's a scam — instantly, for free.",
    url: "https://askarthur.ai",
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
    <html lang="en" className="light">
      <head>
        <PlausibleProvider domain={process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN || "askarthur.ai"} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0"
          rel="stylesheet"
        />
      </head>
      <body className="bg-white text-gov-slate antialiased">
        {children}
      </body>
    </html>
  );
}
