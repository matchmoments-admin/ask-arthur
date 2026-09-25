import type { Metadata } from "next";
import localFont from "next/font/local";

const newsreader = localFont({
  src: [
    { path: "../fonts/newsreader-latin-400-700-normal.woff2", weight: "400 700", style: "normal" },
    { path: "../fonts/newsreader-latin-400-700-italic.woff2", weight: "400 700", style: "italic" },
  ],
  display: "swap",
  variable: "--font-newsreader",
  adjustFontFallback: "Times New Roman",
});

const inter = localFont({
  src: [
    { path: "../fonts/inter-latin-400-700-normal.woff2", weight: "400 700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-inter",
});

const jetbrainsMono = localFont({
  src: [
    { path: "../fonts/jetbrains-mono-latin-400-700-normal.woff2", weight: "400 700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  title: "Investor one-pager",
  description:
    "Ask Arthur — investor one-pager. Free, private scam-detection tool for Australia, built solo.",
  robots: { index: false, follow: false },
};

export default function InvestorsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className={`${newsreader.variable} ${inter.variable} ${jetbrainsMono.variable}`}
    >
      {children}
    </div>
  );
}
