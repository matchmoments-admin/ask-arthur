import Link from "next/link";

export default function Nav() {
  return (
    <nav
      aria-label="Main navigation"
      className="w-full max-w-[640px] mx-auto px-5 py-4 flex items-center justify-between border-b border-gray-100"
    >
      <Link
        href="/"
        className="text-deep-navy font-extrabold text-lg uppercase tracking-wide"
      >
        Ask Arthur
      </Link>
      <div className="flex items-center gap-4">
        <Link
          href="/blog"
          className="text-deep-navy font-bold text-sm hover:text-action-teal transition-colors py-3 px-2"
        >
          Blog
        </Link>
        <Link
          href="/about"
          className="text-deep-navy font-bold text-sm hover:text-action-teal transition-colors py-3 px-2"
        >
          About
        </Link>
      </div>
    </nav>
  );
}
