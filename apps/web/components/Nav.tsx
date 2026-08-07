import Link from "next/link";
import { featureFlags } from "@askarthur/utils/feature-flags";
import MobileMenu from "./MobileMenu";

export default async function Nav() {
  const links: { href: string; label: string }[] = [];

  if (featureFlags.siteAudit) {
    links.push({ href: "/health", label: "Scanner" });
  }
  links.push({ href: "/persona-check", label: "Persona Check" });
  // Charity Check removed from the nav 2026-08-08 (founder decision after
  // v0.2e): the main scanner now detects charity-shaped input and runs the
  // register check inline, so the one box is the front door. The
  // /charity-check PAGE stays live (SEO landing, guided payment/ID
  // questions, deep-link target) — de-navved, not deleted, same as the
  // phone-footprint precedent.
  if (featureFlags.scamFeed) {
    links.push({ href: "/scam-feed", label: "Feed" });
  }
  links.push({ href: "/blog", label: "Blog" });
  links.push({ href: "/about", label: "About" });

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
      <MobileMenu links={links} authLink={null} />
    </nav>
  );
}
