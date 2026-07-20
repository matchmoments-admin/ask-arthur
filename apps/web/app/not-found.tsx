import type { Metadata } from "next";
import Link from "next/link";
import { SearchX } from "lucide-react";
import Footer from "@/components/Footer";

// The root layout defaults every page to `robots: index:true`. This boundary
// renders whenever `notFound()` is thrown — and in Next's streaming model a
// `notFound()` thrown AFTER an await (unknown /blog/[slug], /intel/themes/
// [slug], /report/[domain], etc.) is served with HTTP 200, not 404, once the
// shell has flushed. A 200 "not found" body is a soft-404 Google can index.
// Overriding robots to noindex here neutralises that for every not-found
// render at once — present and future pages — regardless of HTTP status.
export const metadata: Metadata = {
  title: "Page Not Found",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col">
      <div className="h-1.5 bg-deep-navy w-full" />

      <main className="flex-1 flex flex-col items-center justify-center px-5 text-center">
        <SearchX className="text-deep-navy mb-4" size={60} />
        <h1 className="text-deep-navy text-4xl font-extrabold mb-3">
          Page Not Found
        </h1>
        <p className="text-gov-slate text-base leading-relaxed mb-8 max-w-md">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link
          href="/"
          className="inline-block py-3 px-8 bg-deep-navy text-white font-bold uppercase tracking-widest rounded-[4px] hover:bg-navy transition-colors"
        >
          Go Home
        </Link>
      </main>

      <Footer />
    </div>
  );
}
