"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/app", label: "Overview" },
  { href: "/app/keys", label: "API Keys" },
  { href: "/app/billing", label: "Billing" },
] as const;

export default function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Dashboard navigation"
      className="flex border-b border-border-light mb-6"
    >
      {tabs.map((tab) => {
        const isActive =
          tab.href === "/app"
            ? pathname === "/app"
            : pathname.startsWith(tab.href);

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-4 py-3 text-sm font-bold transition-colors ${
              isActive
                ? "text-deep-navy border-b-2 border-action-teal"
                : "text-gov-slate hover:text-deep-navy"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
