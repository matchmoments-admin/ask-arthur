import Footer from "@/components/Footer";
import Nav from "@/components/Nav";
import type { Metadata } from "next";

export const metadata: Metadata = {
  alternates: {
    types: {
      "application/rss+xml": "https://askarthur.au/blog/feed.xml",
    },
  },
};

export default function BlogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1 w-full max-w-[640px] mx-auto px-5 pt-10 pb-16">
        {children}
      </main>
      <Footer />
    </div>
  );
}
