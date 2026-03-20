import Link from "next/link";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { getUser } from "@/lib/auth";
import MobileMenu from "./MobileMenu";

export default async function Nav() {
  let user = null;
  if (featureFlags.auth) {
    user = await getUser();
  }

  const links: { href: string; label: string }[] = [];

  if (featureFlags.siteAudit) {
    links.push({ href: "/health", label: "Health" });
  }
  if (featureFlags.billing) {
    links.push({ href: "/pricing", label: "Pricing" });
  }
  if (featureFlags.scamFeed) {
    links.push({ href: "/scam-feed", label: "Scam Feed" });
  }
  links.push({ href: "/blog", label: "Blog" });
  links.push({ href: "/api-docs", label: "API" });
  links.push({ href: "/about", label: "About" });

  let authLink: React.ReactNode = null;
  if (featureFlags.auth && user) {
    authLink = (
      <Link
        href="/app"
        className="rounded-lg bg-action-teal text-white font-bold text-sm px-4 py-2 hover:bg-action-teal/90 transition-colors"
      >
        Dashboard
      </Link>
    );
  } else if (featureFlags.auth && !user) {
    authLink = (
      <Link
        href="/login"
        className="rounded-lg border-2 border-deep-navy text-deep-navy font-bold text-sm px-4 py-2 hover:bg-deep-navy/5 transition-colors"
      >
        Sign In
      </Link>
    );
  }

  return (
    <nav
      aria-label="Main navigation"
      className="relative w-full max-w-[640px] mx-auto px-5 py-4 flex items-center justify-between border-b border-gray-100"
    >
      <Link
        href="/"
        className="text-deep-navy font-extrabold text-lg uppercase tracking-wide"
      >
        Ask Arthur
      </Link>
      <MobileMenu links={links} authLink={authLink} />
    </nav>
  );
}
