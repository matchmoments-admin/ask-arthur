import Link from "next/link";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { getUser } from "@/lib/auth";

export default async function Nav() {
  let user = null;
  if (featureFlags.auth) {
    user = await getUser();
  }

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
        {featureFlags.siteAudit && (
          <Link
            href="/health"
            className="text-deep-navy font-bold text-sm hover:text-action-teal transition-colors py-3 px-2"
          >
            Health
          </Link>
        )}
        {featureFlags.billing && (
          <Link
            href="/pricing"
            className="text-deep-navy font-bold text-sm hover:text-action-teal transition-colors py-3 px-2"
          >
            Pricing
          </Link>
        )}
        {featureFlags.scamFeed && (
          <Link
            href="/scam-feed"
            className="text-deep-navy font-bold text-sm hover:text-action-teal transition-colors py-3 px-2"
          >
            Scam Feed
          </Link>
        )}
        <Link
          href="/blog"
          className="text-deep-navy font-bold text-sm hover:text-action-teal transition-colors py-3 px-2"
        >
          Blog
        </Link>
        <Link
          href="/api-docs"
          className="text-deep-navy font-bold text-sm hover:text-action-teal transition-colors py-3 px-2"
        >
          API
        </Link>
        <Link
          href="/about"
          className="text-deep-navy font-bold text-sm hover:text-action-teal transition-colors py-3 px-2"
        >
          About
        </Link>
        {featureFlags.auth && user && (
          <Link
            href="/app"
            className="rounded-lg bg-action-teal text-white font-bold text-sm px-4 py-2 hover:bg-action-teal/90 transition-colors"
          >
            Dashboard
          </Link>
        )}
        {featureFlags.auth && !user && (
          <Link
            href="/login"
            className="rounded-lg border-2 border-deep-navy text-deep-navy font-bold text-sm px-4 py-2 hover:bg-deep-navy/5 transition-colors"
          >
            Sign In
          </Link>
        )}
      </div>
    </nav>
  );
}
