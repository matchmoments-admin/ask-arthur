"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/app", label: "Overview" },
  { href: "/app/threats", label: "Threat Feed" },
  { href: "/app/fraud-manager", label: "Fraud Manager" },
  { href: "/app/keys", label: "API Keys" },
  { href: "/app/billing", label: "Billing" },
] as const;

export default function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Dashboard navigation"
      className="flex border-b border-slate-200/60 mb-6"
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
            className={`px-4 py-3 text-sm font-medium transition-colors ${
              isActive
                ? "text-deep-navy border-b-2 border-deep-navy"
                : "text-slate-500 hover:text-deep-navy"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
