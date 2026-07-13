import Link from "next/link";
import { featureFlags } from "@askarthur/utils/feature-flags";
import MobileMenu from "./MobileMenu";

export default async function Nav({
  maxWidthClass = "max-w-[640px]",
}: {
  // Width of the inner container. Defaults to the standard marketing width so
  // every existing page is unchanged; wider routes (e.g. the 960px clone-watch
  // surface) pass their own so the header underline aligns with the content
  // column instead of stopping short at 640px.
  maxWidthClass?: string;
} = {}) {
  const links: { href: string; label: string }[] = [];

  if (featureFlags.siteAudit) {
    links.push({ href: "/health", label: "Scanner" });
  }
  links.push({ href: "/persona-check", label: "Persona Check" });
  if (featureFlags.charityCheck) {
    links.push({ href: "/charity-check", label: "Charity Check" });
  }
  if (featureFlags.scamFeed) {
    links.push({ href: "/scam-feed", label: "Feed" });
  }
  links.push({ href: "/blog", label: "Blog" });
  links.push({ href: "/about", label: "About" });

  return (
    <nav
      aria-label="Main navigation"
      className={`relative w-full ${maxWidthClass} mx-auto px-5 py-4 flex items-center justify-between border-b border-gray-100`}
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
