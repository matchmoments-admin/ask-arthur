"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

interface NavLink {
  href: string;
  label: string;
}

interface MobileMenuProps {
  links: NavLink[];
  authLink?: ReactNode;
}

export default function MobileMenu(props: MobileMenuProps) {
  // Remount on pathname change so `open` resets to false on navigation.
  const pathname = usePathname();
  return <MobileMenuInner key={pathname} {...props} />;
}

function MobileMenuInner({ links, authLink }: MobileMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Desktop links */}
      <div className="hidden md:flex items-center gap-4">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="text-deep-navy font-bold text-sm hover:text-action-teal transition-colors py-3 px-2"
          >
            {link.label}
          </Link>
        ))}
        {authLink}
      </div>

      {/* Mobile burger button */}
      <button
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        className="md:hidden p-2 -mr-2 text-deep-navy"
        onClick={() => setOpen(!open)}
      >
        {open ? <X size={24} /> : <Menu size={24} />}
      </button>

      {/* Mobile dropdown */}
      {open && (
        <div className="absolute top-full left-0 right-0 bg-white border-b border-gray-100 shadow-sm md:hidden z-50">
          <div className="flex flex-col px-5 py-3 gap-1">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-deep-navy font-bold text-sm hover:text-action-teal transition-colors py-3 px-2"
              >
                {link.label}
              </Link>
            ))}
            {authLink && <div className="py-2">{authLink}</div>}
          </div>
        </div>
      )}
    </>
  );
}
