"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ShieldAlert,
  FileText,
  CheckSquare,
  Key,
  CreditCard,
  Settings,
} from "lucide-react";

const navItems: Array<{ label: string; href: string; icon: typeof LayoutDashboard; exact?: boolean }> = [
  { label: "Overview", href: "/app", icon: LayoutDashboard, exact: true },
  { label: "Threat Feed", href: "/app/threats", icon: ShieldAlert },
  { label: "Reports", href: "/app/reports", icon: FileText },
  { label: "SPF Compliance", href: "/app/spf-compliance", icon: CheckSquare },
  { label: "API Keys", href: "/app/keys", icon: Key },
  { label: "Billing", href: "/app/billing", icon: CreditCard },
  { label: "Settings", href: "/app/settings", icon: Settings },
];

export default function DashboardSidebar({ userEmail, userRole }: { userEmail: string; userRole: string }) {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:flex flex-col w-60 min-h-screen bg-deep-navy text-white shrink-0">
      <div className="px-5 py-5 border-b border-white/10">
        <Link href="/" className="font-extrabold text-sm uppercase tracking-wider text-white">
          Ask Arthur
        </Link>
        <span className="block text-[10px] text-white/40 mt-0.5 uppercase tracking-widest">
          Intelligence Platform
        </span>
      </div>

      <nav className="flex-1 py-4 px-3">
        {navItems.map(({ label, href, icon: Icon, exact }) => {
          const isActive = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg mb-0.5 text-sm transition-colors ${
                isActive
                  ? "bg-white/10 text-white font-medium"
                  : "text-white/50 hover:text-white hover:bg-white/5"
              }`}
            >
              <Icon size={16} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="px-5 py-4 border-t border-white/10">
        <p className="text-xs text-white/40 truncate">{userEmail}</p>
        <p className="text-[10px] text-white/25 uppercase tracking-wider mt-0.5">
          {userRole === "admin" ? "Admin" : "Partner"}
        </p>
      </div>
    </aside>
  );
}
