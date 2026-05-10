import type { Metadata } from "next";
import { Newsreader, Inter, JetBrains_Mono } from "next/font/google";

const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-newsreader",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-inter",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
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
