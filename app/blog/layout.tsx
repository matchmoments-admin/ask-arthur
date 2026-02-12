import Link from "next/link";
import Footer from "@/components/Footer";

export default function BlogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar */}
      <div className="h-1.5 bg-deep-navy w-full" />

      {/* Nav */}
      <nav className="w-full max-w-[640px] mx-auto px-5 py-4 flex items-center justify-between border-b border-gray-100">
        <Link
          href="/"
          className="text-deep-navy font-extrabold text-lg uppercase tracking-wide"
        >
          Ask Arthur
        </Link>
        <div className="flex items-center gap-4">
          <Link
            href="/blog"
            className="text-deep-navy font-bold text-sm hover:text-action-teal transition-colors"
          >
            Blog
          </Link>
          <Link
            href="/about"
            className="text-deep-navy font-bold text-sm hover:text-action-teal transition-colors"
          >
            About
          </Link>
        </div>
      </nav>

      {/* Breadcrumb */}
      <div className="w-full max-w-[640px] mx-auto px-5 pt-4">
        <nav className="text-xs text-slate-400">
          <Link href="/" className="hover:text-action-teal transition-colors">
            Home
          </Link>
          <span className="mx-1.5">/</span>
          <Link
            href="/blog"
            className="hover:text-action-teal transition-colors"
          >
            Blog
          </Link>
        </nav>
      </div>

      <main className="flex-1 w-full max-w-[640px] mx-auto px-5 pt-8 pb-12">
        {children}
      </main>

      <Footer />
    </div>
  );
}
