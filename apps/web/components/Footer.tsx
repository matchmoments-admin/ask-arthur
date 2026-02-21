import Link from "next/link";

export default function Footer() {
  return (
    <footer className="w-full bg-slate-50 border-t border-border-light py-8 mt-20">
      <div className="max-w-[640px] mx-auto px-5 text-center">
        <nav aria-label="Footer navigation" className="flex flex-wrap justify-center gap-x-6 gap-y-2 mb-4">
          <Link href="/about#how-it-works" className="text-xs font-bold uppercase tracking-widest text-gov-slate hover:text-action-teal transition-colors py-3">
            How It Works
          </Link>
          <Link href="/blog" className="text-xs font-bold uppercase tracking-widest text-gov-slate hover:text-action-teal transition-colors py-3">
            Blog
          </Link>
          <Link href="/api-docs" className="text-xs font-bold uppercase tracking-widest text-gov-slate hover:text-action-teal transition-colors py-3">
            API
          </Link>
          <Link href="/about" className="text-xs font-bold uppercase tracking-widest text-gov-slate hover:text-action-teal transition-colors py-3">
            About
          </Link>
          <Link href="/privacy" className="text-xs font-bold uppercase tracking-widest text-gov-slate hover:text-action-teal transition-colors py-3">
            Privacy
          </Link>
          <Link href="/terms" className="text-xs font-bold uppercase tracking-widest text-gov-slate hover:text-action-teal transition-colors py-3">
            Terms
          </Link>
        </nav>
        <p className="text-xs text-gov-slate mb-4 leading-relaxed">
          If you&apos;ve been scammed, call{" "}
          <a href="tel:1300292371" className="font-bold text-deep-navy hover:text-action-teal transition-colors">
            1300 CYBER1
          </a>{" "}
          or report to{" "}
          <a
            href="https://www.scamwatch.gov.au/report-a-scam"
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold text-deep-navy hover:text-action-teal transition-colors"
          >
            Scamwatch
          </a>
        </p>
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
          Independent Cybersecurity Advisory Tool
        </p>
        <p className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">
          Ask Arthur is not affiliated with the Australian Government
        </p>
        <p className="text-[10px] uppercase tracking-wider text-slate-400">
          &copy; {new Date().getFullYear()} Ask Arthur
        </p>
        <p className="text-[10px] uppercase tracking-wider text-slate-400 mt-1">
          {process.env.NEXT_PUBLIC_ABN || "ABN pending registration"}
        </p>
      </div>
    </footer>
  );
}
