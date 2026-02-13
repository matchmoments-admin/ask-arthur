import Link from "next/link";
import Footer from "@/components/Footer";
import Nav from "@/components/Nav";

export default function BlogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />

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
