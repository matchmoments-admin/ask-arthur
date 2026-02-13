import Link from "next/link";

export default function Footer() {
  return (
    <footer className="w-full bg-slate-50 border-t border-border-light py-8 mt-20">
      <div className="max-w-[640px] mx-auto px-5 text-center">
        <nav aria-label="Footer navigation" className="grid grid-cols-4 gap-4 mb-4">
          <Link href="/about#how-it-works" className="text-xs font-bold uppercase tracking-widest text-gov-slate hover:text-action-teal transition-colors">
            How It Works
          </Link>
          <Link href="/blog" className="text-xs font-bold uppercase tracking-widest text-gov-slate hover:text-action-teal transition-colors">
            Blog
          </Link>
          <Link href="/about" className="text-xs font-bold uppercase tracking-widest text-gov-slate hover:text-action-teal transition-colors">
            About
          </Link>
          <Link href="/about#privacy" className="text-xs font-bold uppercase tracking-widest text-gov-slate hover:text-action-teal transition-colors">
            Privacy
          </Link>
        </nav>
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
          Official Cybersecurity Advisory Interface
        </p>
        <p className="text-[10px] uppercase tracking-wider text-slate-400">
          &copy; {new Date().getFullYear()} Ask Arthur
        </p>
      </div>
    </footer>
  );
}
