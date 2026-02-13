import Link from "next/link";
import Footer from "@/components/Footer";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col">
      <div className="h-1.5 bg-deep-navy w-full" />

      <main className="flex-1 flex flex-col items-center justify-center px-5 text-center">
        <span className="material-symbols-outlined text-deep-navy text-6xl mb-4">
          search_off
        </span>
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
