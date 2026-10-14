import type { Metadata } from "next";
import Link from "next/link";
import { CirclePause } from "lucide-react";
import Footer from "@/components/Footer";

// Landing page for every route paused by Clone-Watch-only mode — middleware
// 307s paused pages here (apps/web/lib/cloneWatchOnly.ts,
// docs/ops/clone-watch-only-mode.md). noindex: it is a redirect target, not
// content.
export const metadata: Metadata = {
  title: "Consumer checker paused",
  robots: { index: false, follow: false },
};

export default function PausedPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <div className="h-1.5 bg-deep-navy w-full" />

      <main
        id="main-content"
        className="flex-1 flex flex-col items-center justify-center px-5 py-16 text-center"
      >
        <CirclePause className="text-deep-navy mb-4" size={60} />
        <h1 className="text-deep-navy text-4xl font-extrabold mb-3">
          The consumer checker is paused
        </h1>
        <p className="text-gov-slate text-base leading-relaxed mb-8 max-w-md">
          Ask Arthur is focusing on Clone Watch: finding lookalike domains that
          impersonate Australian brands before they are used for phishing.
          The scam checker, browser extension, and chat bots are paused for
          now.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <Link
            href="/clone-watch"
            className="inline-block py-3 px-8 bg-deep-navy text-white font-bold uppercase tracking-widest rounded-[4px] hover:bg-navy transition-colors"
          >
            See Clone Watch
          </Link>
          <Link
            href="/blog"
            className="inline-block py-3 px-8 border border-deep-navy text-deep-navy font-bold uppercase tracking-widest rounded-[4px] hover:bg-deep-navy/5 transition-colors"
          >
            Read the blog
          </Link>
        </div>
      </main>

      <Footer />
    </div>
  );
}
